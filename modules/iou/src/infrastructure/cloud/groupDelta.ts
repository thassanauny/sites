import type { Group } from '../../domain/groups/types'

/** JSON object property order is not an edit; array order still is. */
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]))
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]))
}

/** Existing positions survive ordinary edits/deletions; only actual reordering needs an order list. */
function changes<T extends { id: string }>(before: readonly T[], after: readonly T[]) {
  const original = new Map(before.map(item => [item.id, item]))
  const retained = new Set(after.map(item => item.id))
  const upsert = after.filter(item => !same(original.get(item.id), item))
  const remove = before.filter(item => !retained.has(item.id)).map(item => item.id)
  const order = after.map(item => item.id)
  const natural = [...before.filter(item => retained.has(item.id)), ...after.filter(item => !original.has(item.id))].map(item => item.id)
  return { upsert, remove, ...(!same(order, natural) ? { order } : {}) }
}

export function groupDelta(before: Group, after: Group) {
  const { members, transactions, ...metadata } = after
  return { metadata, members: changes(before.members, members), transactions: changes(before.transactions, transactions) }
}
