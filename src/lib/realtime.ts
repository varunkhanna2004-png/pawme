import { useEffect, useRef, type DependencyList, type RefObject } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Every PAWME channel is PRIVATE: the project rejects public channels outright,
// and realtime.messages policies decide who may join which topic
// (`conversation:<id>` → its two participants, `inbox:<owner_id>` → that owner).
//
// supabase-js hands back the SAME channel object for a topic that is still
// being torn down. A fast unmount → remount (React StrictMode in dev, or
// tapping back and forth between two screens) would then attach handlers to a
// dying channel and silently receive nothing. So teardown is tracked per topic
// and a new channel waits for the old one to finish closing.
const closing = new Map<string, Promise<unknown>>();

/**
 * Subscribe to a private Realtime channel for the lifetime of the component.
 * `build` attaches the `.on(...)` handlers. `onRejoin` fires when the channel
 * (re)connects after a drop — the moment to refetch anything missed.
 */
export function usePrivateChannel(
  topic: string | null,
  build: (channel: RealtimeChannel) => RealtimeChannel,
  deps: DependencyList,
  onRejoin?: () => void,
): RefObject<RealtimeChannel | null> {
  const ref = useRef<RealtimeChannel | null>(null);
  const rejoin = useRef(onRejoin);
  rejoin.current = onRejoin;

  useEffect(() => {
    if (!topic) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      await closing.get(topic);
      if (cancelled) return;
      await supabase.realtime.setAuth(); // private channels are authorised with the user's JWT
      if (cancelled) return;
      let joinedBefore = false;
      channel = build(supabase.channel(topic, { config: { private: true } }));
      ref.current = channel;
      channel.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (joinedBefore) rejoin.current?.();
        joinedBefore = true;
      });
    })();

    return () => {
      cancelled = true;
      ref.current = null;
      if (channel) {
        const done = supabase.removeChannel(channel).finally(() => {
          if (closing.get(topic) === done) closing.delete(topic);
        });
        closing.set(topic, done);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, ...deps]);

  return ref;
}
