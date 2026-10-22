import { SessionDamagedError } from '../../domain/snippets/model';

export const TEXTDROP_AUTH_KEY = 'textdrop-auth';
/** How long a tab waits for another tab's session lock before it gives up without writing. */
export const LOCK_WAIT_MS = 10_000;
type AuthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type AuthLocks = Pick<LockManager, 'request'>;

const DAMAGED = 'Your saved TextDrop session in this browser is damaged. Start a new session to continue; snippets listed on this device can be opened again with their codes.';
const LOCKED = 'Another TextDrop tab is holding your saved session. Close other TextDrop tabs or wait a moment, then reload.';
const UNREADABLE = 'Could not preserve your existing TextDrop session. Check browser storage permissions and try again.';

function isStoredSession(value: string): boolean {
  try {
    const session: unknown = JSON.parse(value);
    if (typeof session !== 'object' || session === null || Array.isArray(session)) return false;
    const fields = session as Record<string, unknown>;
    return (
      typeof fields.access_token === 'string' &&
      Boolean(fields.access_token.trim()) &&
      typeof fields.refresh_token === 'string' &&
      Boolean(fields.refresh_token.trim()) &&
      Number.isSafeInteger(fields.expires_at) &&
      Number(fields.expires_at) > 0
    );
  } catch {
    return false;
  }
}

/**
 * Runs `work` while holding the auth client's session lock. Locks that are absent
 * (no Web Locks in this browser) run it unlocked; the caller decides whether that is safe. Locks that are
 * held by another tab are waited for at most `LOCK_WAIT_MS`, and then nothing is written.
 */
async function withSessionLocks<T>(locks: AuthLocks | null | undefined, work: () => T): Promise<T> {
  if (!locks) return work();
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, LOCK_WAIT_MS);
  try {
    const { signal } = deadline;
    return await locks.request(`lock:${TEXTDROP_AUTH_KEY}`, { signal }, work);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(LOCKED);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Validate the current identity before Supabase can create or replace a session. */
export async function validateAuthStorage(storage?: AuthStorage): Promise<void> {
  if (!storage && typeof window === 'undefined') return;
  try {
    const value = (storage ?? window.localStorage).getItem(TEXTDROP_AUTH_KEY);
    if (value !== null && !isStoredSession(value)) throw new SessionDamagedError(DAMAGED);
  } catch (error) {
    if (error instanceof SessionDamagedError) throw error;
    throw new Error(UNREADABLE);
  }
}

/**
 * The "Start a new session" action for a damaged saved session. It sets damaged current credentials
 * aside under `<key>-damaged` and then removes them, so the next request signs in
 * again; a valid value is never touched. Nothing is removed unless its copy was stored first.
 */
export async function discardDamagedSession(storage?: AuthStorage, locks: AuthLocks | null | undefined = globalThis.navigator?.locks): Promise<void> {
  if (!storage && typeof window === 'undefined') return;
  try {
    const target = storage ?? window.localStorage;
    await withSessionLocks(locks, () => {
      const value = target.getItem(TEXTDROP_AUTH_KEY);
      if (value === null || isStoredSession(value)) return;
      target.setItem(`${TEXTDROP_AUTH_KEY}-damaged`, value);
      if (target.getItem(`${TEXTDROP_AUTH_KEY}-damaged`) !== value) throw new Error('Session copy was not stored.');
      target.removeItem(TEXTDROP_AUTH_KEY);
    });
  } catch (error) {
    if (error instanceof Error && error.message === LOCKED) throw error;
    throw new Error('Could not start a new TextDrop session. Check browser storage permissions and try again.');
  }
}
