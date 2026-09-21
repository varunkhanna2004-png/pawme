import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { usePrivateChannel } from './realtime';
import { supabase, type InboxRow } from './supabase';

interface InboxState {
  /** null while loading for the first time */
  rows: InboxRow[] | null;
  error: string | null;
  unreadCount: number;
  reload: () => Promise<void>;
  /** The caller is already showing this match/chat itself (e.g. the Paw-Match overlay): don't also toast it. */
  acknowledge: (conversationId: string) => void;
}

const InboxContext = createContext<InboxState | null>(null);

/**
 * ONE subscription to the owner's private `inbox:<owner_id>` channel for the whole
 * signed-in app (supabase-js cannot hold two channels on the same topic). It keeps
 * the inbox fresh, drives the unread badge on the Matches tab, and raises the
 * in-app notifications (§4) — a banner for a new match or message — which the
 * owner can switch off in Settings (owners.notify_in_app).
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { session, owner } = useAuth();
  const userId = session!.user.id;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  const notify = useRef(owner?.notify_in_app ?? true);
  notify.current = owner?.notify_in_app ?? true;

  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; conversationId: string } | null>(null);
  const known = useRef<Map<string, string | null> | null>(null); // conversation → last_message_at we have already seen
  const acknowledged = useRef(new Set<string>());

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_inbox');
    if (error || !data) return setError(error?.message ?? 'load failed');
    setError(null);
    setRows(data);

    // Work out what is NEW since the last load (never on the first load).
    const before = known.current;
    known.current = new Map(data.map((r) => [r.conversation_id, r.last_message_at]));
    if (!before || !notify.current) return;
    for (const r of data) {
      const viewing = path.current === `/chat/${r.conversation_id}`;
      if (viewing || acknowledged.current.has(r.conversation_id)) continue;
      if (!before.has(r.conversation_id)) {
        setBanner({ text: `🎉 It's a Paw-Match with ${r.other_pet_name}!`, conversationId: r.conversation_id });
      } else if (r.unread && r.last_message_at && r.last_message_at !== before.get(r.conversation_id)) {
        setBanner({ text: `💬 ${r.other_owner_name ?? r.other_pet_name}: ${r.last_message_preview ?? 'New message'}`, conversationId: r.conversation_id });
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  usePrivateChannel(
    `inbox:${userId}`,
    (ch) =>
      ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void reload())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, () => void reload()),
    [reload],
    () => void reload(),
  );

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  const acknowledge = useCallback((id: string) => void acknowledged.current.add(id), []);
  const value = useMemo<InboxState>(() => ({ rows, error, unreadCount: rows?.filter((r) => r.unread).length ?? 0, reload, acknowledge }), [rows, error, reload, acknowledge]);

  return (
    <InboxContext.Provider value={value}>
      {children}
      {banner && (
        <button
          onClick={() => { navigate(`/chat/${banner.conversationId}`); setBanner(null); }}
          role="status"
          data-testid="inapp-banner"
          className="animate-float-up fixed inset-x-0 top-3 z-[70] mx-auto w-[92%] max-w-sm truncate rounded-2xl bg-ink px-4 py-3 text-left text-sm font-semibold text-white shadow-xl"
        >
          {banner.text}
        </button>
      )}
    </InboxContext.Provider>
  );
}

export function useInbox() {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used inside <InboxProvider>');
  return ctx;
}
