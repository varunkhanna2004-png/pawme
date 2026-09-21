import { useEffect, useState } from 'react';
import { supabase, type Enums } from '../lib/supabase';
import { errorCopy } from '../lib/format';
import { Spinner } from './States';

type Reason = Enums<'report_reason'>;
export type SafetyAction = 'report' | 'block' | 'unmatch';
export type SafetyOutcome = 'reported' | 'reported_and_blocked' | 'blocked' | 'unmatched';

export interface SafetyTarget {
  ownerId: string;
  ownerName: string | null;
  petId: string;
  petName: string;
  /** Present when the two are matched — enables Unmatch. */
  matchId?: string;
  /** Their most recent chat message, attached to a report as evidence. */
  lastMessageId?: string;
}

interface Props {
  target: SafetyTarget;
  actions: SafetyAction[];
  onClose: () => void;
  /** Called after the action has been saved. */
  onDone: (outcome: SafetyOutcome) => void;
}

// The six reasons from master prompt §9, in the order people most often need them.
const REASONS: { value: Reason; label: string; hint: string }[] = [
  { value: 'harassment', label: 'Harassment', hint: 'Abusive, threatening or unwanted messages' },
  { value: 'scam', label: 'Scam', hint: 'Asking for money, selling, or suspicious links' },
  { value: 'animal_welfare', label: 'Animal welfare', hint: 'Neglect, cruelty, or breeding / selling animals' },
  { value: 'sexual_content_involving_animals', label: 'Sexual content involving animals', hint: 'Any sexual content or requests' },
  { value: 'impersonation', label: 'Impersonation', hint: "Pretending to be someone else, or photos that aren't theirs" },
  { value: 'spam', label: 'Spam', hint: 'Ads, promotions or repeated junk' },
];

type Step = 'menu' | 'report' | 'block' | 'unmatch' | 'done';

/**
 * Report / block / unmatch (§9) — one bottom sheet used from Chat, the Matches
 * inbox and Discover. It only calls what already exists: inserts into `reports`
 * and `blocks` (guarded by RLS + triggers) and the unmatch() function.
 * Everything acts on the OWNER, never the pet (§3.2).
 */
