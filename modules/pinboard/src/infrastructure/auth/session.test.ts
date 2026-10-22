import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STORAGE_KEY,
  LOCK_WAIT_MS,
  SESSION_CORRUPT_MESSAGE,
  SessionRecoveryError,
  startNewPinboardSession,
  validatePinboardSession,
} from './session';

const valid = JSON.stringify({
  access_token: 'token',
  refresh_token: 'refresh',
  expires_at: 4_000_000_000,
});
const locks = {
  request: vi.fn(async (_name: string, _options: unknown, callback: (lock: Lock) => unknown) =>
    callback({} as Lock),
  ),
} as unknown as Pick<LockManager, 'request'>;
function fixture(initial: Record<string, string> = {}) {
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

describe('current Pinboard session', () => {
  it.each([
    'not JSON',
    'null',
    '[]',
    '{}',
    JSON.stringify({ access_token: 'token', refresh_token: 'refresh' }),
  ])('preserves a damaged current identity and reports recovery: %s', (raw) => {
    const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: raw });
    expect(() => validatePinboardSession(storage)).toThrow(SESSION_CORRUPT_MESSAGE);
    expect(() => validatePinboardSession(storage)).toThrow(SessionRecoveryError);
    expect(values.get(AUTH_STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('retains a valid current identity without locks or storage writes', () => {
    const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: valid });
    expect(() => validatePinboardSession(storage)).not.toThrow();
    expect(values.get(AUTH_STORAGE_KEY)).toBe(valid);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(locks.request).not.toHaveBeenCalled();
  });
  it('allows a fresh start without reading or copying unrelated stored identities', () => {
    const { values, storage } = fixture({ 'kanban-auth': 'unusable retired credentials' });
    expect(() => validatePinboardSession(storage)).not.toThrow();
    expect(storage.getItem.mock.calls).toEqual([[AUTH_STORAGE_KEY]]);
    expect(values.has(AUTH_STORAGE_KEY)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('reports unavailable storage before the auth client can replace an identity', () => {
    const { storage } = fixture();
    storage.getItem.mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    expect(() => validatePinboardSession(storage)).toThrow(/original credentials are preserved/);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('explicit damaged-session recovery', () => {
  it('backs up only the damaged current session and uses its existing auth lock', async () => {
    const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: '{}', unrelated: 'Keep this' });
    await startNewPinboardSession(storage, locks, () => 1234);
    expect([...values.entries()].sort()).toEqual([
      [AUTH_STORAGE_KEY + ':damaged-1234', '{}'],
      ['unrelated', 'Keep this'],
    ]);
    expect(vi.mocked(locks.request).mock.calls.map(([name]) => name)).toEqual([
      'lock:pinboard-auth',
    ]);
    expect(() => validatePinboardSession(storage)).not.toThrow();
  });
  it('keeps valid sessions and empty storage unchanged', async () => {
    const sessions: Record<string, string>[] = [{ [AUTH_STORAGE_KEY]: valid }, {}];
    for (const initial of sessions) {
      const { storage } = fixture(initial);
      await startNewPinboardSession(storage, locks);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    }
  });
  it('rechecks under the lock so another tab can repair the identity', async () => {
    const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: '{}' });
    vi.mocked(locks.request).mockImplementationOnce(async (_name, _options, callback) => {
      values.set(AUTH_STORAGE_KEY, valid);
      return (callback as (lock: Lock) => unknown)({} as Lock);
    });
    await startNewPinboardSession(storage, locks);
    expect(values.get(AUTH_STORAGE_KEY)).toBe(valid);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it.each(['failed', 'unverified'] as const)(
    'retains the damaged original when backup is %s',
    async (mode) => {
      const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: '{}' });
      storage.setItem.mockImplementation(() => {
        if (mode === 'failed') throw new Error('Storage full');
      });
      await expect(startNewPinboardSession(storage, locks)).rejects.toMatchObject({
        problem: 'failed',
      });
      expect(values.get(AUTH_STORAGE_KEY)).toBe('{}');
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );
  it('reports removal that did not take effect while retaining the backup', async () => {
    const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: '{}' });
    storage.removeItem.mockImplementation(() => {});
    await expect(startNewPinboardSession(storage, locks, () => 1234)).rejects.toMatchObject({
      problem: 'failed',
    });
    expect(values.get(AUTH_STORAGE_KEY + ':damaged-1234')).toBe('{}');
  });
  it('bounds waiting for a hung auth writer without changing credentials', async () => {
    vi.useFakeTimers();
    try {
      const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: '{}' });
      const held = {
        request: vi.fn(
          (_name: string, options: { signal: AbortSignal }) =>
            new Promise<never>((_resolve, reject) =>
              options.signal.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              ),
            ),
        ),
      } as unknown as Pick<LockManager, 'request'>;
      const result = startNewPinboardSession(storage, held).catch((error) => error);
      await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
      expect(await result).toMatchObject({ problem: 'locked' });
      expect(values.get(AUTH_STORAGE_KEY)).toBe('{}');
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('allows explicit recovery without Web Locks when the API is unavailable', async () => {
    const { values, storage } = fixture({ [AUTH_STORAGE_KEY]: '{}' });
    await startNewPinboardSession(storage, null, () => 1234);
    expect(values.has(AUTH_STORAGE_KEY)).toBe(false);
    expect(values.get(AUTH_STORAGE_KEY + ':damaged-1234')).toBe('{}');
  });
});
