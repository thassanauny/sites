import { describe, expect, it } from 'vitest'
import type { Group } from '../domain/groups/types'
import { emptyStore, mergeCloudStore, removeGroupFromDevice, type AppStore } from './deviceStore'
import { queueGroup } from './sync/queue'

const stamp = '2026-10-08T00:00:00.000Z'
const named = (id: string, extra: Partial<Group> = {}): Group => ({
  id,
  name: `Group ${id}`,
  description: '',
  currency: 'THB',
  icon: 'plane',
  color: '#e1ebf3',
  inviteCode: id.repeat(32).slice(0, 32),
  createdAt: stamp,
  updatedAt: stamp,
  members: [
    { id: `${id}-amy`, name: 'Amy' },
    { id: `${id}-ben`, name: 'Ben' },
  ],
  transactions: [],
  ...extra,
})
const holding = (...groups: Group[]): AppStore => ({ ...emptyStore(), groups, cloudRevisions: Object.fromEntries(groups.map(group => [group.id, 1])) })

describe('merging shared groups into the device store', () => {
  it('returns the very same store when the records bring nothing new', () => {
    const store = holding(named('a'), named('b'))
    expect(mergeCloudStore(store, [{ group: named('a'), revision: 1 }])).toBe(store)
    expect(mergeCloudStore(store, [])).toBe(store)
    expect(mergeCloudStore(store, [{ group: named('a', { name: 'Stale' }), revision: 0 }])).toBe(store)
  })

  it('replaces only the groups that moved ahead and keeps the others as they were', () => {
    const store = holding(named('a'), named('b'))
    const merged = mergeCloudStore(store, [{ group: named('b', { name: 'Newer' }), revision: 2 }])
    expect(merged).not.toBe(store)
    expect(merged.groups[0]).toBe(store.groups[0])
    expect(merged.groups[1]!.name).toBe('Newer')
    expect(merged.cloudRevisions).toEqual({ a: 1, b: 2 })
  })

  it('adds a group this device did not have', () => {
    const merged = mergeCloudStore(emptyStore(), [{ group: named('a'), revision: 4 }])
    expect(merged.groups.map(group => group.id)).toEqual(['a'])
    expect(merged.cloudRevisions).toEqual({ a: 4 })
  })

  it('keeps a removed group out, and brings it back only when asked to restore it', () => {
    const removed = removeGroupFromDevice(holding(named('a')), 'a')
    expect(mergeCloudStore(removed, [{ group: named('a'), revision: 2 }]).groups).toEqual([])
    expect(mergeCloudStore(removed, [{ group: named('a'), revision: 2 }], 'a').groups.map(group => group.id)).toEqual(['a'])
  })

  it('rebases a waiting edit onto the newer shared copy', () => {
    const queued = queueGroup(holding(named('a')), named('a', { name: 'Offline name', updatedAt: '2026-10-08T00:05:00.000Z' }))
    const merged = mergeCloudStore(queued, [{ group: named('a', { description: 'Theirs', updatedAt: '2026-10-08T00:01:00.000Z' }), revision: 2 }])
    expect(merged.outbox[0]).toMatchObject({ revision: 2, group: { name: 'Offline name', description: 'Theirs' } })
    expect(merged.cloudRevisions).toEqual({ a: 2 })
  })
})
