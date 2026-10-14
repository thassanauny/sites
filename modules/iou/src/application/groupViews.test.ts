import { describe, expect, it, vi } from 'vitest'
import type { Group } from '../domain/groups/types'
import { balancesOf, memoizeByObject, newestFirst, settlementsOf } from './groupViews'

const stamp = '2026-10-08T00:00:00.000Z'
const group: Group = {
  id: 'trip',
  name: 'Trip',
  description: '',
  currency: 'THB',
  icon: 'plane',
  color: '#e1ebf3',
  inviteCode: 'a'.repeat(32),
  createdAt: stamp,
  updatedAt: stamp,
  members: [
    { id: 'amy', name: 'Amy' },
    { id: 'ben', name: 'Ben' },
  ],
  transactions: [
    { id: 'old', type: 'expense', description: 'Old', amount: 1_000, paidBy: 'amy', shares: { amy: 500, ben: 500 }, category: 'food', date: '2026-10-01', createdAt: stamp },
    { id: 'new', type: 'expense', description: 'New', amount: 2_000, paidBy: 'ben', shares: { amy: 1_000, ben: 1_000 }, category: 'food', date: '2026-10-05', createdAt: stamp },
  ],
}

describe('per-group memoization', () => {
  it('computes once for the same object and again for a changed copy', () => {
    const compute = vi.fn((value: { n: number }) => value.n * 2)
    const double = memoizeByObject(compute)
    const input = { n: 2 }
    expect(double(input)).toBe(4)
    expect(double(input)).toBe(4)
    expect(compute).toHaveBeenCalledOnce()
    expect(double({ ...input })).toBe(4)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('returns the same balances, settlements and sorted transactions while a group is unchanged', () => {
    expect(balancesOf(group)).toBe(balancesOf(group))
    expect(settlementsOf(group)).toBe(settlementsOf(group))
    expect(newestFirst(group)).toBe(newestFirst(group))
    expect(newestFirst(group).map(transaction => transaction.id)).toEqual(['new', 'old'])
    expect(group.transactions.map(transaction => transaction.id)).toEqual(['old', 'new'])
  })
})
