import { useState, type FormEvent } from 'react';
import { supabase, type Tables } from '../lib/supabase';
import { errorCopy } from '../lib/format';
import { Spinner } from './States';

// A playdate proposal is a structured chat message (kind 'playdate_proposal').
// The server owns the status: it starts 'proposed' and only respond_playdate()
// (accept / decline) or counter_playdate() (propose a change) can move it.
export interface ProposalPayload {
  place: string;
  starts_at: string;
  note?: string;
  status: 'proposed' | 'accepted' | 'declined' | 'changed';
  responded_at?: string;
  replaces?: string;
  replaced_by?: string;
}
export const proposalOf = (m: Tables<'messages'>): ProposalPayload | null => (m.kind === 'playdate_proposal' && m.payload && typeof m.payload === 'object' ? (m.payload as unknown as ProposalPayload) : null);

// §11 safety: nudge toward public spaces. Popular public, pet-friendly spots in
// Makati — suggestions only; the field is free text.
const PLACES = ['Ayala Triangle Gardens', 'Legazpi Active Park', 'Salcedo Park (Jaime Velasquez Park)', 'Washington SyCip Park', 'Circuit Makati', 'Greenbelt Park', 'Power Plant Mall, Rockwell', 'Century City Mall', 'Glorietta'];

export const formatWhen = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

interface SheetProps {
  conversationId: string;
  otherPetName: string;
  /** When set, this is a counter-proposal to that message (prefilled from it). */
  counterTo?: { id: string; payload: ProposalPayload };
  onClose: () => void;
  onSent: () => void;
}

