import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionDamagedError } from '../../domain/snippets/model';
import { discardDamagedSession, LOCK_WAIT_MS, TEXTDROP_AUTH_KEY, validateAuthStorage } from './sessionStorage';

const credentials = '{"access_token":"fixture-access","refresh_token":"fixture-refresh","expires_at":1}';
function fixture(entries: [string, string][] = []) {
  const values = new Map(entries);
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('current TextDrop authentication storage', () => {
  it('preserves current credentials and unrelated storage without copying old keys', async () => {
    const { storage, values } = fixture([
      [TEXTDROP_AUTH_KEY, credentials],
      ['unrelated-auth', '{malformed'],
    ]);
    await validateAuthStorage(storage);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(credentials);
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(TEXTDROP_AUTH_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('permits a fresh browser and does nothing outside the browser', async () => {
    await expect(validateAuthStorage(fixture().storage)).resolves.toBeUndefined();
    await expect(validateAuthStorage()).resolves.toBeUndefined();
  });
  it('blocks incomplete or damaged credentials without replacing the identity', async () => {
    for (const invalid of ['', '{malformed', 'null', '{}', '{"access_token":"a","refresh_token":"r"}', '{"access_token":"","refresh_token":"r","expires_at":1}']) {
      const { storage, values } = fixture([[TEXTDROP_AUTH_KEY, invalid]]);
      await expect(validateAuthStorage(storage)).rejects.toBeInstanceOf(SessionDamagedError);
      expect(values.get(TEXTDROP_AUTH_KEY)).toBe(invalid);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    }
  });
  it('redacts unavailable browser storage errors', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error(credentials);
      },
    });
    await expect(validateAuthStorage()).rejects.toThrow('Check browser storage permissions');
    await expect(validateAuthStorage()).rejects.not.toThrow('fixture-access');
  });
  it('backs up only damaged current credentials before removing them and preserves valid sessions', async () => {
    const damaged = fixture([
      [TEXTDROP_AUTH_KEY, '{malformed'],
      ['unrelated-auth', '{keep'],
    ]);
    await discardDamagedSession(damaged.storage, null);
    expect(damaged.values.get(`${TEXTDROP_AUTH_KEY}-damaged`)).toBe('{malformed');
    expect(damaged.values.has(TEXTDROP_AUTH_KEY)).toBe(false);
    expect(damaged.values.get('unrelated-auth')).toBe('{keep');
    await validateAuthStorage(damaged.storage);
    const valid = fixture([[TEXTDROP_AUTH_KEY, credentials]]);
    await discardDamagedSession(valid.storage, null);
    expect(valid.storage.removeItem).not.toHaveBeenCalled();
  });
  it.each(['lost', 'full'])('retains damaged credentials when backup storage is %s', async failure => {
    const { storage, values } = fixture([[TEXTDROP_AUTH_KEY, '{malformed']]);
    storage.setItem.mockImplementationOnce(() => {
      if (failure === 'full') throw new Error('Full');
    });
    await expect(discardDamagedSession(storage, null)).rejects.toThrow('Could not start a new TextDrop session');
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe('{malformed');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('uses the current SDK session lock and bounds a held lock without writing', async () => {
    vi.useFakeTimers();
    const { storage } = fixture([[TEXTDROP_AUTH_KEY, '{malformed']]);
    const request = vi.fn(
      (_name: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const attempt = expect(discardDamagedSession(storage, { request: request as unknown as LockManager['request'] })).rejects.toThrow('Another TextDrop tab');
    expect(request.mock.calls[0][0]).toBe(`lock:${TEXTDROP_AUTH_KEY}`);
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
    await attempt;
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rechecks credentials under the lock so a newer valid identity survives recovery', async () => {
    const { storage, values } = fixture([[TEXTDROP_AUTH_KEY, '{malformed']]);
    const request = vi.fn(async (_name: string, _options: unknown, callback: () => unknown) => {
      values.set(TEXTDROP_AUTH_KEY, credentials);
      return callback();
    });
    await discardDamagedSession(storage, { request: request as unknown as LockManager['request'] });
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(credentials);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
