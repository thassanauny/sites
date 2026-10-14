import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCK_WAIT_MS,
  migratePinboardSession,
  SESSION_CORRUPT_MESSAGE,
  SessionRecoveryError,
  startNewPinboardSession,
} from './migrateSession';

const locks = {
  request: vi.fn(async (_name: string, _options: unknown, callback: (lock: Lock) => unknown) =>
    callback({} as Lock),
  ),
} as unknown as Pick<LockManager, 'request'>;
const currentKey = 'pinboard-auth';
// This fixture exercises the one-time migration from the app's former name.
const legacyKey = 'kanban-auth';
const legacySession = JSON.stringify({
  access_token: 'legacy-token',
  refresh_token: 'legacy-refresh',
  expires_at: 4_000_000_000,
});

function storageFixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return { values, storage };
}

beforeEach(() => vi.clearAllMocks());

describe('Pinboard session migration', () => {
  it.each([
    'not JSON',
    'null',
    '[]',
    '{}',
    JSON.stringify({ access_token: 'token', refresh_token: 'refresh' }),
    JSON.stringify({
      access_token: '',
      refresh_token: 'refresh',
      expires_at: 4_000_000_000,
    }),
    JSON.stringify({
      access_token: 'token',
      refresh_token: 'refresh',
      expires_at: 'later',
    }),
  ])(
    'retains rejected original credentials without exposing them to the auth client: %s',
    async (raw) => {
      const { values, storage } = storageFixture({ [legacyKey]: raw });
      await expect(migratePinboardSession(storage, locks)).rejects.toThrow(
        /original credentials are preserved/i,
      );
      expect(values.get(legacyKey)).toBe(raw);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );

  it('retains credentials without copying when browser auth locks are unavailable', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    await expect(migratePinboardSession(storage, null)).rejects.toThrow(
      /original credentials are preserved/i,
    );
    expect(values.has(currentKey)).toBe(false);
    expect(values.get(legacyKey)).toBe(legacySession);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('reads current credentials after waiting for a concurrent auth writer', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    const current = JSON.stringify({
      access_token: 'new-token',
      refresh_token: 'new-refresh',
      expires_at: 4_000_000_000,
    });
    vi.mocked(locks.request).mockImplementationOnce(async (_name, _options, callback) => {
      values.set(currentKey, current);
      return (callback as (lock: Lock) => unknown)({} as Lock);
    });
    await migratePinboardSession(storage, locks);
    expect(values.get(currentKey)).toBe(current);
    expect(values.get(legacyKey)).toBe(legacySession);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('preserves a refreshed original written by an uncoordinated tab during copy', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    const refreshed = JSON.stringify({
      access_token: 'refreshed-token',
      refresh_token: 'refreshed-refresh',
      expires_at: 4_000_000_000,
    });
    storage.setItem.mockImplementation((key, value) => {
      values.set(key, value);
      values.set(legacyKey, refreshed);
    });
    await migratePinboardSession(storage, locks);
    expect(values.get(legacyKey)).toBe(refreshed);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('copies valid credentials under both auth locks and retains the recovery original', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    await migratePinboardSession(storage, locks);
    expect(values.get(currentKey)).toBe(legacySession);
    expect(values.get(legacyKey)).toBe(legacySession);
    expect(vi.mocked(locks.request).mock.calls.map(([name]) => name)).toEqual([
      'lock:pinboard-auth',
      'lock:kanban-auth',
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(currentKey, legacySession);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps an existing Pinboard identity without replacing or deleting either session', async () => {
    const currentSession = JSON.stringify({
      access_token: 'current-token',
      refresh_token: 'current-refresh',
      expires_at: 4_000_000_000,
    });
    const { values, storage } = storageFixture({
      [currentKey]: currentSession,
      [legacyKey]: legacySession,
    });
    await migratePinboardSession(storage, locks);
    expect(values.get(currentKey)).toBe(currentSession);
    expect(values.get(legacyKey)).toBe(legacySession);
    expect(storage.getItem).toHaveBeenCalledOnce();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('leaves storage untouched when there is no former session', async () => {
    const { values, storage } = storageFixture();
    await migratePinboardSession(storage, locks);
    expect(values.size).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('preserves the original session when saving the new key fails', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    storage.setItem.mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    await expect(migratePinboardSession(storage, locks)).rejects.toThrow(/session/i);
    expect(values.get(legacyKey)).toBe(legacySession);
    expect(values.has(currentKey)).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('preserves the original session when the new copy cannot be verified', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    storage.getItem.mockImplementation((key) => (key === legacyKey ? legacySession : null));
    await expect(migratePinboardSession(storage, locks)).rejects.toThrow(/session/i);
    expect(storage.setItem).toHaveBeenCalledWith(currentKey, legacySession);
    expect(values.get(legacyKey)).toBe(legacySession);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('preserves the original session when storage cannot be read', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    storage.getItem.mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    await expect(migratePinboardSession(storage, locks)).rejects.toThrow(/session/i);
    expect(values.get(legacyKey)).toBe(legacySession);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  describe('damaged, locked and unavailable sessions', () => {
    const valid = JSON.stringify({
      access_token: 'a',
      refresh_token: 'b',
      expires_at: 4_000_000_000,
    });
    const heldLocks = () =>
      ({
        // Never grants the lock; rejects only when the caller aborts the wait, like a real LockManager.
        request: vi.fn(
          (_name: string, options: { signal: AbortSignal }) =>
            new Promise<never>((_resolve, reject) => {
              options.signal.addEventListener('abort', () =>
                reject(new DOMException('The lock request is aborted', 'AbortError')),
              );
            }),
        ),
      }) as unknown as Pick<LockManager, 'request'>;

    it.each([
      'not JSON',
      'null',
      '[]',
      '{}',
      JSON.stringify({ access_token: 'token', refresh_token: 'refresh' }),
    ])(
      'reports a damaged current session as recoverable without touching storage: %s',
      async (raw) => {
        const { values, storage } = storageFixture({ [currentKey]: raw });
        const outcome = await migratePinboardSession(storage, locks).catch(
          (failure: unknown) => failure,
        );
        expect(outcome).toBeInstanceOf(SessionRecoveryError);
        expect((outcome as SessionRecoveryError).problem).toBe('corrupt');
        expect((outcome as SessionRecoveryError).message).toBe(SESSION_CORRUPT_MESSAGE);
        expect(values.get(currentKey)).toBe(raw);
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
        expect(locks.request).not.toHaveBeenCalled();
      },
    );

    it('does not let a valid former session replace a damaged current one', async () => {
      const { values, storage } = storageFixture({
        [currentKey]: '{}',
        [legacyKey]: legacySession,
      });
      await expect(migratePinboardSession(storage, locks)).rejects.toMatchObject({
        problem: 'corrupt',
      });
      expect(values.get(currentKey)).toBe('{}');
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('reports a damaged former session before waiting for any lock', async () => {
      const { storage } = storageFixture({ [legacyKey]: 'not JSON' });
      await expect(migratePinboardSession(storage, locks)).rejects.toMatchObject({
        problem: 'corrupt',
      });
      expect(locks.request).not.toHaveBeenCalled();
    });

    it('ignores a damaged former session once a valid current one exists', async () => {
      const { values, storage } = storageFixture({ [currentKey]: valid, [legacyKey]: 'not JSON' });
      await expect(migratePinboardSession(storage, locks)).resolves.toBeUndefined();
      expect(values.get(legacyKey)).toBe('not JSON');
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('treats identical current and former sessions as one: nothing is copied, both stay, no lock is used', async () => {
      const { values, storage } = storageFixture({
        [currentKey]: legacySession,
        [legacyKey]: legacySession,
      });
      await expect(migratePinboardSession(storage, locks)).resolves.toBeUndefined();
      expect(values.get(currentKey)).toBe(legacySession);
      expect(values.get(legacyKey)).toBe(legacySession);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(locks.request).not.toHaveBeenCalled();
    });

    it('never waits for a lock when there is nothing to copy, even if another tab holds it forever', async () => {
      const held = heldLocks();
      const empty = storageFixture();
      await expect(migratePinboardSession(empty.storage, held)).resolves.toBeUndefined();
      const current = storageFixture({ [currentKey]: valid });
      await expect(migratePinboardSession(current.storage, held)).resolves.toBeUndefined();
      expect(held.request).not.toHaveBeenCalled();
    });

    it('works without the Web Locks API when nothing needs copying, and stops before copying when it does', async () => {
      const current = storageFixture({ [currentKey]: valid });
      await expect(migratePinboardSession(current.storage, null)).resolves.toBeUndefined();
      const fresh = storageFixture();
      await expect(migratePinboardSession(fresh.storage, undefined)).resolves.toBeUndefined();
      const former = storageFixture({ [legacyKey]: legacySession });
      await expect(migratePinboardSession(former.storage, null)).rejects.toMatchObject({
        problem: 'failed',
      });
      expect(former.storage.setItem).not.toHaveBeenCalled();
    });

    it('gives up on a lock held by a hung tab after the wait limit and copies nothing', async () => {
      vi.useFakeTimers();
      try {
        const { values, storage } = storageFixture({ [legacyKey]: legacySession });
        const held = heldLocks();
        const outcome = vi.fn();
        void migratePinboardSession(storage, held).catch((failure: unknown) => outcome(failure));
        await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS - 1);
        expect(outcome).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toHaveBeenCalledOnce();
        expect(outcome.mock.calls[0][0]).toMatchObject({ problem: 'locked' });
        expect(held.request).toHaveBeenCalledTimes(1);
        expect(values.has(currentKey)).toBe(false);
        expect(storage.setItem).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives up when only the second lock is held, and releases the first', async () => {
      vi.useFakeTimers();
      try {
        const { storage } = storageFixture({ [legacyKey]: legacySession });
        let firstReleased = false;
        const held = heldLocks();
        const partly = {
          request: vi.fn(
            (
              name: string,
              options: { signal: AbortSignal },
              callback: (lock: Lock | null) => unknown,
            ) =>
              name === `lock:${currentKey}`
                ? Promise.resolve(callback({} as Lock)).finally(() => {
                    firstReleased = true;
                  })
                : held.request(name, options, callback),
          ),
        } as unknown as Pick<LockManager, 'request'>;
        const outcome = vi.fn();
        void migratePinboardSession(storage, partly).catch((failure: unknown) => outcome(failure));
        await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
        expect(outcome.mock.calls[0][0]).toMatchObject({ problem: 'locked' });
        expect(firstReleased).toBe(true);
        expect(storage.setItem).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not time out a lock that is granted in time, even if the copy then takes longer than the limit', async () => {
      vi.useFakeTimers();
      try {
        const { values, storage } = storageFixture({ [legacyKey]: legacySession });
        const slow = {
          request: vi.fn(
            async (_name: string, _options: unknown, callback: (lock: Lock) => unknown) => {
              await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS - 1));
              return callback({} as Lock);
            },
          ),
        } as unknown as Pick<LockManager, 'request'>;
        const done = migratePinboardSession(storage, slow);
        await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS * 3);
        await expect(done).resolves.toBeUndefined();
        expect(values.get(currentKey)).toBe(legacySession);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reports a lock request that fails for another reason and leaves both sessions as they were', async () => {
      const { values, storage } = storageFixture({ [legacyKey]: legacySession });
      const failing = {
        request: vi.fn(async () => {
          throw new DOMException('Not allowed', 'SecurityError');
        }),
      } as unknown as Pick<LockManager, 'request'>;
      await expect(migratePinboardSession(storage, failing)).rejects.toMatchObject({
        problem: 'failed',
      });
      expect(values.get(legacyKey)).toBe(legacySession);
      expect(values.has(currentKey)).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('starting a new session', () => {
    const valid = JSON.stringify({
      access_token: 'a',
      refresh_token: 'b',
      expires_at: 4_000_000_000,
    });
    const now = () => 1234;

    it('backs up a damaged current session, removes it, and lets the next start succeed', async () => {
      const { values, storage } = storageFixture({ [currentKey]: '{}' });
      await startNewPinboardSession(storage, locks, now);
      expect(values.has(currentKey)).toBe(false);
      expect(values.get(`${currentKey}:damaged-1234`)).toBe('{}');
      await expect(migratePinboardSession(storage, locks)).resolves.toBeUndefined();
      expect(vi.mocked(locks.request).mock.calls.map(([name]) => name)).toEqual([
        'lock:pinboard-auth',
        'lock:kanban-auth',
      ]);
    });

    it('backs up both sessions when both are damaged, and leaves valid ones alone', async () => {
      const both = storageFixture({ [currentKey]: 'x', [legacyKey]: 'y' });
      await startNewPinboardSession(both.storage, locks, now);
      expect([...both.values.entries()].sort()).toEqual([
        ['kanban-auth:damaged-1234', 'y'],
        ['pinboard-auth:damaged-1234', 'x'],
      ]);
      const mixed = storageFixture({ [currentKey]: '[]', [legacyKey]: valid });
      await startNewPinboardSession(mixed.storage, locks, now);
      expect(mixed.values.has(currentKey)).toBe(false);
      expect(mixed.values.get(legacyKey)).toBe(valid);
      // The former identity is then restored as usual.
      await migratePinboardSession(mixed.storage, locks);
      expect(mixed.values.get(currentKey)).toBe(valid);
    });

    it('does nothing when no stored session is damaged', async () => {
      const { values, storage } = storageFixture({ [currentKey]: valid, [legacyKey]: valid });
      await startNewPinboardSession(storage, locks, now);
      const empty = storageFixture();
      await startNewPinboardSession(empty.storage, locks, now);
      expect(values.size).toBe(2);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(empty.storage.setItem).not.toHaveBeenCalled();
    });

    it('re-reads under the locks: a session another tab just repaired is kept', async () => {
      const { values, storage } = storageFixture({ [currentKey]: '{}' });
      vi.mocked(locks.request).mockImplementationOnce(async (_name, _options, callback) => {
        values.set(currentKey, valid);
        return (callback as (lock: Lock) => unknown)({} as Lock);
      });
      await startNewPinboardSession(storage, locks, now);
      expect(values.get(currentKey)).toBe(valid);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('keeps the damaged value when the backup cannot be saved or verified', async () => {
      const failing = storageFixture({ [currentKey]: '{}' });
      failing.storage.setItem.mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      await expect(startNewPinboardSession(failing.storage, locks, now)).rejects.toMatchObject({
        problem: 'failed',
      });
      expect(failing.values.get(currentKey)).toBe('{}');
      expect(failing.storage.removeItem).not.toHaveBeenCalled();
      const lost = storageFixture({ [currentKey]: '{}' });
      lost.storage.setItem.mockImplementation(() => undefined);
      await expect(startNewPinboardSession(lost.storage, locks, now)).rejects.toMatchObject({
        problem: 'failed',
      });
      expect(lost.values.get(currentKey)).toBe('{}');
      expect(lost.storage.removeItem).not.toHaveBeenCalled();
    });

    it('reports a removal that did not take effect', async () => {
      const { storage } = storageFixture({ [currentKey]: '{}' });
      storage.removeItem.mockImplementation(() => undefined);
      await expect(startNewPinboardSession(storage, locks, now)).rejects.toMatchObject({
        problem: 'failed',
      });
    });

    it('gives up after the wait limit when a hung tab holds the lock, changing nothing', async () => {
      vi.useFakeTimers();
      try {
        const { values, storage } = storageFixture({ [currentKey]: '{}' });
        const held = {
          request: vi.fn(
            (_name: string, options: { signal: AbortSignal }) =>
              new Promise<never>((_resolve, reject) =>
                options.signal.addEventListener('abort', () =>
                  reject(new DOMException('aborted', 'AbortError')),
                ),
              ),
          ),
        } as unknown as Pick<LockManager, 'request'>;
        const outcome = vi.fn();
        void startNewPinboardSession(storage, held, now).catch((failure: unknown) =>
          outcome(failure),
        );
        await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
        expect(outcome.mock.calls[0][0]).toMatchObject({ problem: 'locked' });
        expect(values.get(currentKey)).toBe('{}');
        expect(storage.setItem).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('proceeds without locks when the Web Locks API is absent', async () => {
      const { values, storage } = storageFixture({ [currentKey]: '{}' });
      await startNewPinboardSession(storage, null, now);
      expect(values.has(currentKey)).toBe(false);
      expect(values.get(`${currentKey}:damaged-1234`)).toBe('{}');
    });
  });

  it('never requires deleting the recovery original after a verified copy', async () => {
    const { values, storage } = storageFixture({ [legacyKey]: legacySession });
    storage.removeItem.mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await expect(migratePinboardSession(storage, locks)).resolves.toBeUndefined();
    expect(values.get(currentKey)).toBe(legacySession);
    expect(values.get(legacyKey)).toBe(legacySession);
  });
});
