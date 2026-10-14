import { isInviteCode, isSafeText } from '../../domain/groups/identifiers'
import { groupBytes, MAX_GROUP_BYTES } from '../../domain/groups/size'
import type { Group, Member } from '../../domain/groups/types'
import type { AppStore, PendingJoin } from '../deviceStore'
import { mergeLatestGroup, same, type PendingGroup } from './merge'
import { validateGroup } from '../../domain/ledger/calculations'

/** How many members have each name, ignoring case and surrounding spaces. */
function nameCounts(members: readonly Member[] = []): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { name } of members) {
    const key = name.trim().toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function queueGroup(store: AppStore, input: Group, identity?: string): AppStore {
  const group = validateGroup(input)
  const previous = store.groups.find(g => g.id === group.id)
  if (previous && (group.currency !== previous.currency || group.inviteCode !== previous.inviteCode || group.createdAt !== previous.createdAt))
    throw new Error('The group’s currency and invitation are fixed.')
  // The forms already ask for different names. Refuse any change that makes a name more common than it was, but
  // let one that only carries an existing repeat along through: two devices can still add the same name at once.
  const before = nameCounts(previous?.members)
  for (const [name, count] of nameCounts(group.members)) {
    if (count > Math.max(1, before.get(name) ?? 0)) throw new Error('Use a different name for each member.')
  }
  // The shared database refuses a bigger group. Stop growth at its limit so a group never reaches a state that
  // cannot sync, but let one that is already too big shrink.
  const size = groupBytes(group)
  if (size > MAX_GROUP_BYTES && size > (previous ? groupBytes(previous) : 0)) throw new Error('This group has reached the size limit for sharing. Delete some older transactions before adding more.')
  const pending = store.outbox.find(item => item.group.id === group.id)
  const entry: PendingGroup = { base: pending ? pending.base : (previous ?? null), revision: pending?.revision ?? store.cloudRevisions[group.id] ?? 0, group }
  return {
    ...store,
    groups: previous ? store.groups.map(g => (g.id === group.id ? group : g)) : [...store.groups, group],
    cloudRevisions: { ...store.cloudRevisions, [group.id]: entry.revision },
    outbox: [...store.outbox.filter(item => item.group.id !== group.id), entry],
    memberByGroup: identity ? { ...store.memberByGroup, [group.id]: identity } : store.memberByGroup,
  }
}

/** Acknowledging one upload must preserve edits made while it was in flight. */
export function acknowledgeGroup(store: AppStore, sent: PendingGroup, record: { group: Group; revision: number }): AppStore {
  const pending = store.outbox.find(item => item.group.id === sent.group.id)
  if (!pending || pending.revision > record.revision) return store
  const group = mergeLatestGroup(sent.group, pending.group, record.group)
  const remaining = same(group, record.group) ? null : { base: record.group, group, revision: record.revision }
  const hidden = store.removedGroupIds.includes(group.id)
  return {
    ...store,
    groups: hidden ? store.groups : store.groups.map(g => (g.id === group.id ? group : g)),
    cloudRevisions: hidden ? store.cloudRevisions : { ...store.cloudRevisions, [group.id]: record.revision },
    outbox: [...store.outbox.filter(item => item.group.id !== group.id), ...(remaining ? [remaining] : [])],
  }
}

export function queueJoin(store: AppStore, join: PendingJoin): AppStore {
  if (!isInviteCode(join.code)) throw new Error('Enter the complete 32-character invite code.')
  const name = join.name.trim()
  if (!name || name.length > 80 || !isSafeText(join.name)) throw new Error('Enter your name (up to 80 characters).')
  return { ...store, pendingJoins: [...store.pendingJoins.filter(item => item.code !== join.code), { ...join, name }] }
}
