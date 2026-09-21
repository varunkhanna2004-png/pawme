import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { petPhotoUrl, supabase, type InboxRow } from '../lib/supabase';
import { errorCopy, timeShort } from '../lib/format';
import { usePrivateChannel } from '../lib/realtime';
import { Spinner, useOnline } from '../components/States';
import SafetySheet from '../components/SafetySheet';

export default function Matches() {
  const { session } = useAuth();
  const online = useOnline();
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [safetyFor, setSafetyFor] = useState<InboxRow | null>(null);
  const userId = session!.user.id;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_inbox');
    if (error) return setError(errorCopy(error.message));
    setError(null);
    setRows(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // New matches and new messages arrive live on the owner's private inbox
  // channel; table RLS means it only ever carries this owner's rows.
  usePrivateChannel(
    `inbox:${userId}`,
    (ch) =>
      ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void load())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, () => void load()),
    [load],
    () => void load(),
  );

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  const fresh = rows?.filter((r) => !r.last_message_at) ?? [];
  const chats = rows?.filter((r) => r.last_message_at) ?? [];

  return (
    <div className="relative flex h-full flex-col">
      <header className="px-5 pb-2 pt-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Matches</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {rows === null && !error && <div className="flex justify-center pt-16"><Spinner /></div>}

        {error && rows === null && (
          <div className="flex flex-col items-center gap-3 pt-16 text-center">
            <p className="text-muted">{error}</p>
            <button onClick={() => void load()} className="rounded-full bg-brand px-6 py-3 font-semibold text-white">Try again</button>
          </div>
        )}

        {rows?.length === 0 && (
          <div className="flex flex-col items-center gap-3 pt-16 text-center">
            <div className="text-6xl" aria-hidden>💌</div>
            <h2 className="text-xl font-bold">No matches yet</h2>
            <p className="text-muted">When you and another owner both like each other's pets, they'll show up here.</p>
            <Link to="/" className="rounded-full bg-brand px-6 py-3 font-semibold text-white">Start swiping</Link>
          </div>
        )}

        {fresh.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand">New matches</h2>
            <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-3">
              {fresh.map((r) => (
                <div key={r.conversation_id} className="relative w-20 shrink-0">
                <button onClick={() => setSafetyFor(r)} aria-label={`Options for ${r.other_pet_name}: unmatch, block or report`} className="absolute -right-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white text-muted shadow">⋯</button>
                <Link to={`/chat/${r.conversation_id}`} className="flex flex-col items-center gap-1">
                  <Avatar path={r.other_pet_photo} className="h-20 w-20 border-[3px] border-brand" />
                  <span className="w-full truncate text-center text-sm font-semibold">{r.other_pet_name}</span>
                </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {chats.length > 0 && (
          <section className="mt-2">
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">Messages</h2>
            <ul>
              {chats.map((r) => (
                <li key={r.conversation_id} className="flex items-center border-b border-black/5">
                  <Link to={`/chat/${r.conversation_id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3">
                    <Avatar path={r.other_pet_photo} className="h-14 w-14" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-bold">{r.other_pet_name} <span className="font-normal text-muted">· {r.other_owner_name}</span></span>
                        <span className="shrink-0 text-xs text-muted">{timeShort(r.last_message_at!)}</span>
                      </div>
                      <p className={`truncate text-sm ${r.unread ? 'font-bold text-ink' : 'text-muted'}`}>{r.last_message_preview}</p>
                    </div>
                    {r.unread && <span className="h-3 w-3 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                  </Link>
                  <button onClick={() => setSafetyFor(r)} aria-label={`Options for ${r.other_pet_name}: unmatch, block or report`} className="ml-1 flex h-10 w-8 shrink-0 items-center justify-center text-xl text-muted">⋯</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {safetyFor && (
        <SafetySheet
          target={{ ownerId: safetyFor.other_owner_id, ownerName: safetyFor.other_owner_name, petId: safetyFor.other_pet_id, petName: safetyFor.other_pet_name, matchId: safetyFor.match_id }}
          actions={['unmatch', 'block', 'report']}
          onClose={() => setSafetyFor(null)}
          onDone={() => {
            setSafetyFor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Avatar({ path, className }: { path: string | null; className: string }) {
  const src = petPhotoUrl(path);
  return (
    <div className={`shrink-0 overflow-hidden rounded-full bg-black/5 ${className}`}>
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-2xl">🐾</div>}
    </div>
  );
}
