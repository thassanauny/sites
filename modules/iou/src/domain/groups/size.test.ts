import { describe, expect, it } from 'vitest'
import { groupBytes, MAX_GROUP_BYTES } from './size'
import type { Group } from './types'

/** An independent rendering of jsonb's text output: ": " and ", " separators, strings escaped as in JSON. */
function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`)
      .join(', ')}}`
  return JSON.stringify(value)
}

const group = (overrides: Partial<Group> = {}): Group => ({
  id: 'trip',
  name: 'Trip',
  description: '',
  currency: 'THB',
  icon: 'trip',
  color: '#10b981',
  inviteCode: 'a'.repeat(32),
  createdAt: '2026-10-08T09:00:00.000Z',
  updatedAt: '2026-10-08T09:00:00.000Z',
  members: [
    { id: 'amy', name: 'Amy' },
    { id: 'ben', name: 'Ben' },
  ],
  transactions: [
    { id: 'dinner', type: 'expense', description: 'Dinner', amount: 1000, paidBy: 'amy', shares: { amy: 500, ben: 500 }, category: 'food', date: '2026-10-08', createdAt: '2026-10-08T09:00:00.000Z' },
  ],
  ...overrides,
})

describe('groupBytes', () => {
  it('counts the bytes of the text jsonb prints', () => {
    const plain = group()
    expect(groupBytes(plain)).toBe(Buffer.byteLength(jsonbText(plain)))
    expect(groupBytes(plain)).toBeGreaterThan(Buffer.byteLength(JSON.stringify(plain)))
  })

  it('counts multi-byte characters, escapes, and separators written inside text', () => {
    const awkward = group({
      name: 'Zoë’s “trip”, 東京: 🍜🍣',
      description: 'He said "hi"\\ then\tleft,\nand: returned',
      members: [
        { id: 'amy', name: '🧑‍🤝‍🧑 Amy' },
        { id: 'ben', name: 'Бен' },
      ],
    })
    expect(groupBytes(awkward)).toBe(Buffer.byteLength(jsonbText(awkward)))
  })

  it('treats a colon or comma inside text as one byte, not a separator', () => {
    const base = groupBytes(group({ description: 'abc' }))
    expect(groupBytes(group({ description: 'a:,' }))).toBe(base)
  })

  it('stays under the limit for an ordinary group and counts the empty one', () => {
    expect(groupBytes(group())).toBeLessThan(1_000)
    expect(groupBytes(group({ transactions: [] }))).toBeLessThan(groupBytes(group()))
    expect(MAX_GROUP_BYTES).toBe(4_000_000)
  })
})
