import { describe, expect, it, vi } from 'vitest'
import { queueGroup, queueJoin } from './queue'
import { emptyStore, removeGroupFromDevice, type AppStore } from '../deviceStore'
import { CloudConflictError, syncOffline, type CloudRecord, type SyncDevice, type SyncTransport } from './synchronize'
import type { Expense, Group } from '../../domain/groups/types'

const time = (n: number) => `2026-10-08T09:${String(n).padStart(2, '0')}:00.000Z`
const group = (): Group => ({
  id: 'trip',
  name: 'Trip',
  description: '',
  currency: 'THB',
  icon: 'trip',
  color: '#10b981',
  inviteCode: 'a'.repeat(32),
  createdAt: time(0),
  updatedAt: time(0),
  members: [
    { id: 'amy', name: 'Amy' },
    { id: 'ben', name: 'Ben' },
  ],
  transactions: [],
})
const expense = (id: string): Expense => ({
  id,
  type: 'expense',
  description: id,
  amount: 1000,
  paidBy: 'amy',
  shares: { amy: 500, ben: 500 },
  category: 'food',
  date: '2026-10-08',
  createdAt: time(1),
})
function fixture(initial: AppStore, record?: CloudRecord) {
  let store = initial
  let server = record
  let online = true
  const device: SyncDevice = {
    read: () => store,
    update: change => {
      store = change(store)
    },
    online: () => online,
  }
  const cloud: SyncTransport = {
    versions: vi.fn(async () => (server ? [{ id: server.group.id, revision: server.revision }] : [])),
    load: vi.fn(async (ids: readonly string[]) => ({ records: server && ids.includes(server.group.id) ? [structuredClone(server)] : [], unreadable: [] })),
    create: vi.fn(async payload => {
      server ??= { group: { ...structuredClone(payload), inviteCode: 'b'.repeat(32) }, revision: 1 }
      return structuredClone(server)
    }),
    save: vi.fn(async (payload, revision) => {
      if (revision !== server?.revision) throw new CloudConflictError()
      server = { group: structuredClone(payload), revision: revision + 1 }
      return structuredClone(server)
    }),
    join: vi.fn(async () => {
      if (!server) throw new Error('Missing invitation')
      return structuredClone(server)
    }),
  }
  return {
    device,
    cloud,
    store: () => store,
    server: () => server,
    setServer: (record: CloudRecord) => {
      server = record
    },
    setOnline: (value: boolean) => {
      online = value
    },
  }
}

