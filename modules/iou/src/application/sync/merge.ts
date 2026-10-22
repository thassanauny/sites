import type { Group, Member, Transaction } from '../../domain/groups/types'
import { validateGroup } from '../../domain/ledger/calculations'

export interface PendingGroup {
  base: Group | null
  group: Group
  revision: number
}

/** Structural equality for plain JSON data. */
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Keep independent edits. When the same value changes, the latest edit wins. */
export function mergeLatestGroup(base: Group, local: Group, remote: Group): Group {
  const localWins = Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)
  function choose<T>(original: T, ours: T, theirs: T): T {
    if (same(ours, original)) return theirs
    if (same(theirs, original) || same(ours, theirs)) return ours
    return localWins ? ours : theirs
  }
  function mergeTransaction(original: Transaction, ours: Transaction, theirs: Transaction): Transaction {
    if (original.type === 'expense' && ours.type === 'expense' && theirs.type === 'expense') {
      // Money, payer and shares form one balanced financial change. Text/date edits
      // can merge independently without combining incompatible amounts and splits.
      const financial = (item: typeof ours) => ({ amount: item.amount, paidBy: item.paidBy, shares: item.shares })
      return {
        ...theirs,
        ...choose(financial(original), financial(ours), financial(theirs)),
        description: choose(original.description, ours.description, theirs.description),
        category: choose(original.category, ours.category, theirs.category),
        date: choose(original.date, ours.date, theirs.date),
      }
    }
    if (original.type === 'payment' && ours.type === 'payment' && theirs.type === 'payment') {
      const financial = (item: typeof ours) => ({ amount: item.amount, fromId: item.fromId, toId: item.toId })
      return {
        ...theirs,
        ...choose(financial(original), financial(ours), financial(theirs)),
        note: choose(original.note, ours.note, theirs.note),
        date: choose(original.date, ours.date, theirs.date),
      }
    }
    return choose(original, ours, theirs)
  }
  function entries<T extends { id: string }>(original: T[], ours: T[], theirs: T[], merge?: (original: T, ours: T, theirs: T) => T): T[] {
    const before = new Map(original.map(item => [item.id, item]))
    const left = new Map(ours.map(item => [item.id, item]))
    const right = new Map(theirs.map(item => [item.id, item]))
    return [...new Set([...right.keys(), ...left.keys()])].flatMap(id => {
      const baseItem = before.get(id)
      const localItem = left.get(id)
      const remoteItem = right.get(id)
      // Additions and delete/edit conflicts retain the existing timestamp policy.
      const item = merge && baseItem && localItem && remoteItem ? merge(baseItem, localItem, remoteItem) : choose(baseItem, localItem, remoteItem)
      return item ? [item] : []
    })
  }
  const members = entries<Member>(base.members, local.members, remote.members)
  const transactions = entries<Transaction>(base.transactions, local.transactions, remote.transactions, mergeTransaction)
  // A simultaneous member removal must not orphan another person's new transaction.
  const referenced = new Set(transactions.flatMap(t => (t.type === 'expense' ? [t.paidBy, ...Object.keys(t.shares)] : [t.fromId, t.toId])))
  for (const id of referenced) {
    if (!members.some(member => member.id === id)) {
      const member = (localWins ? [...local.members, ...remote.members] : [...remote.members, ...local.members]).find(member => member.id === id)
      if (member) members.push(member)
    }
  }
  return validateGroup({
    ...remote,
    name: choose(base.name, local.name, remote.name),
    description: choose(base.description, local.description, remote.description),
    icon: choose(base.icon, local.icon, remote.icon),
    color: choose(base.color, local.color, remote.color),
    members,
    transactions,
    updatedAt: localWins ? local.updatedAt : remote.updatedAt,
  })
}

export function rebasePending(pending: PendingGroup, remote: Group, revision: number): PendingGroup | null {
  // A retried creation can return a group already published by this device.
  const base = pending.base ?? { ...pending.group, name: '', description: '', icon: '', color: '', members: [], transactions: [] }
  const group = mergeLatestGroup(base, pending.group, remote)
  return same(group, remote) ? null : { base: remote, group, revision }
}
