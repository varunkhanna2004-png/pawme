import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { petPhotoUrl, supabase, type DeckCard, type Enums } from '../lib/supabase';
import { errorCopy } from '../lib/format';
import { inviteUrl, shareLink } from '../lib/share';
import SwipeDeck, { type SwipeDeckHandle } from '../components/SwipeDeck';
import MatchOverlay from '../components/MatchOverlay';
import { Toast, useOnline } from '../components/States';
import SafetySheet, { type SafetyOutcome } from '../components/SafetySheet';

type SwipeAction = Enums<'swipe_action'>;
type Status = 'loading' | 'ready' | 'error';
const REFILL_AT = 3;

export default function Discover() {
  const { owner, pet } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const deckRef = useRef<SwipeDeckHandle>(null);

  const [cards, setCards] = useState<DeckCard[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [errorText, setErrorText] = useState('');
  const [exhausted, setExhausted] = useState(false);
  const [supersLeft, setSupersLeft] = useState(0);
  const [lastSwiped, setLastSwiped] = useState<DeckCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [match, setMatch] = useState<{ card: DeckCard; conversationId: string } | null>(null);
  const [myPhoto, setMyPhoto] = useState<string>();
  const [safetyFor, setSafetyFor] = useState<DeckCard | null>(null);

  // Pets swiped this session. A refill can race an in-flight swipe, so the
  // server may briefly still return a card we have already dealt with.
  const swiped = useRef(new Set<string>());
  const fetching = useRef(false);
  const petId = pet!.id;

  const fetchDeck = useCallback(
    async (mode: 'replace' | 'append') => {
      if (fetching.current) return;
      fetching.current = true;
      if (mode === 'replace') setStatus('loading');
      const { data, error } = await supabase.rpc('get_deck', { p_pet_id: petId });
      fetching.current = false;
      if (error) {
        if (mode === 'replace') {
          setErrorText(errorCopy(error.message));
          setStatus('error');
        }
        return;
      }
      const fresh = data.filter((c) => !swiped.current.has(c.pet_id));
      setCards((current) => {
        if (mode === 'replace') return fresh;
        const have = new Set(current.map((c) => c.pet_id));
        return [...current, ...fresh.filter((c) => !have.has(c.pet_id))];
      });
      setExhausted(fresh.length === 0);
      setStatus('ready');
    },
    [petId],
  );

  const refreshSwipeState = useCallback(async () => {
    const { data } = await supabase.rpc('get_swipe_state', { p_pet_id: petId });
    const state = data as { super_paws_left: number; can_rewind: boolean } | null;
    if (state) setSupersLeft(state.super_paws_left);
  }, [petId]);

  useEffect(() => {
    void fetchDeck('replace');
    void refreshSwipeState();
    supabase.from('pet_photos').select('storage_path').eq('pet_id', petId).order('position').limit(1).maybeSingle()
      .then(({ data }) => setMyPhoto(petPhotoUrl(data?.storage_path)));
  }, [fetchDeck, refreshSwipeState, petId]);

  // §6: prefetch the next three cards' images (and the rest of the top card's).
  useEffect(() => {
    const urls = [...(cards[0]?.photos.slice(1) ?? []), ...cards.slice(1, 4).map((c) => c.photos[0])];
    for (const path of urls) {
      const src = petPhotoUrl(path);
      if (src) new Image().src = src;
    }
  }, [cards]);

  // Top up before the deck runs dry.
  useEffect(() => {
    if (status === 'ready' && !exhausted && cards.length <= REFILL_AT) void fetchDeck('append');
  }, [cards.length, status, exhausted, fetchDeck]);

  const handleSwiped = useCallback(
    async (card: DeckCard, action: SwipeAction) => {
      // Optimistic: the card is gone the moment the animation ends.
      swiped.current.add(card.pet_id);
      setCards((current) => current.filter((c) => c.pet_id !== card.pet_id));
      setLastSwiped(card);
      if (action === 'super') setSupersLeft((n) => Math.max(n - 1, 0));

      const { data, error } = await supabase.rpc('swipe', { p_from_pet_id: petId, p_to_pet_id: card.pet_id, p_action: action });
      if (error) {
        if (error.message === 'TARGET_UNAVAILABLE' || error.message === 'ALREADY_MATCHED') return; // stale card; nothing to undo
        // Anything else (offline, Super Paw limit): put the card back on top.
        swiped.current.delete(card.pet_id);
        setCards((current) => [card, ...current.filter((c) => c.pet_id !== card.pet_id)]);
        setLastSwiped(null);
        setToast(errorCopy(error.message));
        void refreshSwipeState();
        return;
      }
      const result = data as { matched: boolean; conversation_id?: string };
      if (result.matched && result.conversation_id) {
        navigator.vibrate?.([30, 60, 30]);
        setLastSwiped(null); // a match cannot be rewound
        setMatch({ card, conversationId: result.conversation_id });
      }
    },
    [petId, refreshSwipeState],
  );

  async function rewind() {
    if (!lastSwiped) return;
    const card = lastSwiped;
    const { error } = await supabase.rpc('rewind_last_swipe', { p_from_pet_id: petId });
    if (error) return setToast(errorCopy(error.message));
    swiped.current.delete(card.pet_id);
    setCards((current) => [card, ...current.filter((c) => c.pet_id !== card.pet_id)]);
    setLastSwiped(null);
    setExhausted(false);
    void refreshSwipeState();
  }

  // After a report or block the card leaves the deck for good. A block already
  // hides the pair from each other server-side; a report on its own is recorded
  // as a pass so the pet doesn't come straight back.
  function handleSafetyDone(card: DeckCard, outcome: SafetyOutcome) {
    setSafetyFor(null);
    swiped.current.add(card.pet_id);
    setCards((current) => current.filter((c) => c.pet_id !== card.pet_id));
    setLastSwiped(null);
    if (outcome === 'reported') void supabase.rpc('swipe', { p_from_pet_id: petId, p_to_pet_id: card.pet_id, p_action: 'pass' }).then(() => undefined);
    setToast(outcome === 'blocked' ? 'Blocked. You won\'t see each other again.' : 'Thanks — report sent to our moderators.');
  }

  // §5: the empty deck is the liquidity release valve — turn it into an invite.
  async function invite() {
    const result = await shareLink("Join me on PAWME — playdates and friends for our pets 🐾", inviteUrl(owner?.referral_code));
    if (result === 'copied') setToast('Invite link copied — paste it to a friend!');
    else if (result === 'unavailable') setToast(inviteUrl(owner?.referral_code));
  }

  const top = cards[0];

  return (
    <div className="relative flex h-full flex-col">
      <Toast message={toast} onDone={() => setToast(null)} />
      <header className="flex items-center justify-between px-5 pb-1 pt-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-brand">PAWME</h1>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-muted shadow-sm">📍 Makati</span>
      </header>

      <div className="relative min-h-0 flex-1 px-4 pb-2 pt-2">
        {status === 'loading' && <div className="skeleton h-full w-full rounded-3xl" aria-label="Finding pets near you" />}

        {status === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl bg-white px-8 text-center shadow-sm">
            <div className="text-5xl" aria-hidden>{online ? '😿' : '📡'}</div>
            <h2 className="text-xl font-bold">{online ? "Couldn't load pets" : "You're offline"}</h2>
            <p className="text-muted">{errorText}</p>
            <button onClick={() => void fetchDeck('replace')} className="rounded-full bg-brand px-6 py-3 font-semibold text-white active:bg-brand-dark">Try again</button>
          </div>
        )}

        {/* The most important screen in the app (§5): never a blank deck. */}
        {status === 'ready' && !top && (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl bg-white px-8 text-center shadow-sm">
            <div className="animate-pop text-6xl" aria-hidden>🐾</div>
            <h2 className="text-2xl font-extrabold">You've met everyone nearby for now</h2>
            <p className="text-muted">Invite a friend to grow the pack — new pets join Makati every day.</p>
            <button onClick={() => void invite()} className="mt-1 rounded-full bg-brand px-7 py-3.5 text-lg font-bold text-white shadow-lg active:bg-brand-dark">Invite a friend</button>
            <button onClick={() => void fetchDeck('replace')} className="text-sm font-semibold text-muted">Check again</button>
          </div>
        )}

        {status === 'ready' && top && (
          <SwipeDeck ref={deckRef} cards={cards} canSuper={supersLeft > 0} onSwiped={handleSwiped} onSuperBlocked={() => setToast(errorCopy('SUPER_PAW_LIMIT'))} onSafety={setSafetyFor} />
        )}
      </div>

      <div className="flex items-center justify-center gap-4 px-4 pb-3 pt-1">
        <RoundButton label="Rewind last swipe" onClick={() => void rewind()} disabled={!lastSwiped} className="h-12 w-12 text-xl text-amber-500">↩</RoundButton>
        <RoundButton label="Pass" onClick={() => deckRef.current?.swipe('pass')} disabled={!top} className="h-16 w-16 text-3xl text-nope">✕</RoundButton>
        <RoundButton label={`Super Paw (${supersLeft} left today)`} onClick={() => deckRef.current?.swipe('super')} disabled={!top} className={`h-12 w-12 text-xl ${supersLeft > 0 ? 'text-super' : 'text-black/20'}`}>★</RoundButton>
        <RoundButton label="Like" onClick={() => deckRef.current?.swipe('like')} disabled={!top} className="h-16 w-16 text-3xl text-like">♥</RoundButton>
      </div>

      {safetyFor && (
        <SafetySheet
          target={{ ownerId: safetyFor.owner_id, ownerName: safetyFor.owner_name, petId: safetyFor.pet_id, petName: safetyFor.name }}
          actions={['block', 'report']}
          onClose={() => setSafetyFor(null)}
          onDone={(outcome) => handleSafetyDone(safetyFor, outcome)}
        />
      )}

      {match && (
        <MatchOverlay
          myPetName={pet!.name}
          myPhoto={myPhoto}
          card={match.card}
          onChat={() => navigate(`/chat/${match.conversationId}`)}
          onClose={() => setMatch(null)}
        />
      )}
    </div>
  );
}

function RoundButton({ label, className, children, ...rest }: { label: string; className: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label={label} title={label} {...rest} className={`flex items-center justify-center rounded-full bg-white shadow-md transition-transform active:scale-90 disabled:opacity-40 ${className}`}>
      {children}
    </button>
  );
}
