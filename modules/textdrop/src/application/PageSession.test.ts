import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionDamagedError, type TextDropPage } from '../domain/snippets/model';
import { PageSession } from './PageSession';
import type { Cloud, DraftRecovery } from './ports';

const id = '11111111-1111-4111-8111-111111111111';
const code = '0123456789abcdef0123456789abcdef';
function page(text = '', version = 1): TextDropPage {
  return { id, code, text, version, updatedAt: '2026-10-10T10:00:00Z' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(maxWait?: number) {
  const cloud: Cloud = {
    createPage: vi.fn(async () => page()),
    joinPage: vi.fn(async () => page()),
    pollPage: vi.fn(async () => page()),
    savePage: vi.fn(async (_id: string, text: string) => page(text, 2)),
    startNewSession: vi.fn(async () => {}),
  };
  const session = new PageSession(cloud, 50, maxWait);
  return { cloud, session };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('online page session', () => {
  it('keeps text and its recovery copy typed while accepting the shared conflict version', async () => {
    vi.useFakeTimers();
    const { cloud } = setup();
    const shared = page('Other person’s text', 2);
    cloud.joinPage = vi.fn(async () => ({ ...page('Queued text'), localPending: true, localConflict: shared }));
    const accepted = deferred<TextDropPage>();
    cloud.acceptSharedPage = vi.fn(() => accepted.promise);
    cloud.saveCheckedPage = vi.fn(async (_id, text) => page(text, 3));
    const recovery: DraftRecovery = { read: vi.fn(), write: vi.fn(), clear: vi.fn() };
    const session = new PageSession(cloud, 50, 10_000, recovery);
    await session.join(code);
    const accepting = session.acceptShared();
    session.edit('Newer text entered while choosing');
    accepted.resolve(shared);
    await accepting;
    expect(session.state).toMatchObject({ page: shared, draft: 'Newer text entered while choosing', dirty: true });
    expect(recovery.clear).not.toHaveBeenCalled();
    expect(recovery.write).toHaveBeenLastCalledWith(expect.objectContaining({ id }), 'Newer text entered while choosing');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cloud.savePage).not.toHaveBeenCalled();
    expect(cloud.saveCheckedPage).not.toHaveBeenCalled();
    await session.save();
    expect(cloud.saveCheckedPage).toHaveBeenCalledExactlyOnceWith(id, 'Newer text entered while choosing', { baseVersion: shared.version, baseText: shared.text, resolveConflict: false });
    session.dispose();
  });

  it('debounces edits and confirms text only after a successful save', async () => {
    vi.useFakeTimers();
    const { cloud, session } = setup();
    await session.join(code);
    session.edit('first');
    await vi.advanceTimersByTimeAsync(30);
    session.edit('latest');
    await vi.advanceTimersByTimeAsync(49);
    expect(cloud.savePage).not.toHaveBeenCalled();
    expect(session.state.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(id, 'latest');
    expect(session.state.draft).toBe('latest');
    expect(session.state.dirty).toBe(false);
    session.dispose();
  });

  it('serializes saves and preserves new edits made during an upload', async () => {
    vi.useFakeTimers();
    const { cloud, session } = setup();
    const first = deferred<TextDropPage>();
    vi.mocked(cloud.savePage).mockReturnValueOnce(first.promise).mockResolvedValueOnce(page('second', 3));
    await session.join(code);
    session.edit('first');
    const saving = session.save();
    session.edit('second');
    await vi.advanceTimersByTimeAsync(100);
    expect(cloud.savePage).toHaveBeenCalledTimes(1);
    first.resolve(page('first', 2));
    await saving;
    expect(session.state.draft).toBe('second');
    expect(session.state.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(cloud.savePage).toHaveBeenNthCalledWith(2, id, 'second');
    expect(session.state.dirty).toBe(false);
    expect(session.state.page?.text).toBe('second');
    session.dispose();
  });

  it('keeps a newer poll when an older save response arrives afterward', async () => {
    const { cloud, session } = setup();
    const saving = deferred<TextDropPage>();
    vi.mocked(cloud.savePage).mockReturnValueOnce(saving.promise);
    vi.mocked(cloud.pollPage).mockResolvedValueOnce(page('later browser save', 3));
    await session.join(code);
    session.edit('my text');
    const saved = session.save();
    await session.refresh();
    expect(session.state.draft).toBe('my text');
    saving.resolve(page('my text', 2));
    await saved;
    expect(session.state.page?.version).toBe(3);
    expect(session.state.draft).toBe('later browser save');
    expect(session.state.dirty).toBe(false);
    session.dispose();
  });

  it('rejects an older poll response after a newer save', async () => {
    const { cloud, session } = setup();
    const refresh = deferred<TextDropPage>();
    vi.mocked(cloud.pollPage).mockReturnValueOnce(refresh.promise);
    await session.join(code);
    const refreshing = session.refresh();
    session.edit('latest');
    await session.save();
    refresh.resolve(page('outdated'));
    await refreshing;
    expect(session.state.draft).toBe('latest');
    expect(session.state.page?.version).toBe(2);
    session.dispose();
  });

  it('coalesces slow polls and allows another refresh after a failed request', async () => {
    const { cloud, session } = setup();
    const pending = deferred<TextDropPage>();
    vi.mocked(cloud.pollPage).mockReturnValueOnce(pending.promise);
    await session.join(code);
    const polls = [session.refresh(), session.refresh(), session.refresh()];
    await Promise.resolve();
    expect(cloud.pollPage).toHaveBeenCalledTimes(1);
    pending.reject(new Error('Connection lost'));
    await Promise.all(polls);
    expect(session.state.error).toBe('Connection lost');
    vi.mocked(cloud.pollPage).mockResolvedValueOnce(page('Latest shared text', 2));
    await session.refresh();
    expect(cloud.pollPage).toHaveBeenCalledTimes(2);
    expect(session.state.draft).toBe('Latest shared text');
    expect(session.state.error).toBe('');
    session.dispose();
  });

  it('reports what a refresh found and notifies listeners only when something changed', async () => {
    const { cloud, session } = setup();
    await session.join(code);
    const listener = vi.fn();
    session.subscribe(listener);
    listener.mockClear();
    await expect(session.refresh()).resolves.toBe('unchanged');
    await expect(session.refresh()).resolves.toBe('unchanged');
    expect(listener).not.toHaveBeenCalled();

    vi.mocked(cloud.pollPage).mockResolvedValueOnce(page('Newer text', 2));
    await expect(session.refresh()).resolves.toBe('changed');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.state.draft).toBe('Newer text');

    vi.mocked(cloud.pollPage).mockRejectedValueOnce(new Error('Connection lost'));
    await expect(session.refresh()).resolves.toBe('failed');
    expect(session.state.error).toBe('Connection lost');
    listener.mockClear();
    vi.mocked(cloud.pollPage).mockResolvedValueOnce(page('Newer text', 2));
    await expect(session.refresh()).resolves.toBe('unchanged');
    expect(session.state.error).toBe('');
    expect(listener).toHaveBeenCalledTimes(1);
    await session.refresh();
    expect(listener).toHaveBeenCalledTimes(1);

    session.setOnline(false);
    await expect(session.refresh()).resolves.toBe('skipped');
    session.home();
    await expect(session.refresh()).resolves.toBe('skipped');
    session.dispose();
  });

  it('does not report a result for a poll that a newer page replaced', async () => {
    const { cloud, session } = setup();
    const slow = deferred<TextDropPage>();
    vi.mocked(cloud.pollPage).mockReturnValueOnce(slow.promise);
    await session.join(code);
    const polling = session.refresh();
    await Promise.resolve();
    session.home();
    slow.reject(new Error('Too late'));
    await expect(polling).resolves.toBe('skipped');
    expect(session.state.error).toBe('');
    session.dispose();
  });

  it('ignores a failed older poll after a newer save confirms sync', async () => {
    const { cloud, session } = setup();
    const pending = deferred<TextDropPage>();
    vi.mocked(cloud.pollPage).mockReturnValueOnce(pending.promise);
    await session.join(code);
    const polling = session.refresh();
    await Promise.resolve();
    session.edit('Saved after the poll started');
    await session.save();
    pending.reject(new Error('Old failed poll'));
    await polling;
    expect(session.state.page?.version).toBe(2);
    expect(session.state.draft).toBe('Saved after the poll started');
    expect(session.state.dirty).toBe(false);
    expect(session.state.error).toBe('');
    session.dispose();
  });

  it('starts a new navigation poll without an obsolete request clearing its in-flight guard', async () => {
    const { cloud, session } = setup();
    const obsolete = deferred<TextDropPage>();
    const current = deferred<TextDropPage>();
    vi.mocked(cloud.pollPage).mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(current.promise);
    await session.join(code);
    const oldPolling = session.refresh();
    await Promise.resolve();
    session.home();
    await session.join(code);
    const newPolling = session.refresh();
    await Promise.resolve();
    expect(cloud.pollPage).toHaveBeenCalledTimes(2);
    obsolete.reject(new Error('Old page failure'));
    await oldPolling;
    const duplicate = session.refresh();
    await Promise.resolve();
    expect(cloud.pollPage).toHaveBeenCalledTimes(2);
    expect(session.state.error).toBe('');
    current.resolve(page('Current page', 2));
    await Promise.all([newPolling, duplicate]);
    expect(session.state.draft).toBe('Current page');
    session.dispose();
  });

  it('retains a failed draft without automatically retrying or replacing it', async () => {
    vi.useFakeTimers();
    const { cloud, session } = setup();
    vi.mocked(cloud.savePage).mockRejectedValueOnce(new Error('Connection lost'));
    vi.mocked(cloud.pollPage).mockResolvedValueOnce(page('other browser', 3));
    await session.join(code);
    session.edit('keep this');
    await session.save();
    await session.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cloud.savePage).toHaveBeenCalledTimes(1);
    expect(session.state.draft).toBe('keep this');
    expect(session.state.error).toBe('Connection lost');
    expect(session.state.dirty).toBe(true);
    vi.mocked(cloud.savePage).mockResolvedValueOnce(page('keep this', 4));
    await session.save();
    expect(session.state.page?.text).toBe('keep this');
    expect(session.state.dirty).toBe(false);
    session.dispose();
  });

  it('pauses saves offline and requires retry on reconnection', async () => {
    vi.useFakeTimers();
    const { cloud, session } = setup();
    await session.join(code);
    session.edit('pending');
    session.setOnline(false);
    session.edit('offline change');
    await vi.advanceTimersByTimeAsync(100);
    await session.save();
    expect(cloud.savePage).not.toHaveBeenCalled();
    expect(session.state.draft).toBe('pending');
    session.setOnline(true);
    expect(session.state.error).toMatch(/choose Retry save/);
    await vi.advanceTimersByTimeAsync(100);
    expect(cloud.savePage).not.toHaveBeenCalled();
    await session.save();
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(id, 'pending');
    session.dispose();
  });

  it('ignores obsolete navigation, load and save responses', async () => {
    const { cloud, session } = setup();
    const joining = deferred<TextDropPage>();
    vi.mocked(cloud.joinPage).mockReturnValueOnce(joining.promise);
    const opening = session.join(code);
    session.home();
    joining.resolve(page());
    expect(await opening).toBe(false);
    expect(session.state.phase).toBe('home');
    await session.join(code);
    const pending = deferred<TextDropPage>();
    vi.mocked(cloud.savePage).mockReturnValueOnce(pending.promise);
    session.edit('old page');
    const saving = session.save();
    await Promise.resolve();
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(id, 'old page');
    session.home();
    pending.resolve(page('old page', 2));
    await saving;
    expect(session.state.page).toBeNull();
    expect(session.state.draft).toBe('');
    session.dispose();
  });

  it('does not launch queued writes after returning home or disposing the session', async () => {
    for (const stop of ['home', 'dispose'] as const) {
      const { cloud, session } = setup();
      await session.join(code);
      session.edit('Discard this text');
      const saving = session.save();
      session[stop]();
      await saving;
      expect(cloud.savePage).not.toHaveBeenCalled();
      session.dispose();
    }
  });

  it('does not launch a queued write after going offline and keeps it available to retry', async () => {
    const { cloud, session } = setup();
    await session.join(code);
    session.edit('Retry after reconnecting');
    const saving = session.save();
    session.setOnline(false);
    await saving;
    expect(cloud.savePage).not.toHaveBeenCalled();
    expect(session.state.phase).toBe('ready');
    expect(session.state.dirty).toBe(true);
    expect(session.state.draft).toBe('Retry after reconnecting');
    session.setOnline(true);
    await session.save();
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(id, 'Retry after reconnecting');
    expect(session.state.dirty).toBe(false);
    session.dispose();
  });

  it('reuses the creation ID after a lost response', async () => {
    const { cloud, session } = setup();
    vi.mocked(cloud.createPage).mockRejectedValueOnce(new Error('Response lost'));
    expect(await session.create()).toBe(false);
    expect(await session.create()).toBe(true);
    const calls = vi.mocked(cloud.createPage).mock.calls;
    expect(calls[0]![0]).toBe(calls[1]![0]);
    session.dispose();
  });

  it('uses secure random bytes when randomUUID is unavailable and retains that ID for retry', async () => {
    const randomBytes = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues: randomBytes });
    const { cloud, session } = setup();
    vi.mocked(cloud.createPage).mockRejectedValueOnce(new Error('Response lost'));
    expect(await session.create()).toBe(false);
    expect(await session.create()).toBe(true);
    const expected = '00010203-0405-4607-8809-0a0b0c0d0e0f';
    expect(vi.mocked(cloud.createPage).mock.calls.map(([createdId]) => createdId)).toEqual([expected, expected]);
    expect(randomBytes).toHaveBeenCalledTimes(1);
    expect(session.state.error).toBe('');
    session.dispose();
  });

  it('reports a thrown UUID generator without sending a create request and permits a later retry', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('Random generator failed');
      },
    });
    const { cloud, session } = setup();
    expect(await session.create()).toBe(false);
    expect(cloud.createPage).not.toHaveBeenCalled();
    expect(session.state.error).toMatch(/Could not create a snippet/);
    vi.stubGlobal('crypto', { randomUUID: () => id });
    expect(await session.create()).toBe(true);
    expect(cloud.createPage).toHaveBeenCalledExactlyOnceWith(id);
    expect(session.state.error).toBe('');
    session.dispose();
  });

  it('reports missing or denied secure random bytes without contacting Supabase', async () => {
    for (const randomness of [
      undefined,
      {},
      {
        getRandomValues: () => {
          throw new Error('Random bytes unavailable');
        },
      },
    ]) {
      vi.stubGlobal('crypto', randomness);
      const { cloud, session } = setup();
      expect(await session.create()).toBe(false);
      expect(cloud.createPage).not.toHaveBeenCalled();
      expect(session.state.error).toMatch(/HTTPS/);
      expect(session.state.phase).toBe('home');
      session.dispose();
    }
  });

  it('shows invalid-text errors without making a save request', async () => {
    const { cloud, session } = setup();
    await session.join(code);
    session.edit('bad\u0000text');
    await session.save();
    expect(cloud.savePage).not.toHaveBeenCalled();
    expect(session.state.error).toMatch(/cannot be saved/);
    expect(session.state.draft).toBe('bad\u0000text');
    session.dispose();
  });

  it('saves during continuous typing at the latest after the maximum wait', async () => {
    vi.useFakeTimers();
    const { cloud, session } = setup(200);
    await session.join(code);
    for (let elapsed = 0; elapsed < 500; elapsed += 20) {
      session.edit(`typing ${elapsed}`);
      await vi.advanceTimersByTimeAsync(20);
    }
    // Keystrokes arrive faster than the 50 ms debounce, yet each 200 ms burst is sent.
    expect(vi.mocked(cloud.savePage).mock.calls.map(([, text]) => text)).toEqual(['typing 180', 'typing 380']);
    await vi.advanceTimersByTimeAsync(50);
    expect(cloud.savePage).toHaveBeenLastCalledWith(id, 'typing 480');
    expect(session.state.dirty).toBe(false);
    session.dispose();
  });

  it('flushes the pending edit at once but never retries a failed save on its own', async () => {
    vi.useFakeTimers();
    const { cloud, session } = setup();
    await session.join(code);
    await session.flush();
    expect(cloud.savePage).not.toHaveBeenCalled();
    session.edit('typed just before hiding');
    await session.flush();
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(id, 'typed just before hiding');
    expect(session.state.dirty).toBe(false);
    await session.flush();
    expect(cloud.savePage).toHaveBeenCalledTimes(1);
    vi.mocked(cloud.savePage).mockRejectedValueOnce(new Error('Connection lost'));
    session.edit('keep this');
    await session.save();
    await session.flush();
    expect(cloud.savePage).toHaveBeenCalledTimes(2);
    expect(session.state.error).toBe('Connection lost');
    expect(session.state.dirty).toBe(true);
    session.dispose();
  });

  it('sends an edit made during a save right after that save when the page is hidden', async () => {
    vi.useFakeTimers();
    const { cloud, session } = setup();
    const saving = deferred<TextDropPage>();
    vi.mocked(cloud.savePage).mockReturnValueOnce(saving.promise);
    await session.join(code);
    session.edit('first');
    void session.save();
    await vi.advanceTimersByTimeAsync(0);
    session.edit('second');
    const flushed = session.flush();
    saving.resolve(page('first', 2));
    await flushed;
    // No debounce wait: the hidden page may be frozen before another timer could fire.
    expect(vi.mocked(cloud.savePage).mock.calls.map(([, text]) => text)).toEqual(['first', 'second']);
    expect(session.state.dirty).toBe(false);
    await session.flush();
    expect(cloud.savePage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('allows retry after a synchronous service failure', async () => {
    const { cloud, session } = setup();
    vi.mocked(cloud.savePage).mockImplementationOnce(() => {
      throw new Error('Failed immediately');
    });
    await session.join(code);
    session.edit('retry me');
    await session.save();
    expect(session.state.error).toBe('Failed immediately');
    await session.save();
    expect(cloud.savePage).toHaveBeenCalledTimes(2);
    expect(session.state.dirty).toBe(false);
    session.dispose();
  });

  it('polls with the known version and treats null as unchanged', async () => {
    const { cloud, session } = setup();
    cloud.pollPage = vi.fn(async () => null);
    await session.join(code);
    await expect(session.refresh()).resolves.toBe('unchanged');
    expect(cloud.pollPage).toHaveBeenCalledWith(id, 1);
    expect(cloud.pollPage).toHaveBeenCalledTimes(1);
    vi.mocked(cloud.pollPage).mockResolvedValueOnce(page('Newer', 2));
    await expect(session.refresh()).resolves.toBe('changed');
    expect(session.state.draft).toBe('Newer');
    await session.refresh();
    expect(cloud.pollPage).toHaveBeenLastCalledWith(id, 2);
    session.dispose();
  });

  it('flags a damaged saved session until the error changes, and starts a new one on request', async () => {
    const { cloud, session } = setup();
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(new SessionDamagedError('Session is damaged.'));
    await session.join(code);
    expect(session.state).toMatchObject({ error: 'Session is damaged.', sessionDamaged: true });
    await expect(session.startNewSession()).resolves.toBe(true);
    expect(cloud.startNewSession).toHaveBeenCalledTimes(1);
    expect(session.state).toMatchObject({ error: '', sessionDamaged: false });
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(new Error('Other failure'));
    await session.join(code);
    expect(session.state).toMatchObject({ error: 'Other failure', sessionDamaged: false });
    session.dispose();
  });

  it('keeps offering a new session when starting one fails', async () => {
    const { cloud, session } = setup();
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(new SessionDamagedError('Session is damaged.'));
    await session.join(code);
    vi.mocked(cloud.startNewSession).mockRejectedValueOnce(new Error('Storage is full'));
    await expect(session.startNewSession()).resolves.toBe(false);
    expect(session.state).toMatchObject({ error: 'Storage is full', sessionDamaged: true });
    session.dispose();
  });
});
