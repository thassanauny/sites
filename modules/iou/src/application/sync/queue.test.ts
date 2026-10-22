import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Group, Expense } from '../../domain/groups/types'
import { acknowledgeGroup, queueGroup, queueJoin } from './queue'
import { mergeLatestGroup } from './merge'
import { groupBytes, MAX_GROUP_BYTES } from '../../domain/groups/size'
import { emptyStore, mergeCloudStore, removeGroupFromDevice } from '../deviceStore'
import { loadStore, saveStore, STORE_KEY } from '../../infrastructure/storage/store'

const time = (minute: number) => `2026-10-08T09:${String(minute).padStart(2, '0')}:00.000Z`
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
  description: 'Dinner',
  amount: 1000,
  paidBy: 'amy',
  shares: { amy: 500, ben: 500 },
  category: 'food',
  date: '2026-10-08',
  createdAt: time(1),
})
const cached = () => ({ ...emptyStore(), groups: [group()], cloudRevisions: { trip: 1 } })
afterEach(() => vi.unstubAllGlobals())

describe('member names', () => {
  const withMembers = (...members: { id: string; name: string }[]): Group => ({ ...group(), updatedAt: time(2), members })

  it('refuses a change that gives two members the same name, ignoring case and spaces', () => {
    expect(() => queueGroup(cached(), withMembers(...group().members, { id: 'cal', name: ' amy ' }))).toThrow('Use a different name for each member.')
    expect(() => queueGroup(cached(), withMembers({ id: 'amy', name: 'Amy' }, { id: 'ben', name: 'AMY' }))).toThrow('Use a different name for each member.')
  })

  it('refuses a group that is created with a repeated name', () => {
    expect(() => queueGroup(emptyStore(), withMembers({ id: 'a', name: 'Sam' }, { id: 'b', name: 'sam' }))).toThrow('Use a different name for each member.')
  })

  it('keeps accepting other changes to a group whose members already share a name', () => {
    const doubled = withMembers(...group().members, { id: 'amy-2', name: 'AMY' })
    const store = { ...emptyStore(), groups: [doubled], cloudRevisions: { trip: 1 } }
    const next = queueGroup(store, { ...doubled, updatedAt: time(3), transactions: [expense('dinner')] })
    expect(next.outbox).toHaveLength(1)
    expect(next.groups[0]!.members).toHaveLength(3)
  })

  it('refuses another copy of a name that is already shared', () => {
    const doubled = withMembers(...group().members, { id: 'amy-2', name: 'AMY' })
    const store = { ...emptyStore(), groups: [doubled], cloudRevisions: { trip: 1 } }
    expect(() => queueGroup(store, { ...doubled, updatedAt: time(3), members: [...doubled.members, { id: 'amy-3', name: 'amy' }] })).toThrow('Use a different name for each member.')
  })

  it('allows renaming a member to a free name, and removing one of two members who share a name', () => {
    const doubled = withMembers(...group().members, { id: 'amy-2', name: 'AMY' })
    const store = { ...emptyStore(), groups: [doubled], cloudRevisions: { trip: 1 } }
    expect(queueGroup(store, { ...doubled, updatedAt: time(3), members: doubled.members.map(member => (member.id === 'amy-2' ? { ...member, name: 'Amelia' } : member)) }).outbox).toHaveLength(1)
    expect(queueGroup(store, { ...doubled, updatedAt: time(3), members: doubled.members.slice(0, 2) }).outbox).toHaveLength(1)
  })
})

describe('the size limit for sharing', () => {
  // Each expense is split among 100 people, so about 4.4 KB of the shared limit goes on every one.
  const members = Array.from({ length: 100 }, (_, index) => ({ id: `member-${String(index).padStart(3, '0')}-${'x'.repeat(24)}`, name: `Member ${index}` }))
  const shares = Object.fromEntries(members.map(member => [member.id, 1]))
  const crowdedExpense = (index: number): Expense => ({
    id: `e${index}`,
    type: 'expense',
    description: 'Dinner',
    amount: 100,
    paidBy: members[0]!.id,
    shares,
    category: 'food',
    date: '2026-10-08',
    createdAt: time(1),
  })
  const crowded = (count: number): Group => ({ ...group(), updatedAt: time(2), members, transactions: Array.from({ length: count }, (_, index) => crowdedExpense(index)) })
  const holding = (value: Group) => ({ ...emptyStore(), groups: [value], cloudRevisions: { trip: 1 } })
  const message = 'This group has reached the size limit for sharing. Delete some older transactions before adding more.'

  it('is a limit of 4,000,000 bytes that these test groups straddle', () => {
    expect(groupBytes(crowded(850))).toBeLessThan(MAX_GROUP_BYTES)
    expect(groupBytes(crowded(950))).toBeGreaterThan(MAX_GROUP_BYTES)
  })

  it('accepts changes up to the limit and refuses one that would pass it', () => {
    const fits = crowded(850)
    expect(queueGroup(holding(group()), fits).outbox).toHaveLength(1)
    expect(() => queueGroup(holding(fits), { ...crowded(950), updatedAt: time(3) })).toThrow(message)
  })

  it('refuses a new group that is already too big', () => {
    expect(() => queueGroup(emptyStore(), crowded(950))).toThrow(message)
  })

  it('lets a group that is already too big shrink, but not grow', () => {
    const over = crowded(950)
    const store = holding(over)
    expect(queueGroup(store, { ...crowded(925), updatedAt: time(3) }).outbox).toHaveLength(1)
    expect(queueGroup(store, { ...over, updatedAt: time(3), transactions: over.transactions.slice(1) }).outbox).toHaveLength(1)
    expect(() => queueGroup(store, { ...over, updatedAt: time(3), name: 'A much longer name for the trip' })).toThrow(message)
  })
})

