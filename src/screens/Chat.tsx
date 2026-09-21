import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { petPhotoUrl, supabase, type InboxRow, type Tables } from '../lib/supabase';
import { errorCopy, timeShort } from '../lib/format';
import { usePrivateChannel } from '../lib/realtime';
import { Spinner, useOnline } from '../components/States';

type Message = Tables<'messages'> & { pending?: boolean; failed?: boolean };

// Screen 8 — the spine version: realtime text, typing indicator, "Seen".
// TODO(next step, §8/§9): photos, playdate proposal sheet, block / report / unmatch menu.
export default function Chat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { session } = useAuth();
  const online = useOnline();
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
    void supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).then(() => undefined);
  }, [conversationId]);

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
    if (error && error.code !== '23505') {
      upsert({ id, conversation_id: conversationId, sender_id: userId, kind: 'text', body, photo_path: null, payload: null, created_at: new Date().toISOString(), failed: true });
      return;
    }
    if (data) upsert(data);
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
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <h2 className="text-xl font-bold">This chat isn't available</h2>
        <p className="text-muted">The match may have ended.</p>
        <Link to="/matches" className="rounded-full bg-brand px-6 py-3 font-semibold text-white">Back to matches</Link>
      </div>
    );
  }

  const photo = petPhotoUrl(info.other_pet_photo);
  const lastMine = [...messages].reverse().find((m) => m.sender_id === userId && !m.pending && !m.failed);
  // Compare as instants: REST and Realtime format the same timestamp differently.
  const seen = !!lastMine && !!otherReadAt && Date.parse(otherReadAt) >= Date.parse(lastMine.created_at);
  const openers = [`Hi ${info.other_owner_name ?? 'there'}! What's ${info.other_pet_name}'s favorite park?`, `${info.my_pet_name} would love a playdate — is ${info.other_pet_name} free this weekend?`, `How does ${info.other_pet_name} get along with new friends?`];

  return (
    <div className="flex h-full flex-col bg-cream">
      <header className="flex items-center gap-3 border-b border-black/5 bg-white px-3 py-2.5">
        <Link to="/matches" aria-label="Back to matches" className="px-2 text-2xl text-muted">‹</Link>
        <div className="h-10 w-10 overflow-hidden rounded-full bg-black/5">{photo && <img src={photo} alt="" className="h-full w-full object-cover" />}</div>
        <div className="min-w-0">
          <div className="truncate font-bold leading-tight">{info.other_pet_name}</div>
          <div className="truncate text-xs text-muted">with {info.other_owner_name ?? 'their owner'}</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 pt-8 text-center">
            <p className="text-muted">You and {info.my_pet_name} matched with {info.other_owner_name ? `${info.other_owner_name} and ` : ''}{info.other_pet_name} 🎉<br />Break the ice:</p>
            {openers.map((o) => (
              <button key={o} onClick={() => void send(o)} className="w-full rounded-2xl border border-brand/30 bg-white px-4 py-2.5 text-left text-sm font-medium text-ink active:bg-brand/10">{o}</button>
            ))}
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          {messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <li key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 ${mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-white text-ink shadow-sm'} ${m.pending ? 'opacity-60' : ''}`}>
                  {m.kind === 'text' ? m.body : m.kind === 'photo' ? '📷 Photo' : '📅 Playdate proposal'}
                </div>
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

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-black/5 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <input value={draft} onChange={(e) => onDraftChange(e.target.value)} maxLength={2000} placeholder={online ? 'Message…' : "You're offline"} aria-label="Message" className="min-w-0 flex-1 rounded-full bg-cream px-4 py-2.5 outline-none focus:ring-2 focus:ring-brand/40" />
        <button disabled={!draft.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-lg text-white active:bg-brand-dark disabled:opacity-40">➤</button>
      </form>
    </div>
  );
}