describe('automatic offline sync', () => {
  it('makes no network calls offline, then creates a group and uploads its entire ledger once', async () => {
    const draft = {
      ...group(),
      updatedAt: time(1),
      transactions: [expense('dinner'), { id: 'payment', type: 'payment' as const, fromId: 'ben', toId: 'amy', amount: 500, note: '', date: '2026-10-08', createdAt: time(1) }],
    }
    const f = fixture(queueGroup(emptyStore(), draft, 'amy'))
    f.setOnline(false)
    await syncOffline(f.device, f.cloud)
    expect(f.cloud.versions).not.toHaveBeenCalled()
    expect(f.store().outbox).toHaveLength(1)
    f.setOnline(true)
    await syncOffline(f.device, f.cloud)
    expect(f.server()?.group.transactions).toEqual(draft.transactions)
    expect(f.store().groups[0].inviteCode).toBe('b'.repeat(32))
    expect(f.store().outbox).toEqual([])
    await syncOffline(f.device, f.cloud)
    expect(f.cloud.create).toHaveBeenCalledTimes(1)
  })

  it('retries a lost upload response without duplicate transactions', async () => {
    const base = group()
    const f = fixture(queueGroup({ ...emptyStore(), groups: [base], cloudRevisions: { trip: 1 } }, { ...base, transactions: [expense('dinner')], updatedAt: time(1) }), { group: base, revision: 1 })
    const save = f.cloud.save
    f.cloud.save = vi.fn(async (payload, revision) => {
      await save(payload, revision)
      throw new Error('Response lost')
    })
    await expect(syncOffline(f.device, f.cloud)).rejects.toThrow('Response lost')
    expect(f.store().outbox).toHaveLength(1)
    f.cloud.save = save
    await syncOffline(f.device, f.cloud)
    expect(f.store().outbox).toEqual([])
    expect(f.server()?.group.transactions.map(t => t.id)).toEqual(['dinner'])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('recovers a lost creation response while preserving a subsequent offline rename', async () => {
    const f = fixture(queueGroup(emptyStore(), group(), 'amy'))
    const create = f.cloud.create
    f.cloud.create = vi.fn(async payload => {
      await create(payload)
      throw new Error('Response lost')
    })
    await expect(syncOffline(f.device, f.cloud)).rejects.toThrow('Response lost')
    f.device.update(store => queueGroup(store, { ...store.groups[0], name: 'Later name', updatedAt: time(2) }))
    f.cloud.create = create
    await syncOffline(f.device, f.cloud)
    expect(create).toHaveBeenCalledTimes(1)
    expect(f.server()?.group.name).toBe('Later name')
    expect(f.store().outbox).toEqual([])
  })

  it('refreshes a revision conflict, keeps independent additions, and uses the latest conflicting edit', async () => {
    const base = group()
    const f = fixture(queueGroup({ ...emptyStore(), groups: [base], cloudRevisions: { trip: 1 } }, { ...base, name: 'Offline name', updatedAt: time(2), transactions: [expense('ours')] }), {
      group: base,
      revision: 1,
    })
    const save = f.cloud.save
    f.cloud.save = vi.fn(async (payload, revision) => {
      if (revision === 1) f.setServer({ group: { ...base, name: 'Latest name', transactions: [expense('theirs')], updatedAt: time(3) }, revision: 2 })
      return save(payload, revision)
    })
    await syncOffline(f.device, f.cloud)
    expect(f.server()?.group.name).toBe('Latest name')
    expect(f.server()?.group.transactions.map(t => t.id)).toEqual(['theirs', 'ours'])
    expect(f.store().outbox).toEqual([])
  })

  it('saves edits from another tab during an upload, keeping its pin and Travel mode preference', async () => {
    const base = group()
    const f = fixture(queueGroup({ ...emptyStore(), groups: [base], cloudRevisions: { trip: 1 } }, { ...base, updatedAt: time(1), transactions: [expense('first')] }), { group: base, revision: 1 })
    const save = f.cloud.save
    f.cloud.save = vi.fn(async (payload, revision) => {
      if (revision === 1)
        f.device.update(store => ({
          ...queueGroup(store, { ...store.groups[0], updatedAt: time(2), transactions: [...store.groups[0].transactions, expense('second')] }),
          pinnedIds: ['trip'],
          travelMode: { enabled: true, defaultGroupId: 'trip' },
        }))
      return save(payload, revision)
    })
    await syncOffline(f.device, f.cloud)
    expect(f.server()?.group.transactions).toHaveLength(2)
    expect(f.store().pinnedIds).toEqual(['trip'])
    expect(f.store().travelMode.enabled).toBe(true)
    expect(f.store().outbox).toEqual([])
  })

  it('keeps changes queued on a storage failure after a successful server write', async () => {
    const base = group()
    const f = fixture(queueGroup({ ...emptyStore(), groups: [base], cloudRevisions: { trip: 1 } }, { ...base, updatedAt: time(1), transactions: [expense('dinner')] }), { group: base, revision: 1 })
    const update = f.device.update
    f.device.update = change => {
      if (f.server()?.revision === 2) throw new Error('Storage full')
      update(change)
    }
    await expect(syncOffline(f.device, f.cloud)).rejects.toThrow('Storage full')
    expect(f.store().outbox).toHaveLength(1)
    f.device.update = update
    await syncOffline(f.device, f.cloud)
    expect(f.store().outbox).toEqual([])
    expect(f.server()?.group.transactions).toHaveLength(1)
  })

  it('finishes a saved invitation using an existing name, avoiding duplicate members on retry', async () => {
    const request = { code: 'a'.repeat(32), name: 'Amy', memberId: 'new-id', createdAt: time(2) }
    const f = fixture(queueJoin(emptyStore(), request), { group: group(), revision: 1 })
    await syncOffline(f.device, f.cloud)
    expect(f.store().memberByGroup.trip).toBe('amy')
    expect(f.store().pendingJoins).toEqual([])
    expect(f.store().groups[0].members).toHaveLength(2)
  })

  it('adds a new offline member and keeps removed groups hidden after their pending edits sync', async () => {
    const f = fixture(queueJoin(emptyStore(), { code: 'a'.repeat(32), name: 'Cal', memberId: 'cal', createdAt: time(2) }), { group: group(), revision: 1 })
    await syncOffline(f.device, f.cloud)
    expect(f.server()?.group.members).toContainEqual({ id: 'cal', name: 'Cal' })
    f.device.update(store => removeGroupFromDevice(queueGroup(store, { ...store.groups[0], name: 'Final name', updatedAt: time(3) }), 'trip'))
    await syncOffline(f.device, f.cloud)
    expect(f.server()?.group.name).toBe('Final name')
    expect(f.store().groups).toEqual([])
    expect(f.store().outbox).toEqual([])
  })

  it('retains pending edits when disconnected mid-sync, then resumes', async () => {
    const f = fixture(queueGroup(emptyStore(), group()))
    f.cloud.versions = vi.fn(async () => {
      f.setOnline(false)
      return []
    })
    await syncOffline(f.device, f.cloud)
    expect(f.cloud.create).not.toHaveBeenCalled()
    expect(f.store().outbox).toHaveLength(1)
    f.setOnline(true)
    f.cloud.versions = vi.fn(async () => [])
    await syncOffline(f.device, f.cloud)
    expect(f.store().outbox).toEqual([])
  })

  it('does not resurrect a group removed by another tab during its upload', async () => {
    const base = group()
    const f = fixture(queueGroup({ ...emptyStore(), groups: [base], cloudRevisions: { trip: 1 } }, { ...base, name: 'Offline rename', updatedAt: time(1) }), { group: base, revision: 1 })
    const save = f.cloud.save
    f.cloud.save = async (payload, revision) => {
      f.device.update(store => removeGroupFromDevice(store, 'trip'))
      return save(payload, revision)
    }
    await syncOffline(f.device, f.cloud)
    expect(f.server()?.group.name).toBe('Offline rename')
    expect(f.store().groups).toEqual([])
    expect(f.store().removedGroupIds).toEqual(['trip'])
    expect(f.store().outbox).toEqual([])
  })

  it('bounds repeated revision conflicts and retains the queue for the next automatic attempt', async () => {
    const base = group()
    const f = fixture(queueGroup({ ...emptyStore(), groups: [base], cloudRevisions: { trip: 1 } }, { ...base, name: 'Offline rename', updatedAt: time(1) }), { group: base, revision: 1 })
    f.cloud.save = vi.fn(async () => {
      throw new CloudConflictError()
    })
    await expect(syncOffline(f.device, f.cloud)).rejects.toThrow(/retry automatically/)
    expect(f.cloud.save).toHaveBeenCalledTimes(3)
    expect(f.store().outbox[0].group.name).toBe('Offline rename')
  })

  it('does not let a failed invitation block other pending group changes', async () => {
    const store = queueJoin(queueGroup(emptyStore(), group()), { code: 'd'.repeat(32), name: 'Cal', memberId: 'cal', createdAt: time(1) })
    const f = fixture(store)
    await expect(syncOffline(f.device, f.cloud)).rejects.toThrow('Missing invitation')
    expect(f.server()?.group.name).toBe('Trip')
    expect(f.store().outbox).toEqual([])
    expect(f.store().pendingJoins).toEqual(store.pendingJoins)
  })
})

describe('late invitation responses', () => {
  it('does not restore a group removed while its queued join was in flight', async () => {
    const base = group()
    const initial = queueJoin({ ...emptyStore(), groups: [base], cloudRevisions: { trip: 1 } }, { code: base.inviteCode, name: 'Amy', memberId: 'amy', createdAt: time(1) })
    const f = fixture(initial, { group: base, revision: 1 })
    f.cloud.join = vi.fn(async () => {
      f.device.update(store => removeGroupFromDevice(store, 'trip'))
      return { group: base, revision: 1 }
    })
    await syncOffline(f.device, f.cloud)
    expect(f.store().groups).toEqual([])
    expect(f.store().removedGroupIds).toEqual(['trip'])
    expect(f.store().pendingJoins).toEqual([])
    f.device.update(store => queueJoin(store, { code: base.inviteCode, name: 'Amy', memberId: 'amy', createdAt: time(2) }))
    f.cloud.join = vi.fn(async () => ({ group: base, revision: 1 }))
    await syncOffline(f.device, f.cloud)
    expect(f.store().groups.map(item => item.id)).toEqual(['trip'])
    expect(f.store().removedGroupIds).toEqual([])
  })
  it('does not accept a replaced request with identical name and membership', async () => {
    const base = group()
    const f = fixture(queueJoin(emptyStore(), { code: base.inviteCode, name: 'Amy', memberId: 'amy', createdAt: time(1) }), { group: base, revision: 1 })
    f.cloud.versions = vi.fn(async () => [])
    f.cloud.join = vi.fn(async () => {
      f.device.update(store => queueJoin(store, { code: base.inviteCode, name: 'Amy', memberId: 'amy', createdAt: time(2) }))
      return { group: base, revision: 1 }
    })
    await syncOffline(f.device, f.cloud)
    expect(f.store().groups).toEqual([])
    expect(f.store().pendingJoins[0].createdAt).toBe(time(2))
  })
})

describe('refreshing only what changed', () => {
  const named = (id: string, name = `Group ${id}`): Group => ({ ...group(), id, name, inviteCode: id.repeat(32).slice(0, 32) })
  const cached = (...groups: Group[]): AppStore => ({ ...emptyStore(), groups, cloudRevisions: Object.fromEntries(groups.map(item => [item.id, 1])) })
  function shared(initial: AppStore, records: CloudRecord[]) {
    let store = initial
    let updates = 0
    const server = new Map(records.map(record => [record.group.id, record]))
    const unreadable = new Set<string>()
    const device: SyncDevice = {
      read: () => store,
      update: change => {
        const next = change(store)
        if (next !== store) updates++
        store = next
      },
      online: () => true,
    }
    const cloud: SyncTransport = {
      versions: vi.fn(async () => [...server.values()].map(record => ({ id: record.group.id, revision: record.revision }))),
      load: vi.fn(async (ids: readonly string[]) => ({
        records: ids.filter(id => server.has(id) && !unreadable.has(id)).map(id => structuredClone(server.get(id)!)),
        unreadable: ids.filter(id => server.has(id) && unreadable.has(id)),
      })),
      create: vi.fn(async payload => {
        const record = { group: { ...structuredClone(payload), inviteCode: 'f'.repeat(32) }, revision: 1 }
        server.set(payload.id, record)
        return structuredClone(record)
      }),
      save: vi.fn(async (payload, revision) => {
        if (revision !== server.get(payload.id)?.revision) throw new CloudConflictError()
        const record = { group: structuredClone(payload), revision: revision + 1 }
        server.set(payload.id, record)
        return structuredClone(record)
      }),
      join: vi.fn(async () => {
        throw new Error('Unexpected join')
      }),
    }
    return { device, cloud, server, unreadable, store: () => store, updates: () => updates }
  }

  it('asks only for revisions, and neither downloads nor saves anything, when nothing changed', async () => {
    const [a, b] = [named('a'), named('b')]
    const initial = cached(a, b)
    const f = shared(initial, [
      { group: a, revision: 1 },
      { group: b, revision: 1 },
    ])
    const result = await syncOffline(f.device, f.cloud)
    expect(f.cloud.versions).toHaveBeenCalledOnce()
    expect(f.cloud.load).not.toHaveBeenCalled()
    expect(f.updates()).toBe(0)
    expect(f.store()).toBe(initial)
    expect(result).toEqual({ accessible: ['a', 'b'], unreadable: [] })
  })

  it('downloads only the groups whose revision moved and keeps the others untouched', async () => {
    const [a, b] = [named('a'), named('b')]
    const initial = cached(a, b)
    const f = shared(initial, [
      { group: a, revision: 1 },
      { group: { ...b, name: 'Renamed', updatedAt: time(5) }, revision: 2 },
    ])
    await syncOffline(f.device, f.cloud)
    expect(f.cloud.load).toHaveBeenCalledOnce()
    expect(f.cloud.load).toHaveBeenCalledWith(['b'])
    expect(f.store().groups[0]).toBe(initial.groups[0])
    expect(f.store().groups[1]!.name).toBe('Renamed')
    expect(f.store().cloudRevisions).toEqual({ a: 1, b: 2 })
  })

  it('downloads a group this device has never held', async () => {
    const f = shared(emptyStore(), [{ group: named('a'), revision: 3 }])
    await syncOffline(f.device, f.cloud)
    expect(f.cloud.load).toHaveBeenCalledWith(['a'])
    expect(f.store().groups.map(item => item.id)).toEqual(['a'])
    expect(f.store().cloudRevisions).toEqual({ a: 3 })
  })

  it('does not download a group removed from this device, but still reports it reachable', async () => {
    const a = named('a')
    const removed = removeGroupFromDevice(cached(a), 'a')
    const f = shared(removed, [{ group: { ...a, name: 'Changed elsewhere', updatedAt: time(5) }, revision: 2 }])
    const result = await syncOffline(f.device, f.cloud)
    expect(f.cloud.load).not.toHaveBeenCalled()
    expect(f.store().groups).toEqual([])
    expect(result.accessible).toEqual(['a'])
  })

  it('does not report a group that is no longer shared with this identity', async () => {
    const [a, b] = [named('a'), named('b')]
    const f = shared(cached(a, b), [{ group: a, revision: 1 }])
    const result = await syncOffline(f.device, f.cloud)
    expect(result.accessible).toEqual(['a'])
    expect(f.store().groups).toHaveLength(2)
  })

  it('reloads only the group that conflicted', async () => {
    const [a, b] = [named('a'), named('b')]
    const edited = queueGroup(cached(a, b), { ...a, name: 'Offline rename', updatedAt: time(3) })
    const f = shared(edited, [
      { group: a, revision: 1 },
      { group: b, revision: 1 },
    ])
    const save = f.cloud.save
    f.cloud.save = vi.fn(async (payload, revision) => {
      // Someone else saves group a between the revision check and this upload.
      if (revision === 1) f.server.set('a', { group: { ...a, description: 'Theirs', updatedAt: time(2) }, revision: 2 })
      return save(payload, revision)
    })
    await syncOffline(f.device, f.cloud)
    expect(f.cloud.load).toHaveBeenCalledOnce()
    expect(f.cloud.load).toHaveBeenCalledWith(['a'])
    expect(f.server.get('a')!.group).toMatchObject({ name: 'Offline rename', description: 'Theirs' })
    expect(f.store().outbox).toEqual([])
  })

  it('reports a group it cannot read without blocking the others', async () => {
    const [a, b, c] = [named('a'), named('b'), named('c')]
    const initial = queueGroup(cached(a, b, c), { ...c, name: 'Edited offline', updatedAt: time(3) })
    const f = shared(initial, [
      { group: a, revision: 2 },
      { group: { ...b, name: 'Newer' }, revision: 2 },
      { group: c, revision: 1 },
    ])
    f.unreadable.add('a')
    const result = await syncOffline(f.device, f.cloud)
    expect(result.unreadable).toEqual(['a'])
    expect(f.store().groups.find(item => item.id === 'b')!.name).toBe('Newer')
    expect(f.store().groups.find(item => item.id === 'a')!.name).toBe('Group a')
    expect(f.server.get('c')!.group.name).toBe('Edited offline')
    expect(f.store().outbox).toEqual([])
  })

  it('does not download a group it could not read again until the group changes', async () => {
    const [a, b] = [named('a'), named('b')]
    const f = shared(cached(a, b), [
      { group: a, revision: 2 },
      { group: b, revision: 1 },
    ])
    f.unreadable.add('a')
    const memory = new Map<string, number>()
    expect((await syncOffline(f.device, f.cloud, memory)).unreadable).toEqual(['a'])
    expect((await syncOffline(f.device, f.cloud, memory)).unreadable).toEqual(['a'])
    expect(f.cloud.load).toHaveBeenCalledOnce()
    // The server moves on, but this version still cannot read the new revision.
    f.server.set('a', { group: a, revision: 3 })
    expect((await syncOffline(f.device, f.cloud, memory)).unreadable).toEqual(['a'])
    expect(f.cloud.load).toHaveBeenCalledTimes(2)
    expect(f.cloud.load).toHaveBeenLastCalledWith(['a'])
    // Then it becomes readable.
    f.server.set('a', { group: { ...a, name: 'Readable', updatedAt: time(5) }, revision: 4 })
    f.unreadable.delete('a')
    expect((await syncOffline(f.device, f.cloud, memory)).unreadable).toEqual([])
    expect(f.store().groups.find(item => item.id === 'a')!.name).toBe('Readable')
    expect(memory.size).toBe(0)
  })

  it('stops remembering a group once it is no longer shared with this identity', async () => {
    const a = named('a')
    const f = shared(cached(a), [])
    const memory = new Map([['a', 2]])
    expect(await syncOffline(f.device, f.cloud, memory)).toEqual({ accessible: [], unreadable: [] })
    expect(memory.size).toBe(0)
  })

  it('does not reload a group after a conflict while its shared copy is known to be unreadable', async () => {
    const a = named('a')
    const f = shared(queueGroup(cached(a), { ...a, name: 'Offline rename', updatedAt: time(3) }), [{ group: a, revision: 2 }])
    f.unreadable.add('a')
    await expect(syncOffline(f.device, f.cloud, new Map())).rejects.toBeInstanceOf(CloudConflictError)
    expect(f.cloud.load).toHaveBeenCalledOnce()
    expect(f.store().outbox).toHaveLength(1)
  })

  it('still fails when a probe or download fails, leaving queued changes in place', async () => {
    const a = named('a')
    const queued = queueGroup(cached(a), { ...a, name: 'Queued', updatedAt: time(3) })
    const f = shared(queued, [{ group: a, revision: 1 }])
    f.cloud.versions = vi.fn(async () => {
      throw new Error('Could not connect to shared groups. Check your connection and try again.')
    })
    await expect(syncOffline(f.device, f.cloud)).rejects.toThrow('Check your connection')
    expect(f.cloud.save).not.toHaveBeenCalled()
    expect(f.store().outbox).toHaveLength(1)
  })
})
