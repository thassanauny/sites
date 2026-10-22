import { describe, expect, it, vi } from 'vitest'
import { mapConcurrent, SYNC_CONCURRENCY } from './concurrency'

describe('bounded sync work', () => {
  it('starts three requests, preserves result order and continues when a slot opens', async () => {
    const waiting = new Map<number, (value: number) => void>()
    const work = vi.fn((id: number) => new Promise<number>(resolve => waiting.set(id, resolve)))
    const result = mapConcurrent([0, 1, 2, 3, 4], work)
    expect(work).toHaveBeenCalledTimes(SYNC_CONCURRENCY)
    waiting.get(2)!(20)
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(4))
    waiting.get(3)!(30)
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(5))
    for (const id of [4, 1, 0]) waiting.get(id)!(id * 10)
    await expect(result).resolves.toEqual([0, 10, 20, 30, 40])
  })

  it('stops scheduling after failure and waits for already started requests', async () => {
    const waiting: (() => void)[] = []
    const failure = new Error('Connection lost')
    const work = vi.fn((id: number) => (id === 0 ? Promise.reject(failure) : new Promise<void>(resolve => waiting.push(resolve))))
    let finished = false
    const result = mapConcurrent([0, 1, 2, 3, 4], work).finally(() => {
      finished = true
    })
    await Promise.resolve()
    expect(work).toHaveBeenCalledTimes(3)
    expect(finished).toBe(false)
    const checked = expect(result).rejects.toBe(failure)
    for (const resolve of waiting) resolve()
    await checked
    expect(work).toHaveBeenCalledTimes(3)
  })
})
