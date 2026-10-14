type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;
type SessionLocks = Pick<LockManager, 'request'>;
/** The browser-storage key of the auth client's session; boards.ts passes it to the client. */
export const AUTH_STORAGE_KEY = 'pinboard-auth';
const currentKey = AUTH_STORAGE_KEY;
const previousKey = 'kanban-auth';

function validateSession(raw: string): void {
  const session: unknown = JSON.parse(raw);
  if (typeof session !== 'object' || session === null || Array.isArray(session))
    throw new Error('Invalid saved session');
  const value = session as Record<string, unknown>;
  if (
    typeof value.access_token !== 'string' ||
    !value.access_token.trim() ||
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token.trim() ||
    !Number.isSafeInteger(value.expires_at) ||
    Number(value.expires_at) <= 0
  ) {
    throw new Error('Invalid saved session');
  }
}

/** How long to wait for another tab to release a session lock before giving up. */
export const LOCK_WAIT_MS = 10_000;

/** Shown with a "Start a new session" action; the damaged value is backed up, never discarded. */
export const SESSION_CORRUPT_MESSAGE =
  'Your saved board session is damaged and cannot be used. Your original credentials are preserved. Start a new session to continue, then rejoin your boards with their invitation codes.';
const SESSION_LOCKED_MESSAGE =
  'Could not restore your saved board session because another tab is still using it. Your original credentials are preserved. Close other Pinboard tabs and reload.';
const SESSION_FAILED_MESSAGE =
  'Could not restore your saved board session. Your original credentials are preserved. Check browser storage and reload, or join again with your invitation code.';

/** `corrupt`: a stored value is unusable. `locked`: another tab holds a lock. `failed`: locks absent, storage or lock failure. */
export type SessionProblem = 'corrupt' | 'locked' | 'failed';

export class SessionRecoveryError extends Error {
  readonly problem: SessionProblem;
  constructor(problem: SessionProblem) {
    super(
      problem === 'corrupt'
        ? SESSION_CORRUPT_MESSAGE
        : problem === 'locked'
          ? SESSION_LOCKED_MESSAGE
          : SESSION_FAILED_MESSAGE,
    );
    this.name = 'SessionRecoveryError';
    this.problem = problem;
  }
}

class LockWaitTimeout extends Error {}

function isValid(raw: string): boolean {
  try {
    validateSession(raw);
    return true;
  } catch {
    return false;
  }
}

/** Run `work` while holding a lock, giving up if another tab keeps it for longer than LOCK_WAIT_MS. */
function withLock<T>(locks: SessionLocks, name: string, work: () => T | Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCK_WAIT_MS);
  return Promise.resolve(
    locks.request(name, { signal: controller.signal }, async () => {
      clearTimeout(timer);
      return work();
    }),
  )
    .catch((failure: unknown) => {
      if (
        controller.signal.aborted &&
        failure instanceof DOMException &&
        failure.name === 'AbortError'
      ) {
        throw new LockWaitTimeout();
      }
      throw failure;
    })
    .finally(() => clearTimeout(timer));
}

function fail(failure: unknown): never {
  if (failure instanceof SessionRecoveryError) throw failure;
  throw new SessionRecoveryError(failure instanceof LockWaitTimeout ? 'locked' : 'failed');
}

/**
 * Copy the previous app's identity without replacing an existing Pinboard session.
 * Locks are needed only to copy: a fresh start or a valid current session never waits for one.
 */
export async function migratePinboardSession(
  storage: SessionStorage,
  locks: SessionLocks | null | undefined = globalThis.navigator?.locks,
): Promise<void> {
  try {
    // Inside the locks the stored values are read again: another tab may have written meanwhile.
    const migrate = () => {
      const current = storage.getItem(currentKey);
      if (current !== null) {
        if (!isValid(current)) throw new SessionRecoveryError('corrupt');
        return;
      }
      const previous = storage.getItem(previousKey);
      if (previous === null) return;
      if (!isValid(previous)) throw new SessionRecoveryError('corrupt');
      if (storage.getItem(previousKey) !== previous) throw new Error('Saved session changed');
      storage.setItem(currentKey, previous);
      if (storage.getItem(currentKey) !== previous) throw new Error('Session copy failed');
      // Earlier versions may still write without these locks. Retain the old
      // identity as a recovery copy rather than deleting a rotated credential.
    };
    // Without a former session, or with a valid current one, there is nothing to copy and no lock is needed.
    const current = storage.getItem(currentKey);
    if (current !== null) {
      if (!isValid(current)) throw new SessionRecoveryError('corrupt');
      return;
    }
    const previous = storage.getItem(previousKey);
    if (previous === null) return;
    if (!isValid(previous)) throw new SessionRecoveryError('corrupt');
    if (!locks) throw new Error('Cross-tab session locking is unavailable');
    await withLock(locks, `lock:${currentKey}`, () =>
      withLock(locks, `lock:${previousKey}`, migrate),
    );
  } catch (failure) {
    fail(failure);
  }
}

/**
 * Back up every damaged stored session (current and previous) under a new key and remove it,
 * so the next start begins from what is left: a valid previous identity is restored as usual,
 * otherwise a fresh anonymous session starts. Valid sessions are never touched, and a damaged
 * value is removed only after its backup was read back.
 */
export async function startNewPinboardSession(
  storage: SessionStorage & Pick<Storage, 'removeItem'>,
  locks: SessionLocks | null | undefined = globalThis.navigator?.locks,
  now: () => number = Date.now,
): Promise<void> {
  try {
    const clear = () => {
      for (const key of [currentKey, previousKey]) {
        const raw = storage.getItem(key);
        if (raw === null || isValid(raw)) continue;
        const backupKey = `${key}:damaged-${now()}`;
        storage.setItem(backupKey, raw);
        if (storage.getItem(backupKey) !== raw) throw new Error('Session backup failed');
        storage.removeItem(key);
        if (storage.getItem(key) !== null) throw new Error('Session removal failed');
      }
    };
    if (locks)
      await withLock(locks, `lock:${currentKey}`, () =>
        withLock(locks, `lock:${previousKey}`, clear),
      );
    else clear();
  } catch (failure) {
    fail(failure);
  }
}
