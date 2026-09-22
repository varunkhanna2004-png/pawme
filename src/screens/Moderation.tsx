import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/database.types';
import { errorCopy, timeShort } from '../lib/format';
import { Spinner } from '../components/States';

type Row = Database['public']['Functions']['get_moderation_queue']['Returns'][number];

const REASON_LABEL: Record<Row['reason'], string> = {
  harassment: 'Harassment',
  scam: 'Scam',
  animal_welfare: 'Animal welfare',
  sexual_content_involving_animals: 'Sexual content involving animals',
  impersonation: 'Impersonation',
  spam: 'Spam',
};

// The whole V1 "admin portal" (§5, §9): open reports, with suspend / dismiss.
// Access is enforced in the database — get_moderation_queue() and
// resolve_report() refuse anyone whose owners.role is not 'moderator' — so
// hiding this route from other users is a courtesy, not the protection.
export default function Moderation() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_moderation_queue', { p_status: 'open' });
    if (error) return setError(error.message === 'NOT_A_MODERATOR' ? 'This account is not a moderator.' : errorCopy(error.message));
    setError(null);
    setRows(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(row: Row, action: 'suspend' | 'dismiss') {
    setBusyId(row.report_id);
    const { error } = await supabase.rpc('resolve_report', { p_report_id: row.report_id, p_action: action });
    setBusyId(null);
    setConfirmId(null);
    if (error) return setError(errorCopy(error.message));
    await load(); // a suspension closes every open report against that owner
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pb-2 pt-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Moderation queue</h1>
        <button onClick={() => void load()} className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-muted shadow-sm">Refresh</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {error && <p role="alert" className="mb-3 rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>}
        {rows === null && !error && <div className="flex justify-center pt-16"><Spinner /></div>}
        {rows?.length === 0 && (
          <div className="pt-16 text-center">
            <div className="text-5xl" aria-hidden>✅</div>
            <h2 className="mt-2 text-xl font-bold">Queue is clear</h2>
            <p className="text-muted">No open reports.</p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {rows?.map((r) => (
            <li key={r.report_id} className="rounded-2xl bg-white p-4 shadow-sm" data-testid="report">
              <div className="flex items-start justify-between gap-2">
                <span className="rounded-full bg-nope/10 px-2.5 py-0.5 text-xs font-bold text-nope">{REASON_LABEL[r.reason]}</span>
                <span className="text-xs text-muted">{timeShort(r.created_at)}</span>
              </div>
              <p className="mt-2 text-sm">
                <span className="font-bold">{r.target_owner_name ?? 'Deleted account'}</span>
                {r.target_pet_name && <span className="text-muted"> (pet: {r.target_pet_name})</span>}
                <span className="text-muted"> · reported by {r.reporter_name ?? 'deleted account'}</span>
              </p>
              {r.open_reports_against_target > 1 && <p className="mt-1 text-xs font-semibold text-nope">{r.open_reports_against_target} open reports against this owner</p>}
              {r.details && <p className="mt-2 rounded-xl bg-cream px-3 py-2 text-sm">"{r.details}"</p>}
              {r.message_snapshot && (
                <p className="mt-2 rounded-xl border border-black/10 px-3 py-2 text-sm">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">Reported message</span>
                  {r.message_snapshot}
                </p>
              )}
              {r.target_owner_status === 'suspended' && <p className="mt-2 text-xs font-semibold text-muted">Already suspended</p>}

              {confirmId === r.report_id ? (
                <div className="mt-3 rounded-xl bg-nope/10 p-3">
                  <p className="text-sm font-semibold">Suspend {r.target_owner_name ?? 'this owner'}? They lose access immediately, their email address is banned from re-registering, and all open reports against them are closed.</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => setConfirmId(null)} className="flex-1 rounded-full border border-black/10 bg-white py-2 text-sm font-semibold">Cancel</button>
                    <button onClick={() => void resolve(r, 'suspend')} disabled={busyId === r.report_id} className="flex-1 rounded-full bg-nope py-2 text-sm font-bold text-white disabled:opacity-50">Confirm suspend</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => void resolve(r, 'dismiss')} disabled={busyId === r.report_id} className="flex-1 rounded-full border border-black/10 py-2 text-sm font-semibold disabled:opacity-50">Dismiss</button>
                  <button onClick={() => setConfirmId(r.report_id)} disabled={busyId === r.report_id || !r.target_owner_id} className="flex-1 rounded-full bg-nope py-2 text-sm font-bold text-white disabled:opacity-50">Suspend</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
