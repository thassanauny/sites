type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;
type SessionLocks = Pick<LockManager, 'request'>;
/** The browser-storage key of the auth client's session; boards.ts passes it to the client. */
export const AUTH_STORAGE_KEY = 'pinboard-auth';
const currentKey = AUTH_STORAGE_KEY;

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

/** Validate only the current saved identity before the auth client can read it. */
export function validatePinboardSession(storage: Pick<Storage, 'getItem'>): void {
  try {
    const current = storage.getItem(currentKey);
    if (current !== null && !isValid(current)) throw new SessionRecoveryError('corrupt');
  } catch (failure) {
    fail(failure);
  }
}

/** Back up a damaged current session before removing it; valid identities stay untouched. */
export async function startNewPinboardSession(
  storage: SessionStorage & Pick<Storage, 'removeItem'>,
  locks: SessionLocks | null | undefined = globalThis.navigator?.locks,
  now: () => number = Date.now,
): Promise<void> {
  try {
    const clear = () => {
      const raw = storage.getItem(currentKey);
      if (raw === null || isValid(raw)) return;
      const backupKey = `${currentKey}:damaged-${now()}`;
      storage.setItem(backupKey, raw);
      if (storage.getItem(backupKey) !== raw) throw new Error('Session backup failed');
      storage.removeItem(currentKey);
      if (storage.getItem(currentKey) !== null) throw new Error('Session removal failed');
    };
    if (locks) await withLock(locks, `lock:${currentKey}`, clear);
    else clear();
  } catch (failure) {
    fail(failure);
  }
}