export function PlaydateSheet({ conversationId, otherPetName, counterTo, onClose, onSent }: SheetProps) {
  const start = counterTo ? new Date(counterTo.payload.starts_at) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
  const [place, setPlace] = useState(counterTo?.payload.place ?? '');
  const [date, setDate] = useState(localDate(start));
  const [time, setTime] = useState(localTime(start));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startsAt = date && time ? new Date(`${date}T${time}`) : null;
  const inFuture = !!startsAt && startsAt.getTime() > Date.now() + 15 * 60_000;
  const valid = place.trim().length >= 1 && place.trim().length <= 120 && inFuture;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !startsAt) return;
    setBusy(true);
    setError(null);
    const iso = startsAt.toISOString();
    const { error } = counterTo
      ? await supabase.rpc('counter_playdate', { p_message_id: counterTo.id, p_place: place.trim(), p_starts_at: iso, p_note: note.trim() || undefined })
      : await supabase.from('messages').insert({ conversation_id: conversationId, kind: 'playdate_proposal', payload: { place: place.trim(), starts_at: iso, note: note.trim() } });
    setBusy(false);
    if (error) return setError(error.message === 'PROPOSAL_ALREADY_ANSWERED' ? 'That proposal was already answered.' : error.code === '42501' ? 'This chat is no longer active.' : errorCopy(error.message));
    onSent();
  }

  return (
    <div className="fixed inset-0 z-[60] mx-auto flex max-w-md flex-col justify-end" role="dialog" aria-modal="true" aria-label={counterTo ? 'Propose a change' : 'Propose a playdate'}>
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <form onSubmit={submit} className="animate-float-up relative max-h-[92%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/10" />
        <h2 className="text-lg font-bold">{counterTo ? 'Propose a change' : `Playdate with ${otherPetName}?`}</h2>
        <p className="text-sm text-muted">Meet somewhere public — a park, pet café or pet-friendly mall. Never share a home address in chat.</p>

        <label className="mb-1 mt-4 block text-sm font-semibold" htmlFor="pd-place">Where</label>
        <input id="pd-place" list="pd-places" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} placeholder="e.g. Ayala Triangle Gardens" autoFocus={!counterTo} className="w-full rounded-2xl border border-black/10 px-4 py-3 outline-none focus:border-brand" />
        <datalist id="pd-places">{PLACES.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PLACES.slice(0, 5).map((p) => (
            <button key={p} type="button" onClick={() => setPlace(p)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${place === p ? 'border-brand bg-brand/10 text-brand' : 'border-black/10'}`}>{p}</button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-semibold" htmlFor="pd-date">Date</label>
            <input id="pd-date" type="date" value={date} min={localDate(new Date())} onChange={(e) => setDate(e.target.value)} className="w-full rounded-2xl border border-black/10 px-3 py-3 outline-none focus:border-brand" />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-semibold" htmlFor="pd-time">Time</label>
            <input id="pd-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-2xl border border-black/10 px-3 py-3 outline-none focus:border-brand" />
          </div>
        </div>
        {startsAt && !inFuture && <p className="mt-1 text-xs text-nope">Pick a time at least 15 minutes from now.</p>}

        <label className="mb-1 mt-4 block text-sm font-semibold" htmlFor="pd-note">Note <span className="font-normal text-muted">(optional)</span></label>
        <input id="pd-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="e.g. Bruno loves the fenced area by the fountain" className="w-full rounded-2xl border border-black/10 px-4 py-3 outline-none focus:border-brand" />

        {error && <p role="alert" className="mt-3 rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-full border border-black/10 py-3 font-semibold">Cancel</button>
          <button disabled={!valid || busy} className="flex flex-1 items-center justify-center rounded-full bg-brand py-3 font-bold text-white disabled:opacity-40">{busy ? <Spinner /> : counterTo ? 'Send change' : 'Send proposal'}</button>
        </div>
      </form>
    </div>
  );
}

interface CardProps {
  message: Tables<'messages'>;
  payload: ProposalPayload;
  mine: boolean;
  otherName: string;
  /** Match still active (buttons only make sense then). */
  active: boolean;
  onRespond: (accept: boolean) => Promise<void>;
  onCounter: () => void;
}

const STATUS: Record<ProposalPayload['status'], { label: string; tone: string }> = {
  proposed: { label: 'Waiting for a reply', tone: 'bg-amber-100 text-amber-800' },
  accepted: { label: 'Accepted — see you there!', tone: 'bg-like/15 text-like' },
  declined: { label: 'Declined', tone: 'bg-black/5 text-muted' },
  changed: { label: 'A change was proposed ↓', tone: 'bg-black/5 text-muted' },
};

export function ProposalCard({ message, payload, mine, otherName, active, onRespond, onCounter }: CardProps) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const canAnswer = !mine && payload.status === 'proposed' && active;
  const status = STATUS[payload.status];
  return (
    <div data-testid="proposal" data-status={payload.status} className={`w-[86%] rounded-2xl border p-3.5 shadow-sm ${payload.status === 'accepted' ? 'border-like/40 bg-like/5' : 'border-black/10 bg-white'}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">📅 {payload.replaces ? 'Proposed a change' : 'Playdate proposal'}{mine ? '' : ` · from ${otherName}`}</div>
      <div className="mt-1 text-lg font-bold leading-tight">{payload.place}</div>
      <div className="text-sm">{formatWhen(payload.starts_at)}</div>
      {payload.note && <p className="mt-1 text-sm text-muted">“{payload.note}”</p>}
      <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${status.tone}`}>{status.label}</span>
      {canAnswer && (
        <div className="mt-3 flex flex-col gap-2">
          <button onClick={async () => { setBusy('accept'); await onRespond(true); setBusy(null); }} disabled={!!busy} className="rounded-full bg-brand py-2.5 font-bold text-white disabled:opacity-50">{busy === 'accept' ? 'Accepting…' : 'Accept 🎉'}</button>
          <div className="flex gap-2">
            <button onClick={onCounter} disabled={!!busy} className="flex-1 rounded-full border border-brand/40 py-2 text-sm font-bold text-brand disabled:opacity-50">Propose a change</button>
            <button onClick={async () => { setBusy('decline'); await onRespond(false); setBusy(null); }} disabled={!!busy} className="flex-1 rounded-full border border-black/10 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'decline' ? 'Declining…' : 'Decline'}</button>
          </div>
        </div>
      )}
      {mine && payload.status === 'proposed' && <p className="mt-2 text-xs text-muted">{otherName} can accept, decline or propose a change.</p>}
      {!mine && message.sender_id && payload.status === 'accepted' && <p className="mt-2 text-xs text-muted">Please be on time and keep your pet on a leash until you've said hello 🐾</p>}
    </div>
  );
}

// §7 feedback seam: after an accepted playdate's time has passed, one private
// rating per match. Stored in playdate_feedback; not used for ranking in V1.
export function FeedbackPrompt({ matchId, ownerId, otherPetName, onDone }: { matchId: string; ownerId: string; otherPetName: string; onDone: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const OPTIONS: [number, string, string][] = [[4, '😍', 'Loved it'], [3, '😊', 'Good'], [2, '😐', 'So-so'], [1, '🙁', 'Not great']];
  async function rate(rating: number) {
    setBusy(rating);
    setError(null);
    // Insert, and if a rating already exists update just the rating — the grants only allow updating that column.
    let { error } = await supabase.from('playdate_feedback').insert({ match_id: matchId, owner_id: ownerId, rating });
    if (error?.code === '23505') ({ error } = await supabase.from('playdate_feedback').update({ rating }).eq('match_id', matchId).eq('owner_id', ownerId));
    setBusy(null);
    if (error) return setError(errorCopy(error.message));
    onDone();
  }
  return (
    <div data-testid="feedback-prompt" className="mx-4 mb-2 rounded-2xl bg-white p-3.5 shadow-md" role="region" aria-label="How did the playdate go?">
      <div className="font-bold">How did the playdate with {otherPetName} go?</div>
      <p className="text-xs text-muted">Private — {otherPetName}'s owner won't see your answer.</p>
      <div className="mt-2 flex gap-2">
        {OPTIONS.map(([rating, emoji, label]) => (
          <button key={rating} onClick={() => void rate(rating)} disabled={busy !== null} aria-label={label} title={label} className="flex flex-1 flex-col items-center rounded-xl border border-black/10 py-2 text-2xl active:bg-brand/10 disabled:opacity-50">
            <span aria-hidden>{emoji}</span><span className="text-[10px] font-semibold text-muted">{label}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-nope">{error}</p>}
    </div>
  );
}
