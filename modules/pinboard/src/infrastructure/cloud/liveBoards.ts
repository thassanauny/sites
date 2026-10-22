import type { RealtimeChannel, Session, SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '../../domain/boards/board';

// realtime-js reuses an existing topic until its async leave finishes. This must
// survive watcher replacement (visibility changes and React effect remounts).
const teardowns = new WeakMap<SupabaseClient, Promise<void>>();

/** Broadcasts only wake checked reads; authentication and RPCs remain authoritative. */
export function watchBoardChanges(
  client: SupabaseClient,
  wake: () => void,
  health: (healthy: boolean) => void = () => {},
): () => void {
  health(false);
  let active = true;
  let generation = 0;
  let owner: string | undefined;
  let channel: RealtimeChannel | undefined;
  let authEvents = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!active || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (active) wake();
    }, 80);
  };
  const close = () => {
    generation += 1;
    health(false);
    const previous = channel;
    channel = undefined;
    owner = undefined;
    clearTimeout(timer);
    timer = undefined;
    const pending = teardowns.get(client) ?? Promise.resolve();
    if (!previous) return pending;
    const removing = Promise.all([pending, client.removeChannel(previous).catch(() => {})]).then(
      () => {},
    );
    teardowns.set(client, removing);
    return removing;
  };
  const connect = async (session: Session | null) => {
    if (!active) return;
    let id: string | undefined;
    try {
      id = session?.user.id ? validateUuid(session.user.id, 'Session ID') : undefined;
    } catch {
      close();
      return;
    }
    if (id && owner === id && channel) {
      const request = generation;
      await client.realtime.setAuth(session!.access_token).catch(() => {
        if (active && request === generation) health(false);
      });
      return;
    }
    const teardown = close();
    if (!id || !session) return;
    const request = generation;
    try {
      await teardown;
      if (!active || request !== generation) return;
      await client.realtime.setAuth(session.access_token);
      if (!active || request !== generation) return;
      owner = id;
      channel = client
        .channel(`pinboard:user:${id}`, { config: { private: true } })
        .on('broadcast', { event: 'board_changed' }, (message) => {
          if (!active || request !== generation) return;
          const payload = message?.payload;
          if (
            !payload ||
            typeof payload !== 'object' ||
            !Number.isSafeInteger(payload.revision) ||
            payload.revision < 1
          )
            return;
          try {
            validateUuid(payload.id, 'Board ID');
            schedule();
          } catch {
            // Ignore malformed hints; the next poll still catches up.
          }
        })
        .subscribe((status) => {
          if (!active || request !== generation) return;
          health(status === 'SUBSCRIBED');
          if (status === 'SUBSCRIBED') schedule();
        });
    } catch {
      // Optional live delivery must never prevent normal polling or queued saves.
    }
  };
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    authEvents += 1;
    // Auth callbacks must return before calling another Supabase API.
    queueMicrotask(() => void connect(session));
  });
  void client.auth
    .getSession()
    .then(({ data: saved, error }) => {
      if (!error && authEvents === 0) void connect(saved.session);
    })
    .catch(() => {});
  return () => {
    active = false;
    data.subscription.unsubscribe();
    close();
  };
}