describe('durable offline changes', () => {
  it('reopens a new offline group with expenses and payments, preserving the first sync base', () => {
    let raw: string | null = null
    vi.stubGlobal('localStorage', {
      getItem: () => raw,
      setItem: (_: string, value: string) => {
        raw = value
      },
    })
    let store = queueGroup(emptyStore(), group(), 'amy')
    store = queueGroup(store, {
      ...group(),
      updatedAt: time(2),
      transactions: [expense('dinner'), { id: 'payment', type: 'payment', fromId: 'ben', toId: 'amy', amount: 500, note: '', date: '2026-10-08', createdAt: time(2) }],
    })
    saveStore(store)
    expect(loadStore()).toEqual({ store })
    expect(store.cloudRevisions.trip).toBe(0)
    expect(store.outbox[0].base).toBeNull()
    expect(store.memberByGroup.trip).toBe('amy')
  })

  it('keeps independent transactions and applies the newest conflicting edit automatically', () => {
    const base = { ...group(), transactions: [expense('same')] }
    const local = { ...base, name: 'Our trip', updatedAt: time(2), transactions: [{ ...expense('same'), amount: 2000, shares: { amy: 1000, ben: 1000 } }, expense('ours')] }
    const remote = { ...base, description: 'Their description', updatedAt: time(3), transactions: [{ ...expense('same'), description: 'Latest dinner' }, expense('theirs')] }
    const merged = mergeLatestGroup(base, local, remote)
    expect(merged.name).toBe('Our trip')
    expect(merged.description).toBe('Their description')
    const combined = { ...local.transactions[0], description: 'Latest dinner' }
    expect(merged.transactions.find(t => t.id === 'same')).toEqual(combined)
    expect(merged.transactions.map(t => t.id)).toEqual(['same', 'theirs', 'ours'])
    expect(mergeLatestGroup(base, { ...local, updatedAt: time(4) }, remote).transactions[0]).toEqual(combined)
  })

  it('merges independent expense details while resolving the whole financial change by time, with server ties', () => {
    const entry = expense('same')
    const base = { ...group(), transactions: [entry] }
    const local = { ...base, updatedAt: time(2), transactions: [{ ...entry, amount: 2000, shares: { amy: 2000 }, description: 'Local description' }] }
    const remote = { ...base, updatedAt: time(2), transactions: [{ ...entry, paidBy: 'ben', category: 'other', date: '2026-10-09' }] }
    expect(mergeLatestGroup(base, local, remote).transactions[0]).toEqual({ ...remote.transactions[0], description: 'Local description' })
    expect(mergeLatestGroup(base, { ...local, updatedAt: time(3) }, remote).transactions[0]).toEqual({ ...local.transactions[0], category: 'other', date: '2026-10-09' })
    const conflicting = { ...remote, transactions: [{ ...remote.transactions[0], description: 'Server description' }] }
    expect(mergeLatestGroup(base, local, conflicting).transactions[0]).toEqual(conflicting.transactions[0])
  })

  it('merges payment note/date independently of the amount and both participants', () => {
    const entry = { id: 'payment', type: 'payment' as const, fromId: 'ben', toId: 'amy', amount: 500, note: '', date: '2026-10-08', createdAt: time(1) }
    const base = { ...group(), transactions: [entry] }
    const local = { ...base, updatedAt: time(3), transactions: [{ ...entry, amount: 700, note: 'Bank transfer' }] }
    const remote = { ...base, updatedAt: time(2), transactions: [{ ...entry, fromId: 'amy', toId: 'ben', date: '2026-10-09' }] }
    expect(mergeLatestGroup(base, local, remote).transactions[0]).toEqual({ ...local.transactions[0], date: '2026-10-09' })
    expect(mergeLatestGroup(base, { ...local, updatedAt: time(2) }, remote).transactions[0]).toEqual({ ...remote.transactions[0], note: 'Bank transfer' })
  })

  it('merges deletion and later edits by time without restoring deleted transactions', () => {
    const base = { ...group(), transactions: [expense('dinner')] }
    const deleted = { ...base, updatedAt: time(3), transactions: [] }
    const edited = { ...base, updatedAt: time(2), transactions: [{ ...expense('dinner'), description: 'Edited' }] }
    expect(mergeLatestGroup(base, deleted, edited).transactions).toEqual([])
    expect(mergeLatestGroup(base, { ...deleted, updatedAt: time(1) }, edited).transactions).toEqual(edited.transactions)
  })

  it('keeps members referenced by an independently added transaction', () => {
    const base = group()
    const local = { ...base, members: [base.members[0]], updatedAt: time(3) }
    const remote = { ...base, transactions: [expense('dinner')], updatedAt: time(2) }
    expect(mergeLatestGroup(base, local, remote).members).toContainEqual(base.members[1])
  })

  it('protects pending edits from a cloud refresh and remembers the refreshed revision', () => {
    const queued = queueGroup(cached(), { ...group(), name: 'Offline name', updatedAt: time(2) })
    const refreshed = mergeCloudStore(queued, [{ group: { ...group(), description: 'Online detail', updatedAt: time(3) }, revision: 2 }])
    expect(refreshed.groups[0]).toMatchObject({ name: 'Offline name', description: 'Online detail' })
    expect(refreshed.outbox[0].revision).toBe(2)
    expect(refreshed.outbox[0].base?.description).toBe('Online detail')
  })

  it('does not drop a second edit made during the first upload', () => {
    const queued = queueGroup(cached(), { ...group(), transactions: [expense('first')], updatedAt: time(1) })
    const sent = queued.outbox[0]
    const later = queueGroup(queued, { ...sent.group, transactions: [...sent.group.transactions, expense('second')], updatedAt: time(2) })
    const confirmed = acknowledgeGroup(later, sent, { group: sent.group, revision: 2 })
    expect(confirmed.groups[0].transactions).toHaveLength(2)
    expect(confirmed.outbox[0].revision).toBe(2)
    expect(confirmed.outbox[0].base?.transactions).toHaveLength(1)
    expect(acknowledgeGroup(confirmed, confirmed.outbox[0], { group: confirmed.groups[0], revision: 3 }).outbox).toEqual([])
  })

  it('updates a new group’s server invitation without losing later offline edits', () => {
    const created = queueGroup(emptyStore(), group())
    const later = queueGroup(created, { ...group(), name: 'Renamed', updatedAt: time(2) })
    const ack = acknowledgeGroup(later, created.outbox[0], { group: { ...group(), inviteCode: 'b'.repeat(32) }, revision: 1 })
    expect(ack.groups[0]).toMatchObject({ name: 'Renamed', inviteCode: 'b'.repeat(32) })
    expect(ack.outbox[0].base?.inviteCode).toBe('b'.repeat(32))
  })

  it('uploads pending edits for a removed group without returning it to device lists', () => {
    const queued = queueGroup(cached(), { ...group(), name: 'Changed offline', updatedAt: time(1) })
    const hidden = removeGroupFromDevice(queued, 'trip')
    saveToMemory(hidden)
    expect(loadStore().store.outbox).toEqual(queued.outbox)
    const ack = acknowledgeGroup(hidden, queued.outbox[0], { group: queued.groups[0], revision: 2 })
    expect(ack.groups).toEqual([])
    expect(ack.outbox).toEqual([])
    expect(mergeCloudStore(ack, [{ group: queued.groups[0], revision: 2 }]).groups).toEqual([])
  })

  it('preserves the previous durable queue when the next device write fails', () => {
    const previous = queueGroup(cached(), { ...group(), name: 'Saved', updatedAt: time(1) })
    const original = saveToMemory(previous)
    vi.stubGlobal('localStorage', {
      getItem: () => original,
      setItem: () => {
        throw new Error('Full')
      },
    })
    expect(() => saveStore(queueGroup(previous, { ...group(), name: 'Unsaved', updatedAt: time(2) }))).toThrow(/Could not save/)
    expect(loadStore().store).toEqual(previous)
  })

  it('persists a join request once and rejects malformed queues without rewriting them', () => {
    const queued = queueJoin(emptyStore(), { code: 'c'.repeat(32), name: 'Amy', memberId: 'amy', createdAt: time(0) })
    saveToMemory(queued)
    expect(loadStore().store).toEqual(queued)
    expect(queueJoin(queued, queued.pendingJoins[0]).pendingJoins).toHaveLength(1)
    for (const invalid of [
      { ...queued, pendingJoins: null },
      { ...queued, outbox: [{ group: group(), base: null, revision: 2 }] },
      { ...cached(), cloudRevisions: { trip: 0 } },
    ]) {
      const raw = JSON.stringify(invalid)
      vi.stubGlobal('localStorage', { getItem: () => raw, setItem: vi.fn() })
      expect(loadStore().error).toMatch(/kept in browser storage/)
      expect(localStorage.setItem).not.toHaveBeenCalled()
    }
  })
})

function saveToMemory(store: ReturnType<typeof emptyStore>): string {
  let raw = ''
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === STORE_KEY ? raw : null),
    setItem: (_: string, value: string) => {
      raw = value
    },
  })
  saveStore(store)
  return raw
}
