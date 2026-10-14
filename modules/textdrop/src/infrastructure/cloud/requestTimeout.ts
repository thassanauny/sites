/** A request without an answer after this long counts as a lost connection. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** A request body may need extra time at this slow speed (about 25 KB/s), so a large save is not cut off. */
const SLOWEST_UPLOAD_BYTES_PER_MS = 25;
export const TIMEOUT_MESSAGE = 'The network request timed out.';

/**
 * Wraps `fetch` so a stalled connection (sleep/wake, captive portal, mobile handover) fails after a while.
 * Without it the browser can leave one request pending for minutes and every later save waits behind it.
 */
export function fetchWithTimeout(send: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const caller = init?.signal ?? undefined;
    const forwardCancel = () => {
      controller.abort(caller?.reason);
    };
    if (caller?.aborted) forwardCancel();
    const request = send(input, { ...init, signal: controller.signal });
    caller?.addEventListener('abort', forwardCancel, { once: true });
    const bodySize = typeof init?.body === 'string' ? init.body.length : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          reject(new TypeError(TIMEOUT_MESSAGE));
          controller.abort();
        },
        Math.ceil(REQUEST_TIMEOUT_MS + bodySize / SLOWEST_UPLOAD_BYTES_PER_MS),
      );
    });
    return Promise.race([request, expired]).finally(() => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', forwardCancel);
    });
  };
}
