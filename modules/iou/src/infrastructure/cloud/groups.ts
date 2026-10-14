import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CloudConflictError, type CloudLoad, type CloudRecord, type CloudVersion } from '../../application/sync/synchronize'
import { isId, isInviteCode, normalizeInviteCode } from '../../domain/groups/identifiers'
import type { Group } from '../../domain/groups/types'
import { validateGroup } from '../../domain/ledger/calculations'
import { fetchWithTimeout } from './network'

export { CloudConflictError, type CloudLoad, type CloudRecord, type CloudVersion }

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

export const cloudConfigured = Boolean(supabaseUrl && supabaseKey)

let client: SupabaseClient | undefined
let authentication: Promise<void> | undefined

function getClient(): SupabaseClient {
  if (!cloudConfigured) {
    throw new Error('Live sharing is not configured. Add the Supabase settings and rebuild the app.')
  }
  if (!client) {
    try {
      client = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: { fetch: fetchWithTimeout() },
        // The sync loop already retries, with a pause that grows after failures. The library's own retries would
        // stack up to four timeouts on a dead connection before any error reached the screen.
        db: { retry: false },
      })
    } catch {
      throw new Error('The Supabase settings are invalid. Check the project URL and public API key.')
    }
  }
  return client
}

interface ServiceError {
  message?: string
  code?: string
}

function serviceError(error: ServiceError, action: string): Error {
  if (error.code === 'PT409' && error.message === 'IOU_CONFLICT') return new CloudConflictError()
  if (error.message === 'IOU_INVALID_INVITE') return new Error('That invite code was not found. Check the code and try again.')
  if (error.message === 'IOU_ACCESS_DENIED') return new Error('You no longer have access to this group. Join again using its invite code.')
  if (error.message === 'IOU_IMMUTABLE_SETTINGS') return new Error('A shared group’s currency, invite code, ID, and creation time cannot change.')
  if (error.message === 'IOU_GROUP_LIMIT') return new Error('This session has reached the supported number of shared groups.')
  if (error.message === 'IOU_INVALID_GROUP') return new Error('The group contains invalid data or is too large to share. Review its members and transactions, or delete some older transactions.')
  if (error.code === 'PGRST202' || error.code === '42P01' || error.code === '42883') {
    return new Error('Live sharing needs database setup. Run supabase/schema.sql in your Supabase project.')
  }
  if (/anonymous.*(?:disabled|not allowed)|anonymous_provider_disabled/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
    return new Error('Enable anonymous sign-ins in Supabase Authentication to use shared groups.')
  }
  if (error.message === 'IOU_AUTH_REQUIRED' || error.code === 'PGRST301' || error.code === 'PGRST303') {
    return new Error('The shared-group session could not be verified. Reload the app and try again.')
  }
  if (/fetch|network|connection|failed to send|load failed|timed out|timeout|abort/i.test(error.message ?? '')) {
    return new Error('Could not connect to shared groups. Check your connection and try again.')
  }
  return new Error(`Could not ${action}. ${error.message || 'Please try again.'}`)
}

async function authenticate(): Promise<void> {
  const supabase = getClient()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw serviceError(error, 'restore your shared-group session')
  if (data.session) return
  const result = await supabase.auth.signInAnonymously()
  if (result.error) throw serviceError(result.error, 'start your shared-group session')
  if (!result.data.session) throw new Error('Supabase did not create a shared-group session. Please try again.')
}

const AUTH_LOCK = 'iou:auth'
const AUTH_LOCK_WAIT_MS = 30_000

/**
 * Looking for a session and then signing in must not interleave across the tabs of one browser: tabs that
 * both find no session would each create an anonymous identity, and the one whose session is overwritten
 * loses access to the groups it created. A Web Lock makes the second tab wait and find the first tab's session.
 */
async function authenticateOnce(): Promise<void> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return authenticate()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AUTH_LOCK_WAIT_MS)
  try {
    await locks.request(AUTH_LOCK, { signal: controller.signal }, authenticate)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Could not connect to shared groups. Check your connection and try again.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Rechecks the current browser identity; concurrent checks share one attempt. */
export async function initializeCloud(): Promise<void> {
  if (!authentication) {
    authentication = authenticateOnce().finally(() => {
      authentication = undefined
    })
  }
  await authentication
}

function readRevision(value: unknown): number {
  const revision = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('The server returned an invalid group revision.')
  }
  return revision
}

