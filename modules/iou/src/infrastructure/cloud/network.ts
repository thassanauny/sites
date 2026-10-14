/** A server that has not answered after this long is treated as unreachable. */
export const HEADERS_TIMEOUT_MS = 20_000
/** A whole request, including reading a large response, may take this long. */
export const REQUEST_TIMEOUT_MS = 60_000

/** A timer that aborts a signal; cancel() stops it. */
function abortAfter(controller: AbortController, ms: number, message: string) {
  const timer = setTimeout(() => controller.abort(new DOMException(message, 'TimeoutError')), ms)
  return () => clearTimeout(timer)
}

/**
 * fetch with limits, so that one stalled request cannot keep syncing waiting for good.
 * The server must send its response headers within `headersMs`, and the whole response must arrive within `totalMs`.
 */
export function fetchWithTimeout(headersMs = HEADERS_TIMEOUT_MS, totalMs = REQUEST_TIMEOUT_MS, send: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return async (input, init) => {
    const outer = init?.signal
    if (outer?.aborted) throw outer.reason
    const controller = new AbortController()
    outer?.addEventListener('abort', () => controller.abort(outer.reason), { once: true })
    const cancelHeaders = abortAfter(controller, headersMs, 'The request timed out waiting for a response.')
    const cancelTotal = abortAfter(controller, totalMs, 'The request timed out.')
    try {
      return await send(input, { ...init, signal: controller.signal })
    } catch (error) {
      cancelTotal()
      throw error
    } finally {
      cancelHeaders()
    }
  }
}
