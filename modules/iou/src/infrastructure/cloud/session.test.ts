// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// These tests run the real Supabase client against a fake network, to check what the app depends on:
// one identity per browser, the saved session key, and limits on stalled requests.
const PROJECT = 'https://test-project.supabase.co'
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const session = (n: number) => ({
  access_token: `access-${n}`,
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: `refresh-${n}`,
  user: { id: `00000000-0000-4000-8000-00000000000${n}`, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: '2026-10-08T00:00:00Z' },
})

let signUps: number
let fetchStub: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  signUps = 0
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === `${PROJECT}/auth/v1/signup`) {
      // Answer after a moment, as a network would.
      await new Promise(resolve => setTimeout(resolve, 5))
      return json(session(++signUps))
    }
    if (url.startsWith(`${PROJECT}/rest/v1/iou_groups`)) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '*/0' } })
    throw new Error(`Unexpected request to ${url}`)
  })
  vi.stubGlobal('fetch', fetchStub)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete (navigator as { locks?: unknown }).locks
})

/** A tab of the same browser: its own copy of the app's modules, sharing this window's storage and locks. */
const openTab = async () => {
  vi.resetModules()
  return import('./groups')
}

/** An exclusive Web Lock shared by every tab, granted in the order requested. */
function shareLocks() {
  let tail: Promise<unknown> = Promise.resolve()
  const request = vi.fn(async (_name: string, ...rest: unknown[]) => {
    const task = rest[rest.length - 1] as () => Promise<unknown>
    const before = tail
    let release!: () => void
    tail = new Promise<void>(resolve => {
      release = resolve
    })
    await before
    try {
      return await task()
    } finally {
      release()
    }
  })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
  return request
}

describe('one anonymous identity per browser', () => {
  it('would create an identity in every tab that starts without a saved session when nothing coordinates them', async () => {
    const [first, second] = [await openTab(), await openTab()]
    await Promise.all([first.initializeCloud(), second.initializeCloud()])
    expect(signUps).toBe(2)
  })

  it('creates one identity when two tabs start together, because the second finds the session the first saved', async () => {
    const locks = shareLocks()
    const [first, second] = [await openTab(), await openTab()]
    await Promise.all([first.initializeCloud(), second.initializeCloud()])
    expect(signUps).toBe(1)
    expect(locks.mock.calls.every(call => call[0] === 'iou:auth')).toBe(true)
    // A tab opened later restores that same identity.
    const third = await openTab()
    await third.initializeCloud()
    expect(signUps).toBe(1)
  })

  it('saves the session under the key earlier versions used, so existing identities keep working', async () => {
    const tab = await openTab()
    await tab.initializeCloud()
    expect(Object.keys(localStorage)).toEqual(['sb-test-project-auth-token'])
    expect(JSON.parse(localStorage.getItem('sb-test-project-auth-token')!)).toMatchObject({ access_token: 'access-1' })
  })

  it('stops waiting for another tab that keeps the lock too long', async () => {
    vi.useFakeTimers()
    const request = vi.fn(
      (_name: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        }),
    )
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const tab = await openTab()
    const outcome = tab.initializeCloud().catch(error => error)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await outcome).toMatchObject({ message: expect.stringContaining('Check your connection') })
    expect(signUps).toBe(0)
  })
})

describe('requests that never answer', () => {
  it('fails sign-in with the usual connection message, and lets the next attempt succeed', async () => {
    vi.useFakeTimers()
    fetchStub.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
        }),
    )
    const tab = await openTab()
    const outcome = tab.initializeCloud().catch(error => error)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await outcome).toMatchObject({ message: 'Could not connect to shared groups. Check your connection and try again.' })
    const retry = tab.initializeCloud()
    await vi.advanceTimersByTimeAsync(10)
    await expect(retry).resolves.toBeUndefined()
    expect(signUps).toBe(1)
  })

  it('fails a stalled request for the group list instead of waiting for ever', async () => {
    const tab = await openTab()
    await tab.initializeCloud()
    vi.useFakeTimers()
    fetchStub.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
        }),
    )
    const outcome = tab.loadCloudVersions().catch(error => error)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await outcome).toMatchObject({ message: 'Could not connect to shared groups. Check your connection and try again.' })
  })
})
