import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefreshResult } from './PageSession';
import { RefreshScheduler } from './refreshScheduler';

const seconds = (count: number) => count * 1000;
let visible: boolean;
let outcomes: RefreshResult[];
let times: number[];
let scheduler: RefreshScheduler;
const refresh = vi.fn(async (): Promise<RefreshResult> => {
  times.push(Date.now() / 1000);
  return outcomes.shift() ?? 'unchanged';
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  visible = true;
  outcomes = [];
  times = [];
  refresh.mockClear();
  scheduler = new RefreshScheduler(refresh, () => visible);
});
afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

describe('page refresh schedule', () => {
  it('uses minute reconciliation while healthy without typing postponing the bounded poll', async () => {
    scheduler.start();
    scheduler.setLiveHealthy(true);
    for (let second = 0; second < 59; second++) {
      scheduler.activity();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(times).toEqual([60]);
    await scheduler.wake(true);
    expect(times).toEqual([60, 60]);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.setLiveHealthy(false);
    scheduler.activity();
    await vi.advanceTimersByTimeAsync(2999);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('restores fast reconciliation when live health fails during a read and retains failure backoff', async () => {
    let finish!: (result: RefreshResult) => void;
    refresh.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    scheduler.start();
    scheduler.setLiveHealthy(true);
    const reading = scheduler.wake();
    scheduler.setLiveHealthy(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish('unchanged');
    await reading;
    await vi.advanceTimersByTimeAsync(2999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    outcomes.push('failed', 'unchanged');
    scheduler.setLiveHealthy(true);
    await scheduler.wake(true);
    const failedAt = times.at(-1)!;
    await vi.advanceTimersByTimeAsync(5999);
    expect(times.at(-1)).toBe(failedAt);
    await vi.advanceTimersByTimeAsync(1);
    expect(times.at(-1)).toBe(failedAt + 6);
    const before = times.length;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(times).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(before + 1);
  });

  it('asks for newer text every 3 seconds while the page is in use', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(3) - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toEqual([3]);
    await vi.advanceTimersByTimeAsync(seconds(9));
    expect(times).toEqual([3, 6, 9, 12]);
  });

  it('slows down after a quiet minute and again after five quiet minutes', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(60));
    expect(times).toHaveLength(20);
    expect(times.at(-1)).toBe(60);
    await vi.advanceTimersByTimeAsync(seconds(240));
    expect(times.slice(20).map((time, index) => time - (times[19 + index] ?? 0))).toEqual(Array.from({ length: 24 }, () => 10));
    expect(times.at(-1)).toBe(300);
    await vi.advanceTimersByTimeAsync(seconds(90));
    expect(times.slice(-3)).toEqual([330, 360, 390]);
  });

  it('goes back to the quick pace when another device changed the text', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(100));
    expect(times.slice(-2)).toEqual([90, 100]);
    outcomes.push('changed');
    await vi.advanceTimersByTimeAsync(seconds(10));
    expect(times.slice(-1)).toEqual([110]);
    await vi.advanceTimersByTimeAsync(seconds(9));
    expect(times.slice(-3)).toEqual([113, 116, 119]);
  });

  it('speeds up a slow schedule as soon as the user does something', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(320));
    expect(times.at(-1)).toBe(300);
    const before = times.length;
    scheduler.activity();
    await vi.advanceTimersByTimeAsync(seconds(3));
    expect(times.length).toBe(before + 1);
    expect(times.at(-1)).toBe(323);
    // Typing keeps the quick pace without restarting the timer on every keystroke.
    for (let step = 0; step < 5; step += 1) {
      scheduler.activity();
      await vi.advanceTimersByTimeAsync(seconds(1));
    }
    expect(times.at(-1)).toBe(326);
  });

  it('waits longer after each failed request and recovers after one success', async () => {
    outcomes.push('failed', 'failed', 'failed', 'unchanged');
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(51));
    // 3 s, then 6, 12 and 24 s after the failures, then back to 3 s.
    expect(times).toEqual([3, 9, 21, 45, 48, 51]);
  });

  it('never waits more than 30 seconds between failed requests', async () => {
    outcomes.push(...Array.from({ length: 8 }, (): RefreshResult => 'failed'));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(200));
    const gaps = times.slice(1).map((time, index) => time - times[index]!);
    expect(gaps.slice(0, 6)).toEqual([6, 12, 24, 30, 30, 30]);
  });

  it('does not ask while the page is hidden and resumes when it is visible again', async () => {
    scheduler.start();
    visible = false;
    await vi.advanceTimersByTimeAsync(seconds(30));
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    await vi.advanceTimersByTimeAsync(seconds(3));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('asks at once when woken, treats it as activity and shares one request between wake-ups', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(120));
    const before = times.length;
    const first = scheduler.wake();
    const second = scheduler.wake();
    await Promise.all([first, second]);
    expect(times.length).toBe(before + 1);
    expect(times.at(-1)).toBe(120);
    await vi.advanceTimersByTimeAsync(seconds(3));
    expect(times.at(-1)).toBe(123);
  });

  it('keeps backing off when a wake-up request fails', async () => {
    scheduler.start();
    outcomes.push('failed', 'failed');
    await scheduler.wake();
    await vi.advanceTimersByTimeAsync(seconds(6));
    expect(times).toEqual([0, 6]);
    await vi.advanceTimersByTimeAsync(seconds(11));
    expect(times).toEqual([0, 6]);
    await vi.advanceTimersByTimeAsync(seconds(1));
    expect(times).toEqual([0, 6, 18]);
  });

  it('keeps the pace when there was nothing to ask', async () => {
    outcomes.push('skipped', 'skipped', 'failed', 'skipped', 'skipped');
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(9));
    expect(times).toEqual([3, 6, 9]);
    await vi.advanceTimersByTimeAsync(seconds(18));
    // The failure at 9 s slows the pace to 6 s; skipped polls neither add to it nor clear it.
    expect(times).toEqual([3, 6, 9, 15, 21, 27]);
  });

  it('stops for good, also for a request that finishes afterwards', async () => {
    let finish!: (result: RefreshResult) => void;
    refresh.mockImplementationOnce(
      () =>
        new Promise<RefreshResult>(done => {
          finish = done;
        }),
    );
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(3));
    scheduler.stop();
    finish('changed');
    await vi.advanceTimersByTimeAsync(seconds(60));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    void scheduler.wake();
    scheduler.activity();
    await vi.advanceTimersByTimeAsync(seconds(60));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats a request that throws like a failed one', async () => {
    refresh.mockRejectedValueOnce(new Error('Unexpected'));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(seconds(3));
    await vi.advanceTimersByTimeAsync(seconds(6));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

it('catches up once when a live notification arrives during an active read', async () => {
  let finish!: (value: RefreshResult) => void;
  refresh.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  scheduler.start();
  const current = scheduler.wake();
  void scheduler.wake(true);
  void scheduler.wake(true);
  finish('unchanged');
  await current;
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
});
