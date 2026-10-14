import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Group } from '../../domain/groups/types'

type Record = { payload: Group; version: number }
const creator = randomUUID()
const collaborator = randomUUID()
const stranger = randomUUID()
let database: PGlite

function group(): Group {
  return {
    id: `group-${randomUUID()}`,
    name: 'Shared trip',
    description: '',
    currency: 'THB',
    icon: 'plane',
    color: '#123456',
    inviteCode: '0'.repeat(32),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    members: [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
    ],
    transactions: [],
  }
}

async function identity(user: string | null, role = 'authenticated') {
  await database.exec('reset role')
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await database.exec(`set role ${role}`)
}

async function create(payload = group()): Promise<Record> {
  const result = await database.query<{ record: Record }>('select public.iou_create_group($1::jsonb) as record', [JSON.stringify(payload)])
  return result.rows[0]!.record
}

async function save(record: Record, patch: Partial<Group>, version = record.version): Promise<Record> {
  const result = await database.query<{ record: Record }>('select public.iou_save_group($1::jsonb, $2::bigint) as record', [JSON.stringify({ ...record.payload, ...patch }), version])
  return result.rows[0]!.record
}

async function stored(id: string) {
  return (await database.query<Record>('select payload, version from public.iou_groups where id = $1', [id])).rows[0]
}

describe('iou initial schema executed in embedded PostgreSQL', () => {
  beforeAll(async () => {
    database = new PGlite()
    await database.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `)
    await database.query('insert into auth.users(id) values ($1),($2),($3)', [creator, collaborator, stranger])
    await database.exec(await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8'))
  }, 30_000)

  afterAll(async () => {
    await database?.close()
  })

  it('installs RLS and restricts direct writes and privileged functions', async () => {
    await database.exec('reset role')
    const tables = await database.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('iou_groups','iou_group_access') order by relname",
    )
    expect(tables.rows).toEqual([
      { relname: 'iou_group_access', relrowsecurity: true },
      { relname: 'iou_groups', relrowsecurity: true },
    ])
    const grants = await database.query<{ allowed: boolean }>(`select
      has_function_privilege('anon','public.iou_create_group(jsonb)','execute') or
      has_function_privilege('authenticated','private.iou_valid_group(jsonb)','execute') or
      has_table_privilege('authenticated','public.iou_groups','insert,update,delete') as allowed`)
    expect(grants.rows[0]!.allowed).toBe(false)
    const functions = await database.query<{ schema: string; prosecdef: boolean; proconfig: string[] }>(`select n.nspname as schema, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='iou_save_group' order by n.nspname`)
    expect(functions.rows.map(row => ({ ...row, proconfig: row.proconfig.join(',') }))).toEqual([
      { schema: 'private', prosecdef: true, proconfig: 'search_path=""' },
      { schema: 'public', prosecdef: false, proconfig: 'search_path=""' },
    ])
  })

  it('denies unauthenticated callers and hides records from authenticated nonmembers', async () => {
    await identity(null, 'anon')
    await expect(create()).rejects.toMatchObject({ code: '42501' })
    await identity(null)
    await expect(create()).rejects.toMatchObject({ code: '42501' })
    await identity(creator)
    const record = await create()
    expect(await stored(record.payload.id)).toEqual(record)
    await expect(database.query('delete from public.iou_groups where id=$1', [record.payload.id])).rejects.toMatchObject({ code: '42501' })
    await identity(stranger)
    expect(await stored(record.payload.id)).toBeUndefined()
    expect((await database.query('select * from public.iou_group_access')).rows).toEqual([])
    await expect(save(record, { name: 'Unauthorized' })).rejects.toMatchObject({ code: '42501' })
  })

  it('uses server invitations and keeps create/join retries idempotent', async () => {
    await identity(creator)
    const payload = group()
    const record = await create(payload)
    expect(record.payload.inviteCode).toMatch(/^[a-f0-9]{32}$/)
    expect(record.payload.inviteCode).not.toBe(payload.inviteCode)
    const edited = await save(record, { name: 'Already edited' })
    expect(await create(payload)).toEqual(edited)
    await identity(collaborator)
    await expect(database.query('select public.iou_join_group($1)', [record.payload.inviteCode.slice(0, 12)])).rejects.toMatchObject({ code: 'P0001' })
    for (let attempt = 0; attempt < 2; attempt++) {
      const joined = await database.query<{ record: Record }>('select public.iou_join_group($1) as record', [` ${record.payload.inviteCode.toUpperCase()}\n`])
      expect(joined.rows[0]!.record).toEqual(edited)
    }
    expect((await database.query('select group_id from public.iou_group_access where group_id=$1', [record.payload.id])).rows).toHaveLength(1)
    expect(await stored(record.payload.id)).toEqual(edited)
  })

  it('executes revision comparisons and returns PT409 without modifying the current row', async () => {
    await identity(creator)
    const record = await create()
    const edited = await save(record, { name: 'Committed title' })
    expect(edited.version).toBe(record.version + 1)
    await expect(save(record, { name: 'Stale title' })).rejects.toMatchObject({ code: 'PT409', message: 'IOU_CONFLICT' })
    expect(await stored(record.payload.id)).toEqual(edited)
  })

  it('rolls back earlier writes if a later save fails inside the same transaction', async () => {
    await identity(creator)
    const record = await create()
    await database.exec('begin')
    const pending = await save(record, { name: 'Uncommitted edit' })
    await expect(save(pending, { currency: 'USD' })).rejects.toMatchObject({ code: '22023', message: 'IOU_IMMUTABLE_SETTINGS' })
    await database.exec('rollback')
    expect(await stored(record.payload.id)).toEqual(record)
  })

  it('executes ledger validation and leaves data unchanged after invalid payloads', async () => {
    await identity(creator)
    const record = await create()
    const expense = {
      id: 'expense-1',
      type: 'expense' as const,
      description: 'Dinner',
      amount: 100,
      paidBy: 'alice',
      shares: { alice: 50, bob: 50 },
      category: 'Food',
      date: '2026-01-01',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const valid = await save(record, { transactions: [expense] })
    for (const transactions of [[{ ...expense, shares: { alice: 49, bob: 50 } }], [{ ...expense, date: '2026-02-30' }], [{ ...expense, amount: 1.5 }], [{ ...expense, paidBy: 'missing-member' }]]) {
      await expect(save(valid, { transactions })).rejects.toMatchObject({ code: '22023' })
      expect(await stored(record.payload.id)).toEqual(valid)
    }
  })

  it('rolls back a failed initial-schema rerun without disturbing saved data or grants', async () => {
    await identity(creator)
    const record = await create()
    await database.exec('reset role')
    await expect(database.exec(await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8'))).rejects.toMatchObject({ code: '42P07' })
    await database.exec('rollback')
    await identity(creator)
    expect(await stored(record.payload.id)).toEqual(record)
    expect((await save(record, { name: 'Still usable' })).version).toBe(2)
  })
})
