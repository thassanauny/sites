import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from './network'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** A request that only ends when it is aborted, like a connection that went quiet. */
const silent = () =>
  vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init!.signal!.aborted) reject(init!.signal!.reason)
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      }),
  )

describe('fetch with limits', () => {
  it('passes a prompt response through unchanged', async () => {
    const response = new Response('ok')
    const send = vi.fn(async () => response)
    await expect(fetchWithTimeout(1_000, 5_000, send)('https://example.test/groups', { method: 'POST' })).resolves.toBe(response)
    expect(send).toHaveBeenCalledWith('https://example.test/groups', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }))
  })

  it('gives up on a server that never answers, so syncing is not blocked for good', async () => {
    const send = silent()
    const outcome = fetchWithTimeout(1_000, 5_000, send)('https://example.test/groups').catch(error => error)
    await vi.advanceTimersByTimeAsync(999)
    expect(send.mock.calls[0]![1]!.signal!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = await outcome
    expect(error).toBeInstanceOf(DOMException)
    expect(error).toMatchObject({ name: 'TimeoutError', message: expect.stringMatching(/timed out/) })
  })

  it('stops waiting for the response headers once they have arrived, but still bounds the whole transfer', async () => {
    let signal: AbortSignal | undefined
    const send = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init!.signal!
      return new Response('slow body')
    })
    await fetchWithTimeout(1_000, 5_000, send)('https://example.test/groups')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(signal!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal!.aborted).toBe(true)
  })

  it('stops with the caller when the caller cancels the request', async () => {
    const send = silent()
    const caller = new AbortController()
    const outcome = fetchWithTimeout(1_000, 5_000, send)('https://example.test/groups', { signal: caller.signal }).catch(error => error)
    caller.abort(new DOMException('Cancelled', 'AbortError'))
    expect(await outcome).toMatchObject({ name: 'AbortError' })
  })

  it('does not even start a request the caller already cancelled', async () => {
    const send = silent()
    const caller = new AbortController()
    caller.abort(new DOMException('Cancelled', 'AbortError'))
    await expect(fetchWithTimeout(1_000, 5_000, send)('https://example.test/groups', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(send).not.toHaveBeenCalled()
  })
})