export default function SafetySheet({ target, actions, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>(actions.length === 1 ? actions[0] : 'menu');
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SafetyOutcome | null>(null);
  const who = target.ownerName ?? `${target.petName}'s owner`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function close() {
    if (outcome) onDone(outcome);
    else onClose();
  }

  async function run(work: () => Promise<SafetyOutcome>) {
    setBusy(true);
    setError(null);
    try {
      setOutcome(await work());
      setStep('done');
    } catch (e) {
      setError(errorCopy(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  }

  const block = async () => {
    const { data } = await supabase.auth.getSession();
    const { error } = await supabase.from('blocks').insert({ blocker_id: data.session!.user.id, blocked_id: target.ownerId });
    if (error && error.code !== '23505') throw new Error(error.message); // 23505 = already blocked: fine
  };

  const submitReport = () =>
    run(async () => {
      const { error } = await supabase.from('reports').insert({
        target_owner_id: target.ownerId,
        target_pet_id: target.petId,
        message_id: target.lastMessageId ?? null,
        reason: reason!,
        details: details.trim() || null,
      });
      if (error) throw new Error(error.message);
      if (!alsoBlock) return 'reported';
      await block();
      return 'reported_and_blocked';
    });

  const submitBlock = () => run(async () => (await block(), 'blocked'));

  const submitUnmatch = () =>
    run(async () => {
      const { error } = await supabase.rpc('unmatch', { p_match_id: target.matchId! });
      if (error && error.message !== 'MATCH_NOT_FOUND') throw new Error(error.message); // already ended: fine
      return 'unmatched';
    });

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col justify-end" role="dialog" aria-modal="true" aria-label="Safety options">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={() => !busy && close()} />
      <div className="animate-float-up relative max-h-[88%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/10" />

        {step === 'menu' && (
          <>
            <h2 className="mb-1 text-lg font-bold">{target.petName} · {who}</h2>
            <ul className="divide-y divide-black/5">
              {actions.includes('unmatch') && <MenuItem icon="💔" label="Unmatch" hint="Closes this chat for both of you" onClick={() => setStep('unmatch')} />}
              {actions.includes('block') && <MenuItem icon="🚫" label={`Block ${who}`} hint="You won't see each other anywhere on PAWME" onClick={() => setStep('block')} />}
              {actions.includes('report') && <MenuItem icon="🚩" label={`Report ${who}`} hint="Tell our moderators what's wrong" danger onClick={() => setStep('report')} />}
            </ul>
            <button onClick={onClose} className="mt-2 w-full rounded-full py-3 font-semibold text-muted">Cancel</button>
          </>
        )}

        {step === 'report' && (
          <>
            <h2 className="text-lg font-bold">Report {who}</h2>
            <p className="mb-3 text-sm text-muted">They won't be told who reported them. What's going on?</p>
            <div role="radiogroup" aria-label="Reason" className="flex flex-col gap-2">
              {REASONS.map((r) => (
                <button key={r.value} role="radio" aria-checked={reason === r.value} onClick={() => setReason(r.value)} className={`rounded-2xl border px-4 py-2.5 text-left ${reason === r.value ? 'border-brand bg-brand/10' : 'border-black/10'}`}>
                  <div className="font-semibold">{r.label}</div>
                  <div className="text-xs text-muted">{r.hint}</div>
                </button>
              ))}
            </div>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} placeholder="Anything else we should know? (optional)" aria-label="Details" className="mt-3 w-full rounded-2xl border border-black/10 px-4 py-2.5 text-sm outline-none focus:border-brand" />
            {target.lastMessageId && <p className="mt-1 text-xs text-muted">Their most recent message will be attached for our moderators.</p>}
            <label className="mt-3 flex items-center gap-3 text-sm font-medium">
              <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="h-5 w-5 accent-[#ff6b4a]" />
              Also block {who}
            </label>
            <ErrorLine text={error} />
            <Buttons busy={busy} confirmLabel="Send report" disabled={!reason} onConfirm={submitReport} onBack={actions.length > 1 ? () => setStep('menu') : onClose} />
          </>
        )}

        {step === 'block' && (
          <>
            <h2 className="text-lg font-bold">Block {who}?</h2>
            <p className="mt-1 text-sm text-muted">
              You won't see each other in Discover again{target.matchId ? ', your match will end and this chat will close for both of you' : ''}. They won't be notified.
            </p>
            <ErrorLine text={error} />
            <Buttons busy={busy} confirmLabel="Block" onConfirm={submitBlock} onBack={actions.length > 1 ? () => setStep('menu') : onClose} />
          </>
        )}

        {step === 'unmatch' && (
          <>
            <h2 className="text-lg font-bold">Unmatch {target.petName}?</h2>
            <p className="mt-1 text-sm text-muted">This closes the chat for both of you, and you won't be shown each other again. They won't be notified.</p>
            <ErrorLine text={error} />
            <Buttons busy={busy} confirmLabel="Unmatch" onConfirm={submitUnmatch} onBack={actions.length > 1 ? () => setStep('menu') : onClose} />
          </>
        )}

        {step === 'done' && outcome && (
          <div className="py-4 text-center" role="status">
            <div className="animate-pop text-5xl" aria-hidden>{outcome === 'unmatched' ? '👋' : '🛡️'}</div>
            <h2 className="mt-2 text-lg font-bold">
              {outcome === 'reported' ? 'Report sent' : outcome === 'reported_and_blocked' ? `Report sent · ${who} blocked` : outcome === 'blocked' ? `${who} blocked` : `Unmatched ${target.petName}`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {outcome.startsWith('reported') ? 'Thank you — our moderators will review it. You can see your reports in Settings.' : "You won't see each other again."}
            </p>
            <button onClick={close} className="mt-4 w-full rounded-full bg-brand py-3 font-bold text-white active:bg-brand-dark">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, hint, danger, onClick }: { icon: string; label: string; hint: string; danger?: boolean; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 py-3 text-left active:bg-black/5">
        <span className="text-2xl" aria-hidden>{icon}</span>
        <span>
          <span className={`block font-semibold ${danger ? 'text-nope' : ''}`}>{label}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
      </button>
    </li>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? <p role="alert" className="mt-3 rounded-xl bg-nope/10 px-4 py-2.5 text-sm text-nope">{text}</p> : null;
}

function Buttons({ busy, confirmLabel, disabled, onConfirm, onBack }: { busy: boolean; confirmLabel: string; disabled?: boolean; onConfirm: () => void; onBack: () => void }) {
  return (
    <div className="mt-4 flex gap-3">
      <button onClick={onBack} disabled={busy} className="flex-1 rounded-full border border-black/10 py-3 font-semibold">Back</button>
      <button onClick={onConfirm} disabled={busy || disabled} className="flex flex-1 items-center justify-center rounded-full bg-nope py-3 font-bold text-white disabled:opacity-40">
        {busy ? <Spinner /> : confirmLabel}
      </button>
    </div>
  );
}
