import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { petPhotoUrl, supabase, type InboxRow, type Tables } from '../lib/supabase';
import { errorCopy, timeShort } from '../lib/format';
import { usePrivateChannel } from '../lib/realtime';
import { useInbox } from '../lib/inbox';
import { Spinner, useOnline } from '../components/States';
import SafetySheet, { type SafetyTarget } from '../components/SafetySheet';
import ShareCardSheet from '../components/ShareCardSheet';
import { FeedbackPrompt, PlaydateSheet, ProposalCard, proposalOf, type ProposalPayload } from '../components/Playdate';

type Message = Tables<'messages'> & { pending?: boolean; failed?: boolean };

// Screen 8 — the spine version: realtime text, typing indicator, "Seen".
// Block / report / unmatch live behind the ⋯ menu (§8: reachable from every conversation).
// TODO(next step, §8): photos, playdate proposal sheet.
export default function Chat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { session } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const reloadInbox = useInbox().reload;
  // Captured when the menu opens: blocking ends the match, which (via Realtime) flips this
  // screen to "not available" — the sheet must survive that to show its confirmation.
  const [safetyTarget, setSafetyTarget] = useState<SafetyTarget | null>(null);
  // Playdates (§2, §7): proposal sheet (new or a counter to an existing one), and
  // the private "How did it go?" prompt once an accepted playdate has passed.
  const [playdate, setPlaydate] = useState<{ counterTo?: { id: string; payload: ProposalPayload } } | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<boolean | null>(null); // null = not checked yet
  const [share, setShare] = useState<{ mine: { name: string; photoUrl?: string }; theirs: { name: string; photoUrl?: string } } | null>(null);
  const userId = session!.user.id;

  const [info, setInfo] = useState<InboxRow | null | undefined>(undefined); // undefined = loading, null = not found
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const typingSentAt = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bottom = useRef<HTMLDivElement>(null);

  const upsert = useCallback((incoming: Message) => {
    setMessages((current) => {
      const i = current.findIndex((m) => m.id === incoming.id);
      if (i === -1) return [...current, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const next = current.slice();
      next[i] = incoming;
      return next;
    });
  }, []);

  const markRead = useCallback(() => {
    if (!conversationId || document.visibilityState !== 'visible') return;
    // supabase-js builders are lazy: nothing is sent until they are awaited / .then()'d.
    void supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).then(() => void reloadInbox());
  }, [conversationId, reloadInbox]);

  const load = useCallback(async () => {
    if (!conversationId) return;
    const [inbox, msgs, conv] = await Promise.all([
      supabase.rpc('get_inbox'),
      supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(200),
      supabase.from('conversations').select('owner_a_id, a_last_read_at, b_last_read_at').eq('id', conversationId).maybeSingle(),
    ]);
    const error = inbox.error ?? msgs.error ?? conv.error;
    if (error || !inbox.data || !msgs.data) return setLoadError(errorCopy(error?.message));
    setLoadError(null);
    setInfo(inbox.data.find((r) => r.conversation_id === conversationId) ?? null);
    const history = msgs.data.slice().reverse();
    setMessages((current) => [...history, ...current.filter((m) => m.pending || m.failed)]);
    if (conv.data) setOtherReadAt(conv.data.owner_a_id === userId ? conv.data.b_last_read_at : conv.data.a_last_read_at);
    const me = inbox.data.find((r) => r.conversation_id === conversationId);
    if (me) {
      const fb = await supabase.from('playdate_feedback').select('rating').eq('match_id', me.match_id).eq('owner_id', userId).maybeSingle();
      setFeedbackGiven(!!fb.data);
    }
    markRead();
  }, [conversationId, userId, markRead]);

  useEffect(() => {
    void load();
    const onVisible = () => markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(typingTimer.current);
    };
  }, [load, markRead]);

  // One private channel per conversation — only its two participants may join
  // (realtime.messages policy). It carries new messages and the other person's
  // read position (Postgres Changes, filtered again by table RLS) plus the
  // typing indicator (Broadcast).
  const channel = usePrivateChannel(
    conversationId ? `conversation:${conversationId}` : null,
    (ch) =>
      ch
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => upsert(payload.new as Message))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          const msg = payload.new as Message;
          upsert(msg);
          if (msg.sender_id !== userId) {
            setOtherTyping(false);
            markRead();
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` }, (payload) => {
          const conv = payload.new as Tables<'conversations'>;
          setOtherReadAt(conv.owner_a_id === userId ? conv.b_last_read_at : conv.a_last_read_at);
        })
        // The match ending (they unmatched or blocked) must close this chat live, for both people.
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => void load())
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (payload.user === userId) return;
          setOtherTyping(true);
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setOtherTyping(false), 3500);
        }),
    [userId, upsert, markRead],
    () => void load(), // reconnected after a drop: catch up on anything missed
  );

  // Coming back online: catch up on anything missed while disconnected.
  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, otherTyping]);

  async function send(text: string, retryId?: string) {
    const body = text.trim();
    if (!body || !conversationId) return;
    // The id is generated here so a retry can never create a duplicate row.
    const id = retryId ?? crypto.randomUUID();
    upsert({ id, conversation_id: conversationId, sender_id: userId, kind: 'text', body, photo_path: null, payload: null, created_at: new Date().toISOString(), pending: true });
    const { data, error } = await supabase.from('messages').insert({ id, conversation_id: conversationId, body }).select().single();
    if (error?.code === '42501') return void load(); // RLS refused: the match has ended (unmatched or blocked)
    if (error && error.code !== '23505') {
      upsert({ id, conversation_id: conversationId, sender_id: userId, kind: 'text', body, photo_path: null, payload: null, created_at: new Date().toISOString(), failed: true });
      return;
    }
    if (data) upsert(data);
  }

  async function openShare() {
    if (!info) return;
    const { data } = await supabase.from('pet_photos').select('storage_path').eq('pet_id', info.my_pet_id).order('position').limit(1).maybeSingle();
    // Pet names + photos only: the share card never receives an owner name or a location.
    setShare({ mine: { name: info.my_pet_name, photoUrl: petPhotoUrl(data?.storage_path) }, theirs: { name: info.other_pet_name, photoUrl: petPhotoUrl(info.other_pet_photo) } });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft;
    setDraft('');
    void send(text);
  }

  function onDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    if (value && now - typingSentAt.current > 2000) {
      typingSentAt.current = now;
      void channel.current?.send({ type: 'broadcast', event: 'typing', payload: { user: userId } });
    }
  }

  const safetySheet = safetyTarget && (
    <SafetySheet
      target={safetyTarget}
      actions={['unmatch', 'block', 'report']}
      onClose={() => setSafetyTarget(null)}
      onDone={(outcome) => (outcome === 'reported' ? setSafetyTarget(null) : navigate('/matches', { replace: true }))}
    />
  );

  if (loadError && info === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-muted">{loadError}</p>
        <button onClick={() => void load()} className="rounded-full bg-brand px-6 py-3 font-semibold text-white">Try again</button>
        <Link to="/matches" className="text-sm font-semibold text-muted">Back to matches</Link>
      </div>
    );
  }
  if (info === undefined) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (info === null) {
    return (
      <Frame sheet={safetySheet}>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <h2 className="text-xl font-bold">This chat isn't available</h2>
          <p className="text-muted">The match may have ended.</p>
          <Link to="/matches" className="rounded-full bg-brand px-6 py-3 font-semibold text-white">Back to matches</Link>
        </div>
      </Frame>
    );
  }

  const photo = petPhotoUrl(info.other_pet_photo);
  const lastMine = [...messages].reverse().find((m) => m.sender_id === userId && !m.pending && !m.failed);
  // Compare as instants: REST and Realtime format the same timestamp differently.
  const seen = !!lastMine && !!otherReadAt && Date.parse(otherReadAt) >= Date.parse(lastMine.created_at);
  async function respond(messageId: string, accept: boolean) {
    const { error } = await supabase.rpc('respond_playdate', { p_message_id: messageId, p_accept: accept });
    if (error) void load(); // already answered / match ended: refresh to the truth
  }
  // The feedback prompt: an accepted playdate whose time has passed, in an active match, not yet rated.
  const pastPlaydate = messages.map((m) => ({ m, p: proposalOf(m) })).find(({ p }) => p?.status === 'accepted' && Date.parse(p.starts_at) < Date.now());
  const showFeedback = !!pastPlaydate && feedbackGiven === false && !localStorage.getItem(`pawme:fb-skip:${info.match_id}`);
  const openers = [`Hi ${info.other_owner_name ?? 'there'}! What's ${info.other_pet_name}'s favorite park?`, `${info.my_pet_name} would love a playdate — is ${info.other_pet_name} free this weekend?`, `How does ${info.other_pet_name} get along with new friends?`];

  return (
    <Frame sheet={safetySheet}>
    <div className="flex h-full flex-col bg-cream">
      <header className="flex items-center gap-3 border-b border-black/5 bg-white px-3 py-2.5">
        <Link to="/matches" aria-label="Back to matches" className="px-2 text-2xl text-muted">‹</Link>
        <div className="h-10 w-10 overflow-hidden rounded-full bg-black/5">{photo && <img src={photo} alt="" className="h-full w-full object-cover" />}</div>
        <div className="min-w-0">
          <div className="truncate font-bold leading-tight">{info.other_pet_name}</div>
          <div className="truncate text-xs text-muted">with {info.other_owner_name ?? 'their owner'}</div>
        </div>
        <button onClick={() => setSafetyTarget({ ownerId: info.other_owner_id, ownerName: info.other_owner_name, petId: info.other_pet_id, petName: info.other_pet_name, matchId: info.match_id, lastMessageId: [...messages].reverse().find((m) => m.sender_id !== userId && !m.pending)?.id })} aria-label="Safety options: unmatch, block or report" className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-2xl text-muted active:bg-black/5">⋯</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 pt-8 text-center">
            <p className="text-muted">You and {info.my_pet_name} matched with {info.other_owner_name ? `${info.other_owner_name} and ` : ''}{info.other_pet_name} 🎉<br />Break the ice:</p>
            <button onClick={() => void openShare()} className="rounded-full border-2 border-brand px-5 py-2 text-sm font-bold text-brand active:bg-brand/10">Share this match 🎉</button>
            {openers.map((o) => (
              <button key={o} onClick={() => void send(o)} className="w-full rounded-2xl border border-brand/30 bg-white px-4 py-2.5 text-left text-sm font-medium text-ink active:bg-brand/10">{o}</button>
            ))}
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          {messages.map((m) => {
            const mine = m.sender_id === userId;
            const proposal = proposalOf(m);
            return (
              <li key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {proposal ? (
                  <ProposalCard message={m} payload={proposal} mine={mine} otherName={info.other_owner_name ?? info.other_pet_name} active onRespond={(accept) => respond(m.id, accept)} onCounter={() => setPlaydate({ counterTo: { id: m.id, payload: proposal } })} />
                ) : (
                <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 ${mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-white text-ink shadow-sm'} ${m.pending ? 'opacity-60' : ''}`}>
                  {m.kind === 'text' ? m.body : '📷 Photo'}
                </div>
                )}
                {m.failed ? (
                  <button onClick={() => void send(m.body ?? '', m.id)} className="mt-0.5 text-xs font-semibold text-nope">Not sent — tap to retry</button>
                ) : (
                  <span className="mt-0.5 text-[10px] text-muted">{m.pending ? 'Sending…' : timeShort(m.created_at)}{mine && m.id === lastMine?.id && seen ? ' · Seen' : ''}</span>
                )}
              </li>
            );
          })}
        </ul>
        {otherTyping && <p className="mt-2 text-sm italic text-muted" role="status">{info.other_owner_name ?? 'They'} is typing…</p>}
        <div ref={bottom} />
      </div>

      {share && <ShareCardSheet mine={share.mine} theirs={share.theirs} onClose={() => setShare(null)} />}
      {playdate && <PlaydateSheet conversationId={conversationId!} otherPetName={info.other_pet_name} counterTo={playdate.counterTo} onClose={() => setPlaydate(null)} onSent={() => setPlaydate(null)} />}
      {showFeedback && (
        <FeedbackPrompt matchId={info.match_id} ownerId={userId} otherPetName={info.other_pet_name} onDone={() => setFeedbackGiven(true)} />
      )}

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-black/5 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => setPlaydate({})} aria-label="Propose a playdate" title="Propose a playdate" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream text-xl active:bg-brand/10">📅</button>
        <input value={draft} onChange={(e) => onDraftChange(e.target.value)} maxLength={2000} placeholder={online ? 'Message…' : "You're offline"} aria-label="Message" className="min-w-0 flex-1 rounded-full bg-cream px-4 py-2.5 outline-none focus:ring-2 focus:ring-brand/40" />
        <button disabled={!draft.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-lg text-white active:bg-brand-dark disabled:opacity-40">➤</button>
      </form>
    </div>
    </Frame>
  );
}

// Both the chat and its "not available" state render inside the same Frame, with
// the safety sheet in the same slot. Blocking someone ends the match, which flips
// the chat to "not available" underneath the open sheet; keeping the slot stable
// stops React remounting the sheet and losing its confirmation step.
function Frame({ sheet, children }: { sheet: ReactNode; children: ReactNode }) {
  return (
    <div className="relative h-full">
      {children}
      {sheet}
    </div>
  );
}