function readRecord(input: unknown): CloudRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('The server returned an invalid group record.')
  }
  const row = input as Record<string, unknown>
  const revision = readRevision(row.version)
  try {
    return { group: validateGroup(row.payload), revision }
  } catch {
    throw new Error('The server returned invalid group data. Refresh the app or check the database setup.')
  }
}

function readVersion(input: unknown): CloudVersion {
  const row = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  if (!isId(row.id)) throw new Error('The server returned an invalid group list.')
  return { id: row.id, revision: readRevision(row.version) }
}

const VERSION_PAGE_SIZE = 500
// Large ledgers make large rows, so groups are downloaded a few at a time.
const LOAD_CHUNK_SIZE = 10

/** The revision of every joined group, without the ledgers: small enough to ask every few seconds. */
export async function loadCloudVersions(): Promise<CloudVersion[]> {
  await initializeCloud()
  // RLS filters these rows by auth.uid(); no global group list is readable.
  const versions: CloudVersion[] = []
  let offset = 0
  for (;;) {
    // ID order remains stable as other members edit groups during pagination.
    const { data, error, count } = await getClient()
      .from('iou_groups')
      .select('id,version', { count: 'exact' })
      .order('id', { ascending: true })
      .range(offset, offset + VERSION_PAGE_SIZE - 1)
    if (error) throw serviceError(error, 'load your shared groups')
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count === null || count < 0 || offset + data.length > count || (data.length === 0 && offset < count)) {
      throw new Error('The server returned an invalid group list.')
    }
    versions.push(...data.map(readVersion))
    offset += data.length
    if (offset >= count) return versions
  }
}

/** The named groups. One whose data cannot be read is reported, not thrown, so it cannot block the others. */
export async function loadCloudGroups(ids: readonly string[]): Promise<CloudLoad> {
  await initializeCloud()
  const wanted = ids.filter(isId)
  const loaded: CloudLoad = { records: [], unreadable: [] }
  for (let start = 0; start < wanted.length; start += LOAD_CHUNK_SIZE) {
    const chunk = wanted.slice(start, start + LOAD_CHUNK_SIZE)
    const { data, error } = await getClient().from('iou_groups').select('id,payload,version').order('id', { ascending: true }).in('id', chunk)
    if (error) throw serviceError(error, 'load your shared groups')
    if (!Array.isArray(data)) throw new Error('The server returned an invalid group list.')
    for (const row of data) {
      if (!isId(row?.id) || !chunk.includes(row.id)) continue
      try {
        const record = readRecord(row)
        if (record.group.id !== row.id) throw new Error('The group does not match its row.')
        loaded.records.push(record)
      } catch {
        loaded.unreadable.push(row.id)
      }
    }
  }
  return loaded
}

export async function createCloudGroup(group: Group): Promise<CloudRecord> {
  const payload = validateGroup(group)
  await initializeCloud()
  const { data, error } = await getClient().rpc('iou_create_group', { p_payload: payload })
  if (error) throw serviceError(error, 'create the shared group')
  // The database generates the invitation code. Use this returned group.
  return readRecord(data)
}

export async function joinCloudGroup(inviteCode: string): Promise<CloudRecord> {
  const normalized = normalizeInviteCode(inviteCode)
  if (!isInviteCode(normalized)) throw new Error('Enter the complete 32-character invite code.')
  await initializeCloud()
  const { data, error } = await getClient().rpc('iou_join_group', { p_invite_code: normalized })
  if (error) throw serviceError(error, 'join the shared group')
  return readRecord(data)
}

export async function saveCloudGroup(group: Group, expectedRevision: number): Promise<CloudRecord> {
  const payload = validateGroup(group)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('The group revision is invalid. Reload the group before editing it.')
  await initializeCloud()
  const { data, error } = await getClient().rpc('iou_save_group', { p_payload: payload, p_expected_version: expectedRevision })
  if (error) throw serviceError(error, 'save the shared group')
  return readRecord(data)
}
