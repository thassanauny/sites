import type { SupabaseClient } from '@supabase/supabase-js';

// SDK channels are reused by topic until asynchronous removal finishes, including across mount cycles.
const leaving = new WeakMap<SupabaseClient, Promise<unknown>>();
function remove(client: SupabaseClient, channel: ReturnType<SupabaseClient['channel']>): void {
  const previous = leaving.get(client) ?? Promise.resolve();
  let removed: Promise<unknown>;
  try {
    removed = Promise.resolve(client.removeChannel(channel));
  } catch {
    removed = Promise.resolve();
  }
  leaving.set(client, Promise.allSettled([previous, removed]));
}

/** Broadcasts only invalidate checked cached data; the durable queue and polls own correctness. */
export function listenForChanges(client: SupabaseClient, changed: () => void, health: (healthy: boolean) => void = () => {}): () => void {
  health(false);
  let stopped = false;
  let generation = 0;
  let user = '';
  let channel: ReturnType<SupabaseClient['channel']> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!stopped) changed();
    }, 100);
  };
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? '';
    if (stopped || next === user) return;
    const expected = ++generation;
    health(false);
    user = next;
    clearTimeout(timer);
    timer = undefined;
    if (channel) remove(client, channel);
    channel = undefined;
    if (!next) return;
    void (leaving.get(client) ?? Promise.resolve()).then(() => {
      if (stopped || generation !== expected) return;
      try {
        const current = client.channel(`textdrop:user:${next}`, { config: { private: true } });
        channel = current;
        current
          .on('broadcast', { event: 'changed' }, () => {
            if (!stopped && channel === current) wake();
          })
          .subscribe(status => {
            if (stopped || channel !== current) return;
            health(status === 'SUBSCRIBED');
            if (status === 'SUBSCRIBED') wake();
          });
      } catch {
        /* Checked polling repairs unavailable live transport. */
      }
    });
  });
  return () => {
    stopped = true;
    health(false);
    ++generation;
    clearTimeout(timer);
    data.subscription.unsubscribe();
    if (channel) remove(client, channel);
    channel = undefined;
  };
}
