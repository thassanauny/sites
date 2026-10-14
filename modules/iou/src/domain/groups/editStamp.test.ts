import { describe, expect, it } from 'vitest'
import { editStamp } from './editStamp'
import { validateGroup } from '../ledger/calculations'
import type { Group } from './types'

const group = (createdAt: string, updatedAt: string): Group => ({
  id: 'trip',
  name: 'Trip',
  description: '',
  currency: 'THB',
  icon: 'trip',
  color: '#10b981',
  inviteCode: 'a'.repeat(32),
  createdAt,
  updatedAt,
  members: [{ id: 'amy', name: 'Amy' }],
  transactions: [],
})

describe('editStamp', () => {
  it('uses the device clock when it is ahead of the latest edit', () => {
    expect(editStamp('2026-10-08T09:00:00.000Z', new Date('2026-10-08T09:30:00.000Z'))).toBe('2026-10-08T09:30:00.000Z')
  })

  it('is one millisecond after the latest edit when the device clock is behind it', () => {
    expect(editStamp('2026-10-09T12:00:00.000Z', new Date('2026-10-08T09:00:00.000Z'))).toBe('2026-10-09T12:00:00.001Z')
  })

  it('is later than the latest edit even when both happen in the same millisecond', () => {
    expect(editStamp('2026-10-08T09:00:00.000Z', new Date('2026-10-08T09:00:00.000Z'))).toBe('2026-10-08T09:00:00.001Z')
  })

  it('accepts timestamps written without milliseconds', () => {
    expect(editStamp('2026-10-09T12:00:00Z', new Date('2026-10-08T09:00:00.000Z'))).toBe('2026-10-09T12:00:00.001Z')
  })

  it('keeps an edit valid when the creating device’s clock was a day ahead of this one', () => {
    const created = group('2026-10-09T12:00:00.000Z', '2026-10-09T12:00:00.000Z')
    const now = new Date('2026-10-08T09:00:00.000Z')
    expect(() => validateGroup({ ...created, updatedAt: now.toISOString() })).toThrow('Group update time cannot be before its creation time')
    expect(validateGroup({ ...created, updatedAt: editStamp(created.updatedAt, now) }).updatedAt).toBe('2026-10-09T12:00:00.001Z')
  })
})
