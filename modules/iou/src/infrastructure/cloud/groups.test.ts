import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Group } from '../../domain/groups/types'

const mock = vi.hoisted(() => {
  const getSession = vi.fn()
  const signInAnonymously = vi.fn()
  const inFilter = vi.fn()
  const order = vi.fn(() => ({ in: inFilter }))
  const select = vi.fn(() => ({ order }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  const client = { auth: { getSession, signInAnonymously }, from, rpc }
  return { getSession, signInAnonymously, inFilter, order, select, from, rpc, client, createClient: vi.fn(() => client) }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }))

const group: Group = {
  id: 'trip-2026',
  name: 'Weekend away',
  description: '',
  currency: 'THB',
  icon: '🌴',
  color: '#b1c69a',
  inviteCode: 'a'.repeat(32),
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  members: [
    { id: 'alex', name: 'Alex' },
    { id: 'sam', name: 'Sam' },
  ],
  transactions: [],
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key')
  mock.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
  mock.signInAnonymously.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
  mock.inFilter.mockResolvedValue({ data: [], error: null })
  mock.rpc.mockImplementation(async (name: string) => (name === 'iou_group_heads' ? { data: { format: 1, heads: [] }, error: null } : { data: { payload: group, version: 1 }, error: null }))
})

describe('shared group access', () => {
  it('reports absent cloud configuration without starting a session', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const cloud = await import('./groups')
    expect(cloud.cloudConfigured).toBe(false)
    await expect(cloud.initializeCloud()).rejects.toThrow('not configured')
    expect(mock.createClient).not.toHaveBeenCalled()
  })

  it('restores the existing identity without creating another anonymous user', async () => {
    const cloud = await import('./groups')
    await Promise.all([cloud.initializeCloud(), cloud.initializeCloud(), cloud.initializeCloud()])
    expect(mock.getSession).toHaveBeenCalledTimes(1)
    expect(mock.signInAnonymously).not.toHaveBeenCalled()
    expect(mock.createClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: { fetch: expect.any(Function) },
        db: { retry: false },
      }),
    )
  })

  it('creates one anonymous identity when there is no stored session', async () => {
    mock.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const cloud = await import('./groups')
    await Promise.all([cloud.initializeCloud(), cloud.initializeCloud()])
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1)
  })

  it('allows initialization to be retried after a connection error', async () => {
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Failed to fetch' } })
    const cloud = await import('./groups')
    await expect(cloud.initializeCloud()).rejects.toThrow('Check your connection')
    await expect(cloud.initializeCloud()).resolves.toBeUndefined()
    expect(mock.getSession).toHaveBeenCalledTimes(2)
  })

  it('detects a lost session after successful initialization and restores anonymous access', async () => {
    const cloud = await import('./groups')
    await cloud.initializeCloud()
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    await cloud.loadCloudVersions()
    expect(mock.getSession).toHaveBeenCalledTimes(2)
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1)
  })

  it('checks restored sessions again without replacing a valid browser identity', async () => {
    const cloud = await import('./groups')
    await cloud.initializeCloud()
    await cloud.loadCloudVersions()
    await cloud.joinCloudGroup(group.inviteCode)
    expect(mock.getSession).toHaveBeenCalledTimes(3)
    expect(mock.signInAnonymously).not.toHaveBeenCalled()
  })

  it('uses the server-generated invite code returned by create', async () => {
    const created = { ...group, inviteCode: 'b'.repeat(32) }
    mock.rpc.mockResolvedValue({ data: { payload: created, version: 1 }, error: null })
    const cloud = await import('./groups')
    const record = await cloud.createCloudGroup(group)
    expect(record.group.inviteCode).toBe(created.inviteCode)
    expect(mock.rpc).toHaveBeenCalledWith('iou_create_group', { p_payload: group })
    expect(record.group).not.toBe(created)
  })

  it('normalizes complete invitation codes before the join RPC', async () => {
    const cloud = await import('./groups')
    await cloud.joinCloudGroup(`  ${'A'.repeat(16)} \n${'A'.repeat(16)}  `)
    expect(mock.rpc).toHaveBeenCalledWith('iou_join_group', { p_invite_code: 'a'.repeat(32) })
  })

  it('rejects malformed invitation codes without contacting the server', async () => {
    const cloud = await import('./groups')
    await expect(cloud.joinCloudGroup('abcd')).rejects.toThrow('32-character')
    expect(mock.getSession).not.toHaveBeenCalled()
    expect(mock.rpc).not.toHaveBeenCalled()
  })

  it('passes the expected revision and reports current application conflicts distinctly', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'IOU_CONFLICT' } })
    const cloud = await import('./groups')
    await expect(cloud.saveCloudGroup(group, 7, group)).rejects.toBeInstanceOf(cloud.CloudConflictError)
    expect(mock.rpc).toHaveBeenCalledWith('iou_save_group_delta', {
      p_group_id: group.id,
      p_expected_version: 7,
      p_delta: { metadata: expect.objectContaining({ id: group.id }), members: { upsert: [], remove: [] }, transactions: { upsert: [], remove: [] } },
    })
  })

  it('uploads one changed transaction and accepts a compact checked receipt without downloading the ledger', async () => {
    const base = {
      ...group,
      transactions: Array.from({ length: 1000 }, (_, index) => ({
        id: `payment-${index}`,
        type: 'payment' as const,
        fromId: 'alex',
        toId: 'sam',
        amount: 100,
        note: '',
        date: '2026-10-07',
        createdAt: group.createdAt,
      })),
    }
    const edited = { ...base, transactions: base.transactions.map((item, index) => (index === 400 ? { ...item, note: 'Corrected note' } : item)) }
    mock.rpc.mockResolvedValue({ data: { format: 1, id: group.id, version: '8' }, error: null })
    const cloud = await import('./groups')
    await expect(cloud.saveCloudGroup(edited, 7, base)).resolves.toEqual({ group: edited, revision: 8 })
    const [name, args] = mock.rpc.mock.calls[0]
    expect(name).toBe('iou_save_group_delta')
    expect(args.p_delta.transactions).toEqual({ upsert: [edited.transactions[400]], remove: [] })
    expect(args.p_delta.members).toEqual({ upsert: [], remove: [] })
    expect(JSON.stringify(args).length).toBeLessThan(JSON.stringify(edited).length / 100)
    expect(mock.from).not.toHaveBeenCalled()
  })

  it.each([null, { format: 1, id: 'other', version: 8 }, { format: 1, id: group.id, version: 9 }, { payload: group, version: 8 }])(
    'refuses malformed or mismatched compact acknowledgements (%j)',
    async data => {
      mock.rpc.mockResolvedValue({ data, error: null })
      const cloud = await import('./groups')
      await expect(cloud.saveCloudGroup(group, 7, group)).rejects.toThrow('receipt')
      expect(mock.rpc).toHaveBeenCalledTimes(1)
    },
  )

  it('reports missing delta setup without sending a legacy whole-ledger fallback', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing function' } })
    const cloud = await import('./groups')
    await expect(cloud.saveCloudGroup(group, 7, group)).rejects.toThrow('database setup')
    expect(mock.rpc).toHaveBeenCalledTimes(1)
    expect(mock.rpc.mock.calls[0][0]).toBe('iou_save_group_delta')
  })

  it('reports database serialization failures without treating them as application conflicts', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'could not serialize transaction' } })
    const cloud = await import('./groups')
    const failure = await cloud.saveCloudGroup(group, 7, group).catch(error => error)
    expect(failure).not.toBeInstanceOf(cloud.CloudConflictError)
    expect(failure.message).toMatch(/Could not save.*serialize transaction/)
  })

  it('rejects unsafe revisions before sending any update', async () => {
    const cloud = await import('./groups')
    await expect(cloud.saveCloudGroup(group, Number.MAX_SAFE_INTEGER + 1, group)).rejects.toThrow('revision is invalid')
    expect(mock.rpc).not.toHaveBeenCalled()
  })

  it('reads only the id and revision of every joined group when checking for changes', async () => {
    mock.rpc.mockResolvedValue({ data: { format: 1, heads: [{ id: group.id, version: '3' }] }, error: null })
    const cloud = await import('./groups')
    await expect(cloud.loadCloudVersions()).resolves.toEqual([{ id: group.id, revision: 3 }])
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('iou_group_heads')
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('gets every revision in one compact request without table pagination or ledger payloads', async () => {
    const heads = Array.from({ length: 1100 }, (_, at) => ({ id: `group-${at}`, version: 7 }))
    mock.rpc.mockResolvedValue({ data: { format: 1, heads }, error: null })
    const cloud = await import('./groups')
    await expect(cloud.loadCloudVersions()).resolves.toEqual(heads.map(({ id, version }) => ({ id, revision: version })))
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('iou_group_heads')
    expect(mock.from).not.toHaveBeenCalled()
  })

  it.each(['PGRST202', '42883'])('reports missing revision setup without a table fallback (%s)', async code => {
    const cloud = await import('./groups')
    mock.rpc.mockResolvedValue({ data: null, error: { code, message: 'missing function' } })
    await expect(cloud.loadCloudVersions()).rejects.toThrow('database setup')
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('iou_group_heads')
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('does not hide permission or malformed heads failures behind a fallback', async () => {
    const cloud = await import('./groups')
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(cloud.loadCloudVersions()).rejects.toThrow('permission denied')
    for (const data of [
      null,
      { format: 2, heads: [] },
      { format: 1, heads: null },
      { format: 1, heads: [{ id: group.id, version: 0 }] },
      {
        format: 1,
        heads: [
          { id: group.id, version: 1 },
          { id: group.id, version: 2 },
        ],
      },
    ]) {
      mock.rpc.mockResolvedValueOnce({ data, error: null })
      await expect(cloud.loadCloudVersions()).rejects.toThrow('invalid group')
    }
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('rejects invalid revision rows instead of accepting a partial list', async () => {
    const cloud = await import('./groups')
    for (const head of [
      { id: group.id, version: 0 },
      { id: group.id, version: 1.5 },
      { id: '__proto__', version: 1 },
    ]) {
      mock.rpc.mockResolvedValueOnce({ data: { format: 1, heads: [head] }, error: null })
      await expect(cloud.loadCloudVersions()).rejects.toThrow('invalid group')
    }
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('reads the named groups through RLS and validates every received ledger', async () => {
    mock.inFilter.mockResolvedValue({ data: [{ id: group.id, payload: group, version: '3' }], error: null })
    const cloud = await import('./groups')
    await expect(cloud.loadCloudGroups([group.id])).resolves.toEqual({ records: [{ group, revision: 3 }], unreadable: [] })
    expect(mock.from).toHaveBeenCalledWith('iou_groups')
    expect(mock.select).toHaveBeenCalledWith('id,payload,version')
    expect(mock.inFilter).toHaveBeenCalledWith('id', [group.id])
  })

  it('reports a group whose data it cannot read instead of failing the whole load', async () => {
    const other = { ...group, id: 'trip-2027' }
    mock.inFilter.mockResolvedValue({
      data: [
        { id: group.id, payload: { ...group, members: [] }, version: 3 },
        { id: other.id, payload: other, version: 2 },
      ],
      error: null,
    })
    const cloud = await import('./groups')
    await expect(cloud.loadCloudGroups([group.id, other.id])).resolves.toEqual({ records: [{ group: other, revision: 2 }], unreadable: [group.id] })
  })

  it('treats a payload that does not match its row, or has a bad revision, as unreadable', async () => {
    mock.inFilter.mockResolvedValue({
      data: [
        { id: group.id, payload: { ...group, id: 'someone-else' }, version: 1 },
        { id: 'trip-2027', payload: { ...group, id: 'trip-2027' }, version: 0 },
      ],
      error: null,
    })
    const cloud = await import('./groups')
    await expect(cloud.loadCloudGroups([group.id, 'trip-2027'])).resolves.toEqual({ records: [], unreadable: [group.id, 'trip-2027'] })
  })

  it('ignores rows it did not ask for and ids that cannot be group ids', async () => {
    mock.inFilter.mockResolvedValue({ data: [{ id: 'unrequested', payload: { ...group, id: 'unrequested' }, version: 1 }], error: null })
    const cloud = await import('./groups')
    await expect(cloud.loadCloudGroups([group.id, '__proto__', 'a,b'])).resolves.toEqual({ records: [], unreadable: [] })
    expect(mock.inFilter).toHaveBeenCalledWith('id', [group.id])
  })

  it('downloads in bounded chunks and reports a failed batch after draining started requests', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => `trip-${index}`)
    const cloud = await import('./groups')
    await cloud.loadCloudGroups(ids)
    expect(mock.inFilter.mock.calls.map(([, chunk]) => chunk.length)).toEqual([10, 10, 5])
    mock.inFilter.mockClear()
    mock.inFilter.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    await expect(cloud.loadCloudGroups(ids)).rejects.toThrow('Check your connection')
    expect(mock.inFilter).toHaveBeenCalledTimes(3)
  })

  it('downloads three chunks concurrently and returns them in input order', async () => {
    const ids = Array.from({ length: 41 }, (_, index) => `trip-${index}`)
    const releases = new Map<string, () => void>()
    mock.inFilter.mockImplementation(
      (_column, chunk: string[]) =>
        new Promise(resolve => {
          releases.set(chunk[0], () => resolve({ data: chunk.map(id => ({ id, payload: { ...group, id }, version: 1 })), error: null }))
        }),
    )
    const cloud = await import('./groups')
    const loading = cloud.loadCloudGroups([...ids, ids[0]])
    await vi.waitFor(() => expect(mock.inFilter).toHaveBeenCalledTimes(3))
    releases.get('trip-20')!()
    await vi.waitFor(() => expect(mock.inFilter).toHaveBeenCalledTimes(4))
    releases.get('trip-30')!()
    await vi.waitFor(() => expect(mock.inFilter).toHaveBeenCalledTimes(5))
    for (const id of ['trip-40', 'trip-10', 'trip-0']) releases.get(id)!()
    expect((await loading).records.map(record => record.group.id)).toEqual(ids)
  })

  it('does not contact the server when no group needs downloading', async () => {
    const cloud = await import('./groups')
    await expect(cloud.loadCloudGroups([])).resolves.toEqual({ records: [], unreadable: [] })
    expect(mock.inFilter).not.toHaveBeenCalled()
  })

  it('reports a request that timed out like any other connection problem', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'TimeoutError: The request timed out.' } })
    const cloud = await import('./groups')
    await expect(cloud.loadCloudVersions()).rejects.toThrow('Check your connection')
  })

  it('explains missing database setup without a false success', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing function' } })
    const cloud = await import('./groups')
    await expect(cloud.createCloudGroup(group)).rejects.toThrow('schema.sql')
  })

  it('reports a lost create response without automatically creating another group', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    const cloud = await import('./groups')
    await expect(cloud.createCloudGroup(group)).rejects.toThrow('Check your connection')
    expect(mock.rpc).toHaveBeenCalledTimes(1)
    await expect(cloud.createCloudGroup(group)).resolves.toEqual({ group, revision: 1 })
    expect(mock.rpc).toHaveBeenLastCalledWith('iou_create_group', { p_payload: group })
  })
})
