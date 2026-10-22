import { emptyStore, withoutRemovedGroups, type AppStore } from '../../application/deviceStore'
import { isId, isInviteCode } from '../../domain/groups/identifiers'
import { validateGroup } from '../../domain/ledger/calculations'

export const STORE_KEY = 'iou:store:v2'

const REQUIRED_FIELDS = ['version', 'groups', 'pinnedIds', 'memberByGroup', 'cloudRevisions', 'removedGroupIds', 'travelMode', 'outbox', 'pendingJoins', 'removalEpochs']
const EPOCH_PATTERN = /^[a-f0-9-]{36}$/
const UNREADABLE = 'Your saved data could not be opened. It has been kept in browser storage. Export or recover it before saving new data.'
const UNKNOWN_FORMAT =
  'Your saved data uses a format this version of iou cannot read, possibly because a newer version saved it. It has been kept in browser storage. Update iou, or recover the data before saving new data.'

/** Saved data with a version or field this build does not know, as a newer build may write. */
class UnknownFormat extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const hasUnknownField = (value: object): boolean => Object.keys(value).some(field => !REQUIRED_FIELDS.includes(field))
const isPendingJoin = (value: unknown): boolean => {
  const item = value as Record<string, unknown> | null
  return (
    !!item &&
    Object.keys(item).length === 4 &&
    isInviteCode(item.code) &&
    typeof item.name === 'string' &&
    !!item.name.trim() &&
    item.name.length <= 80 &&
    isId(item.memberId) &&
    typeof item.createdAt === 'string' &&
    Number.isFinite(Date.parse(item.createdAt))
  )
}

function parseStore(raw: string): AppStore {
  const parsed: unknown = JSON.parse(raw)
  if (isObject(parsed) && ((typeof parsed.version === 'number' && parsed.version > 2) || (parsed.version === 2 && hasUnknownField(parsed)))) throw new UnknownFormat()
  const value = parsed as AppStore
  if (
    value?.version !== 2 ||
    hasUnknownField(value) ||
    REQUIRED_FIELDS.some(field => !Object.hasOwn(value, field)) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.pinnedIds) ||
    !isObject(value.memberByGroup) ||
    !isObject(value.cloudRevisions)
  )
    throw new Error('Invalid saved data')
  const travelMode = value.travelMode
  if (
    !travelMode ||
    typeof travelMode !== 'object' ||
    Object.keys(travelMode).length !== 2 ||
    typeof travelMode.enabled !== 'boolean' ||
    (travelMode.defaultGroupId !== null && typeof travelMode.defaultGroupId !== 'string')
  )
    throw new Error('Invalid Travel mode settings')
  if (!Array.isArray(value.removedGroupIds) || value.removedGroupIds.some(id => !isId(id))) throw new Error('Invalid device removals')
  const removedGroupIds = [...new Set(value.removedGroupIds)]
  const removalEpochs = value.removalEpochs
  if (!isObject(removalEpochs) || Object.entries(removalEpochs).some(([id, epoch]) => !isId(id) || typeof epoch !== 'string' || !EPOCH_PATTERN.test(epoch)))
    throw new Error('Invalid device removal history')
  const pending = value.outbox
  if (!Array.isArray(pending)) throw new Error('Invalid pending changes')
  const outbox = pending.map(item => {
    if (!item || Object.keys(item).length !== 3 || !Number.isSafeInteger(item.revision) || item.revision < 0) throw new Error('Invalid pending change')
    const group = validateGroup(item.group)
    const base = item.base === null ? null : validateGroup(item.base)
    if ((base === null) !== (item.revision === 0) || (base && (base.id !== group.id || base.currency !== group.currency || base.inviteCode !== group.inviteCode || base.createdAt !== group.createdAt)))
      throw new Error('Invalid pending base')
    return { group, base, revision: item.revision }
  })
  if (new Set(outbox.map(item => item.group.id)).size !== outbox.length) throw new Error('Duplicate pending changes')
  const pendingJoins = value.pendingJoins
  if (!Array.isArray(pendingJoins) || !pendingJoins.every(isPendingJoin) || new Set(pendingJoins.map(item => item.code)).size !== pendingJoins.length) throw new Error('Invalid pending invitations')
  const groups = value.groups.map(validateGroup)
  if (new Set(groups.map(g => g.id)).size !== groups.length) throw new Error('Duplicate saved groups')
  const ids = new Set(groups.map(g => g.id))
  const memberByGroup: Record<string, string> = {}
  const cloudRevisions: Record<string, number> = {}
  for (const group of groups) {
    const memberId = value.memberByGroup[group.id]
    if (group.members.some(m => m.id === memberId)) memberByGroup[group.id] = memberId
    const revision = value.cloudRevisions[group.id]
    const queued = outbox.find(item => item.group.id === group.id)
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      (revision === 0 && queued?.base !== null) ||
      (queued && (queued.revision !== revision || JSON.stringify(queued.group) !== JSON.stringify(group)))
    )
      throw new Error('Invalid shared group revision')
    cloudRevisions[group.id] = revision
  }
  if (outbox.some(item => !ids.has(item.group.id) && !removedGroupIds.includes(item.group.id))) throw new Error('Missing pending group')
  return withoutRemovedGroups({
    version: 2,
    groups,
    pinnedIds: value.pinnedIds.filter(id => typeof id === 'string' && ids.has(id)),
    memberByGroup,
    cloudRevisions,
    removedGroupIds,
    removalEpochs,
    travelMode,
    outbox,
    pendingJoins,
  })
}

export function readSavedRaw(): string | null {
  try {
    return localStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
}

export interface StoreRead {
  store: AppStore
  /** The exact saved text the store was parsed from; the fingerprint for later saves. */
  raw: string | null
  error?: string
  unavailable?: boolean
}

/** Read and validate the saved store once, so the state and its fingerprint always come from the same text. */
export function readSavedStore(): StoreRead {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORE_KEY)
  } catch {
    return { store: emptyStore(), raw: null, error: 'Browser storage is unavailable. Allow browser storage to save changes on this device.', unavailable: true }
  }
  try {
    return { store: raw ? parseStore(raw) : emptyStore(), raw }
  } catch (error) {
    return { store: emptyStore(), raw, error: error instanceof UnknownFormat ? UNKNOWN_FORMAT : UNREADABLE }
  }
}

export function saveStore(store: AppStore): string {
  try {
    const serialized = JSON.stringify(store)
    localStorage.setItem(STORE_KEY, serialized)
    return serialized
  } catch {
    throw new Error('Could not save on this device. Browser storage may be full or unavailable. Free some space and try again.')
  }
}
