import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionDamagedError } from '../../domain/snippets/model';
import { discardDamagedSession, LOCK_WAIT_MS, migrateLegacyAuthStorage, TEXTDROP_AUTH_KEY } from './sessionStorage';

const legacyKey = 'paste-auth';
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
/** Independent owners share a named queue, like browser tabs. */
function browserLocks() {
  const tails = new Map<string, Promise<void>>();
  const request = async (name: string, options: { signal?: AbortSignal } | (() => unknown), maybeCallback?: () => unknown) => {
    const callback = typeof options === 'function' ? options : maybeCallback!;
    const signal = typeof options === 'function' ? undefined : options.signal;
    const previous = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    tails.set(
      name,
      previous.then(() => held),
    );
    try {
      await new Promise<void>((granted, reject) => {
        void previous.then(granted);
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The request was aborted.', 'AbortError'));
        });
      });
    } catch (error) {
      release();
      throw error;
    }
    try {
      return await callback();
    } finally {
      release();
    }
  };
  return { request: request as unknown as LockManager['request'] };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TextDrop authentication storage rename', () => {
  it('copies credentials exactly and retains the original and metadata for recovery', async () => {
    const { storage, values } = fixture([
      [legacyKey, credentials],
      ['textdrop-snippets:fixture', 'metadata'],
    ]);
    const locks = browserLocks();
    await migrateLegacyAuthStorage(storage, locks);
    await migrateLegacyAuthStorage(storage, locks);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(credentials);
    expect(values.get(legacyKey)).toBe(credentials);
    expect(values.get('textdrop-snippets:fixture')).toBe('metadata');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('waits for an ordinary auth writer and preserves its newer identity', async () => {
    const { storage, values } = fixture([[legacyKey, credentials]]);
    const locks = browserLocks();
    let finishWriter!: () => void;
    const held = new Promise<void>(resolve => {
      finishWriter = resolve;
    });
    const newer = credentials.replace('fixture-access', 'newer-access');
    const writer = locks.request(`lock:${TEXTDROP_AUTH_KEY}`, async () => {
      await held;
      storage.setItem(TEXTDROP_AUTH_KEY, newer);
    });
    const migration = migrateLegacyAuthStorage(storage, locks);
    await Promise.resolve();
    expect(storage.setItem).not.toHaveBeenCalled();
    finishWriter();
    await Promise.all([writer, migration]);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(newer);
    expect(values.get(legacyKey)).toBe(credentials);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('waits for a legacy token refresh before copying', async () => {
    const { storage, values } = fixture([[legacyKey, credentials]]);
    const locks = browserLocks();
    const refreshed = credentials.replace('fixture-refresh', 'rotated-refresh');
    const writer = locks.request(`lock:${legacyKey}`, async () => storage.setItem(legacyKey, refreshed));
    await Promise.all([writer, migrateLegacyAuthStorage(storage, locks)]);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(refreshed);
    expect(values.get(legacyKey)).toBe(refreshed);
  });
  it('preserves distinct current credentials without requiring migration', async () => {
    const current = credentials.replace('fixture-access', 'other-access');
    const { storage, values } = fixture([
      [legacyKey, credentials],
      [TEXTDROP_AUTH_KEY, current],
    ]);
    await migrateLegacyAuthStorage(storage);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(current);
    expect(values.get(legacyKey)).toBe(credentials);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('takes no locks while a valid current session exists, and again once it vanishes', async () => {
    const { storage, values } = fixture([
      [legacyKey, credentials],
      [TEXTDROP_AUTH_KEY, credentials],
    ]);
    const request = vi.fn((_name: string, ...rest: unknown[]) => Promise.resolve((rest.at(-1) as () => unknown)()));
    const locks = { request: request as unknown as LockManager['request'] };
    await migrateLegacyAuthStorage(storage, locks);
    expect(request).not.toHaveBeenCalled();
    values.delete(TEXTDROP_AUTH_KEY);
    await migrateLegacyAuthStorage(storage, locks);
    expect(request).toHaveBeenCalledTimes(2);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(credentials);
  });
  it('fails closed if legacy migration needs unavailable browser locks', async () => {
    const { storage, values } = fixture([[legacyKey, credentials]]);
    await expect(migrateLegacyAuthStorage(storage, null)).rejects.toThrow('Could not preserve');
    expect(values.get(legacyKey)).toBe(credentials);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('blocks incomplete or malformed credentials without discarding them', async () => {
    for (const invalid of ['', '{malformed', 'null', '{}', '{"access_token":"a","refresh_token":"r"}', '{"access_token":"","refresh_token":"r","expires_at":1}']) {
      for (const entries of [
        [
          [legacyKey, credentials],
          [TEXTDROP_AUTH_KEY, invalid],
        ],
        [[legacyKey, invalid]],
      ] as [string, string][][]) {
        const { storage, values } = fixture(entries);
        await expect(migrateLegacyAuthStorage(storage, browserLocks())).rejects.toBeInstanceOf(SessionDamagedError);
        expect([...values]).toEqual(entries);
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
      }
    }
  });
  it('treats identical valid current and legacy sessions as nothing to copy, with or without locks', async () => {
    for (const locks of [browserLocks(), null]) {
      const { storage, values } = fixture([
        [legacyKey, credentials],
        [TEXTDROP_AUTH_KEY, credentials],
      ]);
      await expect(migrateLegacyAuthStorage(storage, locks)).resolves.toBeUndefined();
      expect(values.get(TEXTDROP_AUTH_KEY)).toBe(credentials);
      expect(values.get(legacyKey)).toBe(credentials);
      expect(storage.setItem).not.toHaveBeenCalled();
    }
    // A valid current session also wins when the legacy copy is damaged: the damaged copy is left alone.
    const { storage, values } = fixture([
      [legacyKey, '{malformed'],
      [TEXTDROP_AUTH_KEY, credentials],
    ]);
    await migrateLegacyAuthStorage(storage, browserLocks());
    expect(values.get(legacyKey)).toBe('{malformed');
  });
  it('stops waiting for a lock held by another tab after the bounded wait and writes nothing', async () => {
    vi.useFakeTimers();
    for (const held of [`lock:${TEXTDROP_AUTH_KEY}`, `lock:${legacyKey}`]) {
      const { storage, values } = fixture([[legacyKey, credentials]]);
      const locks = browserLocks();
      const hungTab = locks.request(held, () => new Promise(() => {}));
      void hungTab.catch(() => {});
      const migration = migrateLegacyAuthStorage(storage, locks);
      const outcome = expect(migration).rejects.toThrow('Another TextDrop tab is holding your saved session');
      await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS - 1);
      let settled = false;
      void migration
        .catch(() => {})
        .finally(() => {
          settled = true;
        });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(values.get(legacyKey)).toBe(credentials);
      expect(values.has(TEXTDROP_AUTH_KEY)).toBe(false);
    }
  });
  it('does not time out a lock that is released in time, and clears its timer', async () => {
    vi.useFakeTimers();
    const { storage, values } = fixture([[legacyKey, credentials]]);
    const locks = browserLocks();
    let finish!: () => void;
    const holder = locks.request(
      `lock:${legacyKey}`,
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const migration = migrateLegacyAuthStorage(storage, locks);
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS - 1);
    finish();
    await Promise.all([holder, migration]);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe(credentials);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([`lock:${TEXTDROP_AUTH_KEY}`, `lock:${legacyKey}`])('bounds a fresh start waiting for %s and succeeds once its owner releases it', async held => {
    vi.useFakeTimers();
    const { storage, values } = fixture();
    const locks = browserLocks();
    let finish!: () => void;
    const holder = locks.request(
      held,
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const migration = migrateLegacyAuthStorage(storage, locks);
    const outcome = expect(migration).rejects.toThrow('Another TextDrop tab is holding your saved session');
    let settled = false;
    void migration
      .catch(() => {})
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(values.size).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    finish();
    await holder;
    await expect(migrateLegacyAuthStorage(storage, locks)).resolves.toBeUndefined();
    expect(values.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('tells an absent lock manager apart from a held one: absent only blocks a copy that needs it', async () => {
    const absent = fixture([[legacyKey, credentials]]);
    await expect(migrateLegacyAuthStorage(absent.storage, null)).rejects.toThrow('Could not preserve');
    expect(absent.storage.setItem).not.toHaveBeenCalled();
    const nothingToCopy = fixture([[TEXTDROP_AUTH_KEY, credentials]]);
    await expect(migrateLegacyAuthStorage(nothingToCopy.storage, null)).resolves.toBeUndefined();
    const fresh = fixture();
    await expect(migrateLegacyAuthStorage(fresh.storage, null)).resolves.toBeUndefined();
  });
  it('sets a damaged session aside, then removes it, keeping valid sessions untouched', async () => {
    const entries: [string, string][][] = [
      [
        [TEXTDROP_AUTH_KEY, '{malformed'],
        [legacyKey, credentials],
      ],
      [
        [TEXTDROP_AUTH_KEY, '{malformed'],
        [legacyKey, '{}'],
      ],
      [[legacyKey, 'null']],
    ];
    for (const start of entries) {
      const { storage, values } = fixture(start);
      await discardDamagedSession(storage, browserLocks());
      for (const [key, value] of start) {
        if (value === credentials) expect(values.get(key)).toBe(credentials);
        else {
          expect(values.has(key)).toBe(false);
          expect(values.get(`${key}-damaged`)).toBe(value);
        }
      }
      // Once the damaged values are gone, the next start-up no longer reports damage.
      await expect(migrateLegacyAuthStorage(storage, browserLocks())).resolves.toBeUndefined();
    }
    const valid = fixture([[TEXTDROP_AUTH_KEY, credentials]]);
    await discardDamagedSession(valid.storage, browserLocks());
    expect(valid.values.get(TEXTDROP_AUTH_KEY)).toBe(credentials);
    expect(valid.storage.removeItem).not.toHaveBeenCalled();
  });
  it('removes a damaged session only after its copy is stored, and works without Web Locks', async () => {
    const lost = fixture([[TEXTDROP_AUTH_KEY, '{malformed']]);
    lost.storage.setItem.mockImplementationOnce(() => {});
    await expect(discardDamagedSession(lost.storage, null)).rejects.toThrow('Could not start a new TextDrop session');
    expect(lost.values.get(TEXTDROP_AUTH_KEY)).toBe('{malformed');
    expect(lost.storage.removeItem).not.toHaveBeenCalled();
    const full = fixture([[TEXTDROP_AUTH_KEY, '{malformed']]);
    full.storage.setItem.mockImplementationOnce(() => {
      throw new Error('Full');
    });
    await expect(discardDamagedSession(full.storage, null)).rejects.toThrow('Could not start a new TextDrop session');
    expect(full.values.get(TEXTDROP_AUTH_KEY)).toBe('{malformed');
    const unlocked = fixture([[TEXTDROP_AUTH_KEY, '{malformed']]);
    await discardDamagedSession(unlocked.storage, null);
    expect(unlocked.values.has(TEXTDROP_AUTH_KEY)).toBe(false);
  });
  it('gives up on a held lock when starting a new session too', async () => {
    vi.useFakeTimers();
    const { storage, values } = fixture([[TEXTDROP_AUTH_KEY, '{malformed']]);
    const locks = browserLocks();
    void locks.request(`lock:${TEXTDROP_AUTH_KEY}`, () => new Promise(() => {}));
    const attempt = expect(discardDamagedSession(storage, locks)).rejects.toThrow('Another TextDrop tab is holding your saved session');
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
    await attempt;
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe('{malformed');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('leaves a fresh browser unchanged and does nothing outside a browser', async () => {
    const { storage } = fixture();
    await migrateLegacyAuthStorage(storage);
    expect(storage.setItem).not.toHaveBeenCalled();
    await expect(migrateLegacyAuthStorage()).resolves.toBeUndefined();
  });
  it('keeps original credentials when storage fails or a write is lost', async () => {
    for (const failure of ['read', 'write', 'lost']) {
      const { storage, values } = fixture([[legacyKey, credentials]]);
      if (failure === 'read')
        storage.getItem.mockImplementationOnce(() => {
          throw new Error('Denied');
        });
      if (failure === 'write')
        storage.setItem.mockImplementationOnce(() => {
          throw new Error('Full');
        });
      if (failure === 'lost') storage.setItem.mockImplementationOnce(() => {});
      await expect(migrateLegacyAuthStorage(storage, browserLocks())).rejects.toThrow('Could not preserve');
      expect(values.get(legacyKey)).toBe(credentials);
      expect(storage.removeItem).not.toHaveBeenCalled();
    }
  });
  it('redacts unavailable browser storage errors', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error(credentials);
      },
    });
    await expect(migrateLegacyAuthStorage()).rejects.toThrow('Check browser storage permissions');
    await expect(migrateLegacyAuthStorage()).rejects.not.toThrow('fixture-access');
  });
});
