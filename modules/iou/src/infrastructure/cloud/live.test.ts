import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const live = vi.hoisted(() => {
  type Channel = {
    topic: string
    config: unknown
    message?: (message: { payload: unknown }) => void
    status?: (status: string) => void
    on: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
  }
  const channels: Channel[] = []
  const subscription = { unsubscribe: vi.fn() }
  const auth = { getSession: vi.fn(), signInAnonymously: vi.fn(), onAuthStateChange: vi.fn() }
  const setAuth = vi.fn()
  const removeChannel = vi.fn()
  const createChannel = (topic: string, config: unknown) => {
    const result: Channel = { topic, config, on: vi.fn(), subscribe: vi.fn() }
    result.on.mockImplementation((_type, _filter, callback) => {
      result.message = callback
      return result
    })
    result.subscribe.mockImplementation(callback => {
      result.status = callback
      return result
    })
    channels.push(result)
    return result
  }
  const channel = vi.fn(createChannel)
  return { channels, subscription, auth, setAuth, removeChannel, channel, createChannel }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: live.auth, realtime: { setAuth: live.setAuth }, channel: live.channel, removeChannel: live.removeChannel }) }))
const first = { access_token: 'first-token', user: { id: '11111111-1111-4111-8111-111111111111' } }
const second = { access_token: 'second-token', user: { id: '22222222-2222-4222-8222-222222222222' } }
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  live.channels.length = 0
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
  live.auth.getSession.mockResolvedValue({ data: { session: first }, error: null })
  live.auth.onAuthStateChange.mockReturnValue({ data: { subscription: live.subscription } })
  live.setAuth.mockResolvedValue(undefined)
  live.removeChannel.mockResolvedValue('ok')
  live.channel.mockImplementation(live.createChannel)
})
afterEach(() => vi.unstubAllEnvs())

describe('optional private ledger invalidations', () => {
  it('reports health only for subscribed channels and clears it on failure, identity change and cleanup', async () => {
    const { watchCloudGroups } = await import('./groups')
    const health = vi.fn()
    const stop = watchCloudGroups(vi.fn(), health)
    await vi.waitFor(() => expect(live.channels).toHaveLength(1))
    expect(health.mock.calls.every(([value]) => value === false)).toBe(true)
    const firstChannel = live.channels[0]
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      firstChannel.status!('SUBSCRIBED')
      expect(health).toHaveBeenLastCalledWith(true)
      firstChannel.status!(status)
      expect(health).toHaveBeenLastCalledWith(false)
    }
    firstChannel.status!('SUBSCRIBED')
    live.auth.onAuthStateChange.mock.calls[0][0]('SIGNED_IN', second)
    await vi.waitFor(() => expect(live.channels).toHaveLength(2))
    expect(health).toHaveBeenLastCalledWith(false)
    const calls = health.mock.calls.length
    firstChannel.status!('SUBSCRIBED')
    expect(health).toHaveBeenCalledTimes(calls)
    live.channels[1].status!('SUBSCRIBED')
    stop()
    expect(health).toHaveBeenLastCalledWith(false)
    live.channels[1].status!('SUBSCRIBED')
    expect(health).toHaveBeenLastCalledWith(false)
  })

  it('uses one private identity channel, validates metadata and catches up on every subscription', async () => {
    const { watchCloudGroups } = await import('./groups')
    const changed = vi.fn()
    const stop = watchCloudGroups(changed)
    await vi.waitFor(() => expect(live.channel).toHaveBeenCalledOnce())
    expect(live.channel).toHaveBeenCalledWith(`iou:user:${first.user.id}`, { config: { private: true } })
    expect(live.setAuth).toHaveBeenCalledWith(first.access_token)
    const channel = live.channels[0]
    expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'changed' }, expect.any(Function))
    channel.status!('SUBSCRIBED')
    channel.status!('CHANNEL_ERROR')
    channel.status!('SUBSCRIBED')
    for (const payload of [null, {}, { id: '__proto__', revision: 2 }, { id: 'trip', revision: '2' }, { id: 'trip', revision: 0 }]) channel.message!({ payload })
    channel.message!({ payload: { id: 'trip', revision: 2 } })
    expect(changed.mock.calls).toEqual([[], [], [{ id: 'trip', revision: 2 }]])
    stop()
    expect(live.subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(live.removeChannel).toHaveBeenCalledWith(channel)
    channel.message!({ payload: { id: 'trip', revision: 3 } })
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('removes the previous identity topic before subscribing to a replacement session', async () => {
    const { watchCloudGroups } = await import('./groups')
    const stop = watchCloudGroups(vi.fn())
    await vi.waitFor(() => expect(live.channels).toHaveLength(1))
    const authChanged = live.auth.onAuthStateChange.mock.calls[0][0]
    authChanged('SIGNED_IN', second)
    await vi.waitFor(() => expect(live.channels).toHaveLength(2))
    expect(live.removeChannel).toHaveBeenCalledWith(live.channels[0])
    expect(live.channels[1].topic).toBe(`iou:user:${second.user.id}`)
    authChanged('SIGNED_OUT', null)
    await vi.waitFor(() => expect(live.removeChannel).toHaveBeenCalledWith(live.channels[1]))
    stop()
  })

  it('does not create a channel after cleanup or when realtime authentication fails', async () => {
    const { watchCloudGroups } = await import('./groups')
    const stop = watchCloudGroups(vi.fn())
    stop()
    await Promise.resolve()
    expect(live.channel).not.toHaveBeenCalled()
    live.setAuth.mockRejectedValue(new Error('Realtime unavailable'))
    const retry = watchCloudGroups(vi.fn())
    await vi.waitFor(() => expect(live.setAuth).toHaveBeenCalled())
    expect(live.channel).not.toHaveBeenCalled()
    retry()
  })

  it('waits for a previous watcher’s topic to leave before creating its replacement', async () => {
    const held = new Map<string, ReturnType<typeof live.createChannel>>()
    live.channel.mockImplementation((topic, config) => {
      const existing = held.get(topic)
      if (existing) return existing
      const created = live.createChannel(topic, config)
      held.set(topic, created)
      return created
    })
    let release!: () => void
    live.removeChannel.mockImplementation(
      channel =>
        new Promise<string>(resolve => {
          release = () => {
            held.delete(channel.topic)
            resolve('ok')
          }
        }),
    )
    const { watchCloudGroups } = await import('./groups')
    const firstStop = watchCloudGroups(vi.fn())
    await vi.waitFor(() => expect(live.channel).toHaveBeenCalledTimes(1))
    firstStop()
    const changed = vi.fn()
    const nextStop = watchCloudGroups(changed)
    await Promise.resolve()
    await Promise.resolve()
    expect(live.channel).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(() => expect(live.channel).toHaveBeenCalledTimes(2))
    expect(live.channels).toHaveLength(2)
    expect(live.channels[1]).not.toBe(live.channels[0])
    live.channels[1].status!('SUBSCRIBED')
    expect(changed).toHaveBeenCalledOnce()
    nextStop()
    release()
  })
})
