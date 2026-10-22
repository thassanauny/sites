// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDeviceSession } from './deviceSession'
import { emptyStore } from './deviceStore'
import { readSavedStore, saveStore } from '../infrastructure/storage/store'
import { useSync } from './useSync'
import type { CloudVersion } from './sync/synchronize'

const cloud = vi.hoisted(() => ({ versions: vi.fn(), load: vi.fn(), watch: vi.fn() }))
vi.mock('../infrastructure/cloud/groups', () => ({
  cloudConfigured: true,
  loadCloudVersions: cloud.versions,
  loadCloudGroups: cloud.load,
  createCloudGroup: vi.fn(),
  saveCloudGroup: vi.fn(),
  joinCloudGroup: vi.fn(),
  watchCloudGroups: cloud.watch,
}))
let root: Root
let host: HTMLDivElement
let result: ReturnType<typeof useSync>
let visibility: DocumentVisibilityState
let stopped: ReturnType<typeof vi.fn>
let changed: (version?: CloudVersion) => void
let health: (healthy: boolean) => void
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  cloud.versions.mockReset().mockResolvedValue([])
  cloud.load.mockReset().mockResolvedValue({ records: [], unreadable: [] })
  stopped = vi.fn()
  cloud.watch.mockReset().mockImplementation((callback, reportHealth) => {
    changed = callback
    health = reportHealth
    return stopped
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (document as { visibilityState?: unknown }).visibilityState
})
async function mount(session = createDeviceSession(readSavedStore())) {
  function Probe() {
    result = useSync(session, false)
    return null
  }
  await act(async () => root.render(createElement(Probe)))
}

it('coalesces bursts, catches a signal arriving during a sync and keeps the polling fallback', async () => {
  await mount()
  expect(cloud.versions).toHaveBeenCalledTimes(1)
  await act(async () => {
    for (let index = 0; index < 20; index++) changed({ id: 'trip', revision: 2 })
    await vi.advanceTimersByTimeAsync(150)
  })
  expect(cloud.versions).toHaveBeenCalledTimes(2)
  let release!: (value: CloudVersion[]) => void
  cloud.versions.mockImplementationOnce(
    () =>
      new Promise<CloudVersion[]>(resolve => {
        release = resolve
      }),
  )
  let syncing!: Promise<void>
  await act(async () => {
    syncing = result.sync()
  })
  await act(async () => {
    changed({ id: 'trip', revision: 3 })
    await vi.advanceTimersByTimeAsync(150)
  })
  expect(cloud.versions).toHaveBeenCalledTimes(3)
  await act(async () => {
    release([])
    await syncing
  })
  expect(cloud.versions).toHaveBeenCalledTimes(4)
  await act(async () => vi.advanceTimersByTimeAsync(10_000))
  expect(cloud.versions).toHaveBeenCalledTimes(5)
})

it('cleans up hidden subscriptions and pending hints, then catches up after visibility returns', async () => {
  await mount()
  await act(async () => {
    changed({ id: 'trip', revision: 2 })
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(stopped).toHaveBeenCalledTimes(1)
  expect(cloud.versions).toHaveBeenCalledTimes(1)
  await act(async () => {
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(cloud.watch).toHaveBeenCalledTimes(2)
  expect(cloud.versions).toHaveBeenCalledTimes(2)
})

it('reads another tab’s durable revisions after acquiring the sync lock', async () => {
  const session = createDeviceSession(readSavedStore())
  const group = {
    id: 'trip',
    name: 'Trip',
    description: '',
    currency: 'THB',
    icon: 'trip',
    color: '#10b981',
    inviteCode: 'a'.repeat(32),
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    members: [{ id: 'amy', name: 'Amy' }],
    transactions: [],
  }
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: {
      request: async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
        saveStore({ ...emptyStore(), groups: [group], cloudRevisions: { trip: 1 } })
        return callback({})
      },
    },
  })
  expect(session.view().store.groups).toEqual([])
  await mount(session)
  expect(result.unavailableSharedIds).toEqual(['trip'])
  expect(session.view().store.cloudRevisions).toEqual({ trip: 1 })
})

it('reconciles every minute only while subscribed and restores quick polls during an active read without overlap', async () => {
  await mount()
  await act(async () => health(true))
  await act(async () => vi.advanceTimersByTimeAsync(59_999))
  expect(cloud.versions).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(cloud.versions).toHaveBeenCalledTimes(2)
  await act(async () => {
    changed({ id: 'trip', revision: 2 })
    await vi.advanceTimersByTimeAsync(150)
  })
  expect(cloud.versions).toHaveBeenCalledTimes(3)
  let release!: (value: CloudVersion[]) => void
  cloud.versions.mockImplementationOnce(
    () =>
      new Promise<CloudVersion[]>(resolve => {
        release = resolve
      }),
  )
  let reading!: Promise<void>
  await act(async () => {
    reading = result.sync()
  })
  await act(async () => health(false))
  await act(async () => vi.advanceTimersByTimeAsync(10_000))
  expect(cloud.versions).toHaveBeenCalledTimes(4)
  await act(async () => {
    release([])
    await reading
  })
  expect(cloud.versions).toHaveBeenCalledTimes(5)
  await act(async () => vi.advanceTimersByTimeAsync(9999))
  expect(cloud.versions).toHaveBeenCalledTimes(5)
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(cloud.versions).toHaveBeenCalledTimes(6)
})

it('retains failed-read backoff even when the live channel remains subscribed', async () => {
  await mount()
  await act(async () => health(true))
  cloud.versions.mockRejectedValueOnce(new Error('Connection lost'))
  await act(async () => result.sync())
  await act(async () => vi.advanceTimersByTimeAsync(19_999))
  expect(cloud.versions).toHaveBeenCalledTimes(2)
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(cloud.versions).toHaveBeenCalledTimes(3)
  await act(async () => vi.advanceTimersByTimeAsync(59_999))
  expect(cloud.versions).toHaveBeenCalledTimes(3)
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(cloud.versions).toHaveBeenCalledTimes(4)
})
