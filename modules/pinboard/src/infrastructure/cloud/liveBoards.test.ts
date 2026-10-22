import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { watchBoardChanges } from './liveBoards';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const session = (id = user, token = 'token') => ({ user: { id }, access_token: token }) as Session;
function fixture() {
  let auth!: (event: string, session: Session | null) => void;
  const subscriptions: { receive: (message: unknown) => void; status: (value: string) => void }[] =
    [];
  const unsubscribe = vi.fn();
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
      onAuthStateChange: vi.fn((callback) => {
        auth = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
    },
    realtime: { setAuth: vi.fn(async () => {}) },
    removeChannel: vi.fn(async () => 'ok'),
    channel: vi.fn((_topic?: string) => {
      const subscription = { receive: (_message: unknown) => {}, status: (_status: string) => {} };
      subscriptions.push(subscription);
      const channel = {
        on: vi.fn((_type, _filter, callback) => {
          subscription.receive = callback;
          return channel;
        }),
        subscribe: vi.fn((callback) => {
          subscription.status = callback;
          return channel;
        }),
      };
      return channel;
    }),
  };
  const wake = vi.fn();
  const health = vi.fn();
  const watch = () => watchBoardChanges(client as unknown as SupabaseClient, wake, health);
  return {
    client,
    subscriptions,
    unsubscribe,
    wake,
    health,
    watch,
    auth: (value: Session | null, event = 'SIGNED_IN') => auth(event, value),
  };
}
async function settle() {
  for (let step = 0; step < 8; step += 1) await Promise.resolve();
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('private board invalidation', () => {
  it('reports health only after subscription and clears failed, replaced and stopped channels', async () => {
    const { subscriptions, health, watch, auth } = fixture();
    const stop = watch();
    await settle();
    expect(health.mock.calls.every(([healthy]) => healthy === false)).toBe(true);
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      subscriptions[0]!.status('SUBSCRIBED');
      expect(health).toHaveBeenLastCalledWith(true);
      subscriptions[0]!.status(status);
      expect(health).toHaveBeenLastCalledWith(false);
    }
    subscriptions[0]!.status('SUBSCRIBED');
    auth(session(other));
    await settle();
    expect(health).toHaveBeenLastCalledWith(false);
    const calls = health.mock.calls.length;
    subscriptions[0]!.status('SUBSCRIBED');
    expect(health).toHaveBeenCalledTimes(calls);
    subscriptions[1]!.status('SUBSCRIBED');
    stop();
    expect(health).toHaveBeenLastCalledWith(false);
    subscriptions[1]!.status('SUBSCRIBED');
    expect(health).toHaveBeenLastCalledWith(false);
  });

  it('subscribes to one private user topic and coalesces checked-read wakeups', async () => {
    const { client, subscriptions, wake, watch } = fixture();
    const stop = watch();
    await settle();
    expect(client.channel).toHaveBeenCalledExactlyOnceWith(`pinboard:user:${user}`, {
      config: { private: true },
    });
    expect(client.realtime.setAuth).toHaveBeenCalledWith('token');
    const subscription = subscriptions[0]!;
    subscription.status('SUBSCRIBED');
    subscription.receive({ payload: { id: other, revision: 2 } });
    subscription.receive({ payload: { id: other, revision: 3 } });
    await vi.advanceTimersByTimeAsync(80);
    expect(wake).toHaveBeenCalledTimes(1);
    subscription.receive({ payload: { id: other, revision: 4 } });
    await vi.advanceTimersByTimeAsync(80);
    expect(wake).toHaveBeenCalledTimes(2);
    stop();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
  it('ignores malformed hints and catches up when the channel reconnects', async () => {
    const { subscriptions, wake, watch } = fixture();
    const stop = watch();
    await settle();
    subscriptions[0]!.receive({ payload: { id: 'invalid', revision: 2 } });
    subscriptions[0]!.receive({ payload: { id: other, revision: 0 } });
    subscriptions[0]!.receive({ payload: { id: other, revision: Number.MAX_SAFE_INTEGER + 1 } });
    subscriptions[0]!.status('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(100);
    expect(wake).not.toHaveBeenCalled();
    subscriptions[0]!.status('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(80);
    expect(wake).toHaveBeenCalledTimes(1);
    subscriptions[0]!.status('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(80);
    expect(wake).toHaveBeenCalledTimes(2);
    stop();
  });
  it('closes the previous identity channel and ignores its late events', async () => {
    const { client, subscriptions, wake, watch, auth, unsubscribe } = fixture();
    const stop = watch();
    await settle();
    auth(session(other));
    await settle();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.channel).toHaveBeenLastCalledWith(`pinboard:user:${other}`, {
      config: { private: true },
    });
    subscriptions[0]!.receive({ payload: { id: other, revision: 2 } });
    await vi.advanceTimersByTimeAsync(80);
    expect(wake).not.toHaveBeenCalled();
    auth(session(other, 'refreshed'), 'TOKEN_REFRESHED');
    await settle();
    expect(client.channel).toHaveBeenCalledTimes(2);
    expect(client.realtime.setAuth).toHaveBeenLastCalledWith('refreshed');
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    subscriptions[1]!.status('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(80);
    expect(wake).not.toHaveBeenCalled();
  });
  it('cancels pending initialization and treats unavailable live delivery as optional', async () => {
    const first = fixture();
    const stop = first.watch();
    stop();
    await settle();
    expect(first.client.channel).not.toHaveBeenCalled();
    const second = fixture();
    second.client.realtime.setAuth.mockRejectedValueOnce(new Error('Live delivery unavailable'));
    const done = second.watch();
    await settle();
    expect(second.client.channel).not.toHaveBeenCalled();
    done();
  });
  it('does not replace a newer auth event with a delayed initial session read', async () => {
    const { client, auth, watch } = fixture();
    let release!: (value: { data: { session: Session }; error: null }) => void;
    client.auth.getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const stop = watch();
    auth(session(other));
    await settle();
    release({ data: { session: session() }, error: null });
    await settle();
    expect(client.channel).toHaveBeenCalledExactlyOnceWith(`pinboard:user:${other}`, {
      config: { private: true },
    });
    stop();
  });
  it('waits for same-topic teardown across watcher instances before subscribing again', async () => {
    const { client, subscriptions, watch } = fixture();
    const create = client.channel.getMockImplementation()!;
    const topics = new Map<string, ReturnType<typeof create>>();
    client.channel.mockImplementation((topic) => {
      const existing = topics.get(topic!);
      if (existing) return existing;
      const channel = create(topic);
      topics.set(topic!, channel);
      return channel;
    });
    let finish!: (value: string) => void;
    client.removeChannel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = (value) => {
            topics.clear();
            resolve(value);
          };
        }),
    );
    const first = watch();
    await settle();
    await settle();
    expect(subscriptions).toHaveLength(1);
    first();
    const second = watch();
    await settle();
    await settle();
    expect(subscriptions).toHaveLength(1);
    finish('ok');
    await settle();
    await settle();
    expect(subscriptions).toHaveLength(2);
    second();
  });
});
