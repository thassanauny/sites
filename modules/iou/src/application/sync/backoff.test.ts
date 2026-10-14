import { describe, expect, it } from 'vitest'
import { MAX_BACKOFF_MS, POLL_MS, pollDelay } from './backoff'

describe('pollDelay', () => {
  it('polls at the normal pace until something fails', () => {
    expect(pollDelay(0)).toBe(POLL_MS)
  })

  it('doubles the wait after each failure in a row', () => {
    expect([1, 2, 3, 4].map(pollDelay)).toEqual([20_000, 40_000, 80_000, 160_000])
  })

  it('never waits longer than the ceiling, however long the server stays down', () => {
    expect(pollDelay(5)).toBe(MAX_BACKOFF_MS)
    expect(pollDelay(1_000)).toBe(MAX_BACKOFF_MS)
  })
})
