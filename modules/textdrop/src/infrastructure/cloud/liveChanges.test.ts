import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { listenForChanges } from './liveChanges';

afterEach(() => vi.useRealTimers());
it('coalesces private invalidations, repairs reconnect gaps and cleans up old identities', async () => {
  vi.useFakeTimers();
  let auth!: (_event: string, session: { user: { id: string } } | null) => void;
  const channels: { message?: () => void; status?: (status: string) => void; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }[] = [];
  const unsubscribe = vi.fn();
  const client = {
    auth: {
      onAuthStateChange: (handler: typeof auth) => {
        auth = handler;
        return { data: { subscription: { unsubscribe } } };
      },
    },
    channel: vi.fn(() => {
      const channel = { on: vi.fn(), subscribe: vi.fn(), message: undefined as (() => void) | undefined, status: undefined as ((status: string) => void) | undefined };
      channel.on.mockImplementation((_kind, _filter, listener) => {
        channel.message = listener;
        return channel;
      });
      channel.subscribe.mockImplementation(listener => {
        channel.status = listener;
        return channel;
      });
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async () => 'ok'),
  };
  const changed = vi.fn();
  const health = vi.fn();
  const dispose = listenForChanges(client as unknown as SupabaseClient, changed, health);
  auth('INITIAL_SESSION', { user: { id: 'first' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledWith('textdrop:user:first', { config: { private: true } });
  expect(health.mock.calls.every(([healthy]) => healthy === false)).toBe(true);
  channels[0]!.status!('SUBSCRIBED');
  expect(health).toHaveBeenLastCalledWith(true);
  channels[0]!.message!();
  channels[0]!.message!();
  await vi.advanceTimersByTimeAsync(100);
  expect(changed).toHaveBeenCalledTimes(1);
  channels[0]!.status!('SUBSCRIBED');
  await vi.advanceTimersByTimeAsync(100);
  expect(changed).toHaveBeenCalledTimes(2);
  for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
    channels[0]!.status!(status);
    expect(health).toHaveBeenLastCalledWith(false);
    channels[0]!.status!('SUBSCRIBED');
    expect(health).toHaveBeenLastCalledWith(true);
  }
  auth('SIGNED_IN', { user: { id: 'second' } });
  expect(health).toHaveBeenLastCalledWith(false);
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.message!();
  await vi.advanceTimersByTimeAsync(100);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
  channels[1]!.message!();
  dispose();
  expect(health).toHaveBeenLastCalledWith(false);
  channels[1]!.status!('SUBSCRIBED');
  expect(health).toHaveBeenLastCalledWith(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(client.removeChannel).toHaveBeenCalledWith(channels[1]);
});

it('waits for SDK topic removal before recreating a watcher after rapid hide/show', async () => {
  vi.useFakeTimers();
  let auth!: (_event: string, session: { user: { id: string } }) => void;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const topics = new Map<string, object>();
  const client = {
    auth: {
      onAuthStateChange: (handler: typeof auth) => {
        auth = handler;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    channel: vi.fn((topic: string) => {
      const existing = topics.get(topic);
      if (existing) return existing;
      const channel = { on: vi.fn(), subscribe: vi.fn() };
      channel.on.mockReturnValue(channel);
      channel.subscribe.mockReturnValue(channel);
      topics.set(topic, channel);
      return channel;
    }),
    removeChannel: vi
      .fn()
      .mockImplementationOnce(async () => {
        await pending;
        topics.clear();
        return 'ok';
      })
      .mockResolvedValue('ok'),
  };
  const first = listenForChanges(client as unknown as SupabaseClient, vi.fn());
  auth('INITIAL_SESSION', { user: { id: 'same' } });
  await vi.advanceTimersByTimeAsync(0);
  first();
  const second = listenForChanges(client as unknown as SupabaseClient, vi.fn());
  auth('INITIAL_SESSION', { user: { id: 'same' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(2);
  expect(client.channel.mock.results[1]!.value).not.toBe(client.channel.mock.results[0]!.value);
  second();
});
