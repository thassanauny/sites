import type { Group } from '../domain/groups/types'
import { emptyTravelMode, normalizeTravelMode, type TravelModeSettings } from '../domain/travel/preferences'
import { rebasePending, type PendingGroup } from './sync/merge'

export interface PendingJoin {
  code: string
  name: string
  memberId: string
  createdAt: string
}

/** Everything this device keeps: cached groups, personal preferences and the queue of unsynced work. */
export interface AppStore {
  version: 2
  groups: Group[]
  pinnedIds: string[]
  memberByGroup: Record<string, string>
  cloudRevisions: Record<string, number>
  removedGroupIds: string[]
  removalEpochs?: Record<string, string>
  travelMode: TravelModeSettings
  outbox: PendingGroup[]
  pendingJoins: PendingJoin[]
}

export const emptyStore = (): AppStore => ({
  version: 2,
  groups: [],
  pinnedIds: [],
  memberByGroup: {},
  cloudRevisions: {},
  removedGroupIds: [],
  removalEpochs: {},
  travelMode: emptyTravelMode(),
  outbox: [],
  pendingJoins: [],
})

/** Drop everything the device keeps for removed groups, and a Travel mode default that no longer exists. */
export function withoutRemovedGroups(store: AppStore): AppStore {
  const removed = new Set(store.removedGroupIds)
  const groups = store.groups.filter(group => !removed.has(group.id))
  return {
    ...store,
    groups,
    pinnedIds: store.pinnedIds.filter(id => !removed.has(id)),
    memberByGroup: Object.fromEntries(Object.entries(store.memberByGroup).filter(([id]) => !removed.has(id))),
    cloudRevisions: Object.fromEntries(Object.entries(store.cloudRevisions).filter(([id]) => !removed.has(id))),
    travelMode: normalizeTravelMode(store.travelMode, groups),
  }
}

export function updateTravelMode(store: AppStore, settings: TravelModeSettings): AppStore {
  if (settings.enabled && !settings.defaultGroupId) throw new Error('Choose a default group to turn on Travel mode.')
  if (settings.defaultGroupId && !store.groups.some(group => group.id === settings.defaultGroupId)) throw new Error('That group is no longer on this device. Choose another group.')
  return { ...store, travelMode: { ...settings } }
}

/** Forget a shared group's cache and personal settings without changing shared data. */
export function removeGroupFromDevice(store: AppStore, groupId: string): AppStore {
  const group = store.groups.find(group => group.id === groupId)
  if (!group) throw new Error('This group could not be found.')
  return withoutRemovedGroups({
    ...store,
    removedGroupIds: [...new Set([...store.removedGroupIds, groupId])],
    removalEpochs: { ...store.removalEpochs, [groupId]: crypto.randomUUID() },
    pendingJoins: store.pendingJoins.filter(request => request.code !== group.inviteCode),
  })
}

/** Only an invitation begun after the latest removal may restore a group. */
export function restoreInvitation(store: AppStore, record: { group: Group; revision: number }, started: AppStore): AppStore {
  const id = record.group.id
  if (store.removalEpochs?.[id] !== started.removalEpochs?.[id]) {
    throw new Error('This group was removed while opening the invitation. Open its invitation again to rejoin.')
  }
  return mergeCloudStore(store, [record], id)
}

/**
 * Automatic refresh respects device removals; an explicit invitation lookup can restore one group.
 * A refresh that brings nothing new returns the very same store, so callers can skip saving and rendering.
 */
export function mergeCloudStore(store: AppStore, records: readonly { group: Group; revision: number }[], restoreGroupId?: string): AppStore {
  const removedGroupIds = store.removedGroupIds.filter(id => id !== restoreGroupId || !records.some(record => record.group.id === id))
  const removed = new Set(removedGroupIds)
  const groups = [...store.groups]
  const cloudRevisions = { ...store.cloudRevisions }
  const memberByGroup = { ...store.memberByGroup }
  let outbox = [...store.outbox]
  let changed = removedGroupIds.length !== store.removedGroupIds.length
  for (const record of records) {
    const pending = outbox.find(item => item.group.id === record.group.id)
    const known = cloudRevisions[record.group.id] || 0
    if (Math.max(known, pending?.revision || 0) > record.revision) continue
    // The same revision is the same content, so there is nothing to replace.
    if (!pending && known === record.revision && groups.some(group => group.id === record.group.id)) continue
    const rebased = pending ? rebasePending(pending, record.group, record.revision) : null
    if (pending) {
      outbox = [...outbox.filter(item => item.group.id !== record.group.id), ...(rebased ? [rebased] : [])]
      changed = true
    }
    if (removed.has(record.group.id)) continue
    const group = rebased?.group ?? record.group
    const index = groups.findIndex(group => group.id === record.group.id)
    if (index < 0) groups.push(group)
    else groups[index] = group
    cloudRevisions[record.group.id] = record.revision
    if (!group.members.some(member => member.id === memberByGroup[record.group.id])) delete memberByGroup[record.group.id]
    changed = true
  }
  return changed ? withoutRemovedGroups({ ...store, groups, cloudRevisions, memberByGroup, removedGroupIds, outbox }) : store
}
