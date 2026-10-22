import { afterEach, describe, expect, it, vi } from 'vitest'
import { withSyncLock } from './lock'

afterEach(() => vi.unstubAllGlobals())

describe('sync between tabs', () => {
  it('keeps only one sync active and releases ownership after failure', async () => {
    let held = false
    const request = vi.fn(async (_name, options, callback) => {
      expect(options).toEqual({ ifAvailable: true })
      if (held) return callback(null)
      held = true
      try {
        return await callback({ name: 'iou:sync' })
      } finally {
        held = false
      }
    })
    vi.stubGlobal('navigator', { locks: { request } })
    let release!: () => void
    const first = withSyncLock(
      () =>
        new Promise<void>(resolve => {
          release = resolve
        }),
    )
    const competing = vi.fn(async () => 'duplicate upload')
    await expect(withSyncLock(competing)).resolves.toBeUndefined()
    expect(competing).not.toHaveBeenCalled()
    release()
    await first
    await expect(
      withSyncLock(async () => {
        throw new Error('Connection lost')
      }),
    ).rejects.toThrow('Connection lost')
    await expect(withSyncLock(async () => 'next sync')).resolves.toBe('next sync')
    expect(request).toHaveBeenCalledWith('iou:sync', { ifAvailable: true }, expect.any(Function))
  })

  it('retains revision-checked sync when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})
    await expect(withSyncLock(async () => 'synced')).resolves.toBe('synced')
  })
})
