import { mergeCloudStore, restoreInvitation, type AppStore } from '../deviceStore'
import { acknowledgeGroup, queueGroup } from './queue'
import type { Group } from '../../domain/groups/types'
import { mapConcurrent } from './concurrency'

/** A shared group as the server holds it. */
export interface CloudRecord {
  group: Group
  revision: number
}

/** The server refused a save because the group changed after the revision this device sent. */
export class CloudConflictError extends Error {
  readonly code = 'CLOUD_CONFLICT'

  constructor() {
    super('This group is being updated. Your saved changes will retry automatically.')
    this.name = 'CloudConflictError'
  }
}

/** The latest revision of one shared group, without its contents. */
export interface CloudVersion {
  id: string
  revision: number
}

export interface CloudLoad {
  records: CloudRecord[]
  /** Groups whose data this version of iou cannot read. Reporting them keeps one bad group from blocking the others. */
  unreadable: string[]
}

export interface SyncTransport {
  /** Which shared groups this device can reach and how recent they are; small, so it is cheap to ask often. */
  versions: () => Promise<CloudVersion[]>
  load: (ids: readonly string[]) => Promise<CloudLoad>
  create: (group: Group) => Promise<CloudRecord>
  save: (group: Group, revision: number, base: Group) => Promise<CloudRecord>
  join: (code: string) => Promise<CloudRecord>
}

export interface SyncDevice {
  read: () => AppStore
  update: (change: (latest: AppStore) => AppStore) => void
  online: () => boolean
}

export interface SyncResult {
  /** Shared groups this device can reach, whether or not they needed downloading. */
  accessible: string[]
  /** Shared groups this version of iou could not read. */
  unreadable: string[]
}

/** Groups whose shared copy is newer than this device's, or that this device does not hold yet, except a revision already found unreadable. */
function outdatedIds(store: AppStore, versions: readonly CloudVersion[], unreadableAt: ReadonlyMap<string, number>): string[] {
  const removed = new Set(store.removedGroupIds)
  return versions
    .filter(({ id, revision }) => revision > (store.cloudRevisions[id] ?? -1) && unreadableAt.get(id) !== revision && (!removed.has(id) || store.outbox.some(item => item.group.id === id)))
    .map(version => version.id)
}

/**
 * All network results are applied to the latest durable store, never a stale snapshot.
 * `unreadableAt` is the revision of each group this version of iou could not read. The caller keeps it between syncs, so polling does not download an unreadable group again until it changes.
 */
export async function syncOffline(device: SyncDevice, cloud: SyncTransport, unreadableAt: Map<string, number> = new Map()): Promise<SyncResult> {
  const accessible = new Set<string>()
  const revisions = new Map<string, number>()
  const outcome = (): SyncResult => ({ accessible: [...accessible], unreadable: [...unreadableAt.keys()].filter(id => !device.read().removedGroupIds.includes(id)) })
  if (!device.online()) return outcome()
  const unreadableNow = (id: string) => unreadableAt.get(id) === revisions.get(id)
  const refresh = async (ids: readonly string[]) => {
    const loaded = await cloud.load(ids)
    for (const id of loaded.unreadable) {
      const revision = revisions.get(id)
      if (revision !== undefined) unreadableAt.set(id, revision)
    }
    for (const { group } of loaded.records) unreadableAt.delete(group.id)
    if (loaded.records.length) device.update(store => mergeCloudStore(store, loaded.records))
  }
  const versions = await cloud.versions()
  for (const { id, revision } of versions) {
    accessible.add(id)
    revisions.set(id, revision)
  }
  for (const id of [...unreadableAt.keys()]) if (!revisions.has(id)) unreadableAt.delete(id)
  // Download only what changed: a poll that finds nothing new costs one small request and no storage write.
  const outdated = outdatedIds(device.read(), versions, unreadableAt)
  if (outdated.length) await refresh(outdated)
  let failure: unknown
  for (const request of device.read().pendingJoins) {
    if (!device.online()) break
    try {
      const started = device.read()
      const record = await cloud.join(request.code)
      accessible.add(record.group.id)
      device.update(store => {
        // The user may have cancelled or replaced this request in another tab.
        if (!store.pendingJoins.some(item => item.code === request.code && item.memberId === request.memberId && item.name === request.name && item.createdAt === request.createdAt)) return store
        let next = restoreInvitation(store, record, started)
        const group = next.groups.find(group => group.id === record.group.id)!
        const existing = group.members.find(member => member.id === request.memberId || member.name.toLowerCase() === request.name.toLowerCase())
        const id = existing?.id ?? request.memberId
        if (!existing)
          next = queueGroup(
            next,
            { ...group, members: [...group.members, { id, name: request.name }], updatedAt: new Date(Math.max(Date.parse(group.updatedAt), Date.parse(request.createdAt))).toISOString() },
            id,
          )
        return {
          ...next,
          memberByGroup: { ...next.memberByGroup, [group.id]: id },
          // Cached joins already selected a member and pinned locally; keep any later unpin.
          pinnedIds: store.memberByGroup[group.id] || next.pinnedIds.includes(group.id) ? next.pinnedIds : [...next.pinnedIds, group.id],
          pendingJoins: next.pendingJoins.filter(item => item.code !== request.code),
        }
      })
    } catch (error) {
      failure ??= error
    }
  }
  await mapConcurrent([...new Set(device.read().outbox.map(item => item.group.id))], async id => {
    // Bound retries if another device is continuously writing. The queue survives.
    for (let attempt = 0; attempt < 3 && device.online(); attempt++) {
      const sent = device.read().outbox.find(item => item.group.id === id)
      if (!sent) break
      try {
        const record = sent.base === null ? await cloud.create(sent.group) : await cloud.save(sent.group, sent.revision, sent.base)
        accessible.add(id)
        device.update(store => acknowledgeGroup(store, sent, record))
      } catch (error) {
        if (error instanceof CloudConflictError && attempt < 2 && device.online() && !unreadableNow(id)) {
          try {
            // Only the group that conflicted needs its newer copy.
            await refresh([id])
            continue
          } catch (refreshError) {
            failure ??= refreshError
            break
          }
        }
        failure ??= error
        break
      }
    }
  })
  if (failure) throw failure
  return outcome()
}
