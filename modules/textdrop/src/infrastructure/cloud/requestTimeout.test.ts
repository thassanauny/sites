import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_TIMEOUT_MS, TIMEOUT_MESSAGE, fetchWithTimeout } from './requestTimeout';

const ok = () => new Response('{}', { status: 200 });
const never = (_input?: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {});
/** Like the browser: rejects with the signal's reason, also when the signal is already cancelled. */
const cancellable = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init!.signal!;
    if (signal.aborted) reject(signal.reason);
    else
      signal.addEventListener('abort', () => {
        reject(signal.reason);
      });
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('request timeout', () => {
  it('passes a timely response through and leaves no timer behind', async () => {
    const send = vi.fn(async () => ok());
    const response = await fetchWithTimeout(send)('https://example.test/rpc', { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledExactlyOnceWith('https://example.test/rpc', expect.objectContaining({ method: 'POST', body: '{}' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a failure through unchanged and leaves no timer behind', async () => {
    const failure = new TypeError('Failed to fetch');
    await expect(
      fetchWithTimeout(
        vi.fn(async () => {
          throw failure;
        }),
      )('https://example.test/rpc'),
    ).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on a request that never settles and cancels it', async () => {
    const send = vi.fn(never);
    const outcome = expect(fetchWithTimeout(send)('https://example.test/rpc', { method: 'POST' })).rejects.toThrow(TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(send.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(send.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a timeout, not an abort, when the browser rejects the cancelled request', async () => {
    const outcome = expect(fetchWithTimeout(cancellable)('https://example.test/rpc')).rejects.toThrow(TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it('allows a large body more time on a slow connection', async () => {
    const send = vi.fn(never);
    const body = 'x'.repeat(1024 * 1024);
    let outcome: unknown = 'pending';
    fetchWithTimeout(send)('https://example.test/rpc', { method: 'POST', body }).then(
      () => {
        outcome = 'sent';
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 30_000);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(outcome).toEqual(new TypeError(TIMEOUT_MESSAGE));
  });

  it('does not report a timeout when the caller cancels the request', async () => {
    const caller = new AbortController();
    const outcome = expect(fetchWithTimeout(cancellable)('https://example.test/rpc', { signal: caller.signal })).rejects.toThrow('Stopped by the caller');
    caller.abort(new Error('Stopped by the caller'));
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
    const alreadyStopped = new AbortController();
    alreadyStopped.abort(new Error('Already stopped'));
    await expect(fetchWithTimeout(cancellable)('https://example.test/rpc', { signal: alreadyStopped.signal })).rejects.toThrow('Already stopped');
    expect(vi.getTimerCount()).toBe(0);
  });
});
