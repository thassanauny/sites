import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { watchBoardChanges } from "../src/infrastructure/cloud/live";

const user = "11111111-1111-4111-8111-111111111111";
const board = "22222222-2222-4222-8222-222222222222";
let browser: EventTarget;
let page: EventTarget & { hidden: boolean };
let connection: { onLine: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  browser = new EventTarget();
  page = Object.assign(new EventTarget(), { hidden: false });
  connection = { onLine: true };
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", page);
  vi.stubGlobal("navigator", connection);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture() {
  const refresh = vi.fn();
  const channels: { message: (value: unknown) => void; status: (value: string) => void; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }[] = [];
  const channel = vi.fn(() => {
    const live = {
      message: (_value: unknown) => {}, status: (_value: string) => {},
      on: vi.fn((_type, _filter, receive) => { live.message = receive; return live; }),
      subscribe: vi.fn(receive => { live.status = receive; return live; }),
    };
    channels.push(live);
    return live;
  });
  const removeChannel = vi.fn().mockResolvedValue("ok");
  const client = { channel, removeChannel } as unknown as SupabaseClient;
  return { refresh, channels, channel, removeChannel, client };
}

describe("private board invalidation", () => {
  it("keeps bounded reconciliation while healthy and restores fast polls on every transport failure", async () => {
    const f = fixture();
    const health = vi.fn();
    const stop = watchBoardChanges(f.client, user, f.refresh, () => 0, health);
    expect(health).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    const live = f.channels[0];
    live.status("SUBSCRIBED");
    expect(health).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_949);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.refresh).toHaveBeenCalledTimes(3);
    for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
      live.status("SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(50);
      f.refresh.mockClear();
      live.status(status);
      expect(health).toHaveBeenLastCalledWith(false);
      await vi.advanceTimersByTimeAsync(9999);
      expect(f.refresh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(f.refresh).toHaveBeenCalledTimes(1);
    }
    live.status("SUBSCRIBED");
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(health).toHaveBeenLastCalledWith(false);
    f.refresh.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.refresh).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one identity topic, coalesces hints and catches up after each subscription", () => {
    const f = fixture();
    const stop = watchBoardChanges(f.client, user, f.refresh, () => 1);
    expect(f.channel).toHaveBeenCalledWith(`blueprint:user:${user}`, { config: { private: true } });
    const live = f.channels[0];
    expect(live.on).toHaveBeenCalledWith("broadcast", { event: "changed" }, expect.any(Function));
    live.status("SUBSCRIBED");
    live.message({ payload: { id: board, revision: 2 } });
    live.message({ payload: { id: board, revision: 2 } });
    live.message({ payload: { id: board, revision: 3 } });
    vi.advanceTimersByTime(50);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    live.message({ payload: { id: board, revision: 3 } });
    live.message({ payload: { id: board, revision: 1 } });
    vi.advanceTimersByTime(100);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    live.status("SUBSCRIBED");
    vi.advanceTimersByTime(50);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores malformed hints and leaves delivery failures to compact polling", () => {
    const f = fixture();
    const stop = watchBoardChanges(f.client, user, f.refresh, () => 0);
    for (const payload of [null, {}, { id: "not-a-board", revision: 3 }, { id: board, revision: "2" }, { id: board, revision: -1 }])
      f.channels[0].message({ payload });
    f.channels[0].status("CHANNEL_ERROR");
    f.channels[0].status("TIMED_OUT");
    vi.advanceTimersByTime(1000);
    expect(f.refresh).not.toHaveBeenCalled();
    stop();
  });

  it("releases hidden/offline channels, ignores late hints and catches up when shown again", async () => {
    const f = fixture();
    const stop = watchBoardChanges(f.client, user, f.refresh, () => 0);
    const old = f.channels[0];
    old.message({ payload: { id: board, revision: 1 } });
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(f.removeChannel).toHaveBeenCalledWith(old);
    old.status("SUBSCRIBED");
    old.message({ payload: { id: board, revision: 2 } });
    vi.advanceTimersByTime(100);
    expect(f.refresh).not.toHaveBeenCalled();
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(50);
    expect(f.channels).toHaveLength(2);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    connection.onLine = false;
    browser.dispatchEvent(new Event("offline"));
    expect(f.removeChannel).toHaveBeenCalledWith(f.channels[1]);
    connection.onLine = true;
    browser.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(50);
    expect(f.channels).toHaveLength(3);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("cancels all owned work on session change or unmount", () => {
    const f = fixture();
    const stop = watchBoardChanges(f.client, user, f.refresh, () => 0);
    f.channels[0].message({ payload: { id: board, revision: 1 } });
    stop();
    browser.dispatchEvent(new Event("online"));
    page.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.channel).toHaveBeenCalledTimes(1);
    expect(f.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("waits for topic teardown across rapid hide/show and watcher replacement", async () => {
    const f = fixture();
    const cached = new Map<string, unknown>();
    const freshChannel = f.channel.getMockImplementation()!;
    f.channel.mockImplementation((topic: string) => {
      if (!cached.has(topic)) cached.set(topic, freshChannel());
      return cached.get(topic) as ReturnType<typeof freshChannel>;
    });
    let release!: () => void;
    f.removeChannel.mockImplementation(() => new Promise<void>(resolve => {
      release = () => { cached.clear(); resolve(); };
    }));
    const stop = watchBoardChanges(f.client, user, f.refresh, () => 0);
    expect(f.channels).toHaveLength(1);
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(f.channel).toHaveBeenCalledTimes(1);
    stop();
    const replacement = watchBoardChanges(f.client, user, f.refresh, () => 0);
    expect(f.channel).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.channels).toHaveLength(2);
    expect(f.channel).toHaveBeenCalledTimes(2);
    f.channels[1].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(50);
    expect(f.refresh).toHaveBeenCalled();
    replacement();
    release();
  });

  it("retains fast fallback polls when channel creation fails after delayed teardown", async () => {
    const f = fixture();
    let release!: () => void;
    f.removeChannel.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const stop = watchBoardChanges(f.client, user, f.refresh, () => 0);
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    f.channel.mockImplementationOnce(() => { throw new Error("Realtime unavailable"); });
    release();
    await vi.advanceTimersByTimeAsync(50);
    f.refresh.mockClear();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
