import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Group } from '../../domain/groups/types'
import { groupDelta } from './groupDelta'

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
  const payload = { ...record.payload, ...patch }
  const result = await database.query<{ receipt: { version: number } }>('select public.iou_save_group_delta($1,$2,$3::jsonb) receipt', [
    payload.id,
    version,
    JSON.stringify(groupDelta(record.payload, payload)),
  ])
  return { payload, version: result.rows[0]!.receipt.version }
}

async function stored(id: string) {
  return (await database.query<Record>('select payload, version from public.iou_groups where id = $1', [id])).rows[0]
}

describe('iou current schema executed in embedded PostgreSQL', () => {
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
      "select relname, relrowsecurity from pg_class where relname in ('iou_group_headers','iou_group_access') order by relname",
    )
    expect(tables.rows).toEqual([
      { relname: 'iou_group_access', relrowsecurity: true },
      { relname: 'iou_group_headers', relrowsecurity: true },
    ])
    const grants = await database.query<{ allowed: boolean }>(`select
      has_function_privilege('anon','public.iou_create_group(jsonb)','execute') or
      has_function_privilege('authenticated','private.iou_valid_group(jsonb)','execute') or
      has_table_privilege('authenticated','public.iou_groups','insert,update,delete') as allowed`)
    expect(grants.rows[0]!.allowed).toBe(false)
    const functions = await database.query<{ schema: string; prosecdef: boolean; proconfig: string[] }>(`select n.nspname as schema, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='iou_save_group_delta' order by n.nspname`)
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

  it('refreshes the current schema without changing data or revisions', async () => {
    await identity(creator)
    const record = await create()
    await database.exec('reset role')
    const source = await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8')
    await database.exec(source)
    await database.exec(source)
    await identity(creator)
    expect(await stored(record.payload.id)).toEqual(record)
    expect((await save(record, { name: 'Still usable' })).version).toBe(2)
  })

  it('returns only a caller’s joined revisions with no ledger or invitation data', async () => {
    const heads = async () => (await database.query<{ result: { format: number; heads: { id: string; version: number }[] } }>('select public.iou_group_heads() as result')).rows[0]!.result
    await identity(creator)
    const record = await create()
    const updated = await save(record, { name: 'New revision' })
    const result = await heads()
    expect(result.format).toBe(1)
    expect(result.heads).toContainEqual({ id: record.payload.id, version: updated.version })
    expect(result.heads.every(row => Object.keys(row).sort().join() === 'id,version')).toBe(true)
    await identity(stranger)
    expect(await heads()).toEqual({ format: 1, heads: [] })
    await database.query('select public.iou_join_group($1)', [record.payload.inviteCode])
    expect(await heads()).toEqual({ format: 1, heads: [{ id: record.payload.id, version: updated.version }] })
    await identity(null)
    await expect(heads()).rejects.toMatchObject({ code: '42501', message: 'IOU_AUTH_REQUIRED' })
    await identity(null, 'anon')
    await expect(heads()).rejects.toMatchObject({ code: '42501' })
  })

  it('upgrades and replays without changing records, grants or the current read implementation', async () => {
    await database.exec('reset role')
    const definition = (await database.query("select pg_get_functiondef('private.iou_group_heads()'::regprocedure) as body")).rows
    const before = (await database.query('select * from public.iou_groups order by id')).rows
    await database.exec('drop function public.iou_group_heads(); drop function private.iou_group_heads();')
    const update = await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8')
    await database.exec(update)
    await database.exec(update)
    expect((await database.query("select pg_get_functiondef('private.iou_group_heads()'::regprocedure) as body")).rows).toEqual(definition)
    expect((await database.query('select * from public.iou_groups order by id')).rows).toEqual(before)
    expect(
      (
        await database.query(`select
      has_function_privilege('anon','public.iou_group_heads()','execute') as anonymous,
      has_function_privilege('anon','private.iou_group_heads()','execute') as private_anonymous,
      has_function_privilege('authenticated','public.iou_group_heads()','execute') as signed_in,
      has_table_privilege('authenticated','public.iou_groups','insert,update,delete') as writes`)
      ).rows,
    ).toEqual([{ anonymous: false, private_anonymous: false, signed_in: true, writes: false }])
  })

  it('retires obsolete installed writes/history without cascading unknown dependencies', async () => {
    await database.exec('reset role')
    const before = (await database.query('select * from public.iou_groups order by id')).rows
    await database.exec(`create function private.iou_save_group(jsonb,bigint) returns jsonb language sql as $$select $1$$;
      create function public.iou_save_group(jsonb,bigint) returns jsonb language sql as $$select $1$$;
      create table private.iou_row_backfill(group_id text primary key,source_version bigint,source_hash text);
      create view private.iou_test_dependency as select public.iou_save_group('{}'::jsonb,1::bigint) result;`)
    const source = await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8')
    await expect(database.exec(source)).rejects.toMatchObject({ code: '2BP01' })
    await database.exec('rollback')
    expect((await database.query('select * from public.iou_groups order by id')).rows).toEqual(before)
    await database.exec('drop view private.iou_test_dependency')
    await database.exec(source)
    expect(
      (
        await database.query(`select to_regprocedure('public.iou_save_group(jsonb,bigint)') a,
      to_regprocedure('private.iou_save_group(jsonb,bigint)') b,to_regclass('private.iou_row_backfill') c`)
      ).rows,
    ).toEqual([{ a: null, b: null, c: null }])
    expect((await database.query('select * from public.iou_groups order by id')).rows).toEqual(before)
  })

  it('returns more than a normal API row cap in one scalar response', async () => {
    const reader = randomUUID()
    await database.exec('reset role')
    await database.query('insert into auth.users(id) values ($1)', [reader])
    await database.query(
      `insert into public.iou_group_headers(id,invite_code,metadata,member_count,transaction_count,member_bytes,transaction_bytes,payload_bytes)
      select 'bulk-' || n, md5('bulk-' || n), $1::jsonb || jsonb_build_object('id','bulk-' || n,'inviteCode',md5('bulk-' || n)),0,0,0,0,0
      from generate_series(1,1100) n`,
      [JSON.stringify((({ members: _members, transactions: _transactions, ...metadata }) => metadata)(group()))],
    )
    // Administrator fixture bypasses per-identity create/join quotas, while each
    // normalized ledger still satisfies the production row/counter invariants.
    await database.query(
      `select private.iou_apply_delta(id,jsonb_build_object('metadata',metadata,
        'members',jsonb_build_object('upsert',$1::jsonb,'remove','[]'::jsonb),
        'transactions',jsonb_build_object('upsert','[]'::jsonb,'remove','[]'::jsonb)))
        from public.iou_group_headers where id like 'bulk-%'`,
      [JSON.stringify(group().members)],
    )
    await database.query("insert into public.iou_group_access(group_id,user_id) select id,$1::uuid from public.iou_groups where id like 'bulk-%'", [reader])
    await identity(reader)
    const reply = await database.query<{ result: { format: number; heads: { id: string; version: number }[] } }>('select public.iou_group_heads() as result')
    expect(reply.rows).toHaveLength(1)
    expect(reply.rows[0]!.result.heads).toHaveLength(1100)
    expect(reply.rows[0]!.result.heads.every(({ version }) => version === 1)).toBe(true)
  })

  it('installs optional private invalidations repeatedly without changing data or allowing client publishing', async () => {
    await database.exec('reset role')
    const migration = await readFile(new URL('../../../supabase/update-live-sync.sql', import.meta.url), 'utf8')
    await expect(database.exec(migration)).rejects.toThrow('requires existing Supabase Realtime')
    await database.exec('rollback')
    await database.exec(`create schema realtime;
      create table realtime.messages(payload jsonb, event text, topic text, private boolean, extension text);
      alter table realtime.messages enable row level security;
      grant usage on schema realtime to authenticated;
      grant select on realtime.messages to authenticated;
      create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
      create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as $$
        insert into realtime.messages values(payload,event,topic,private,'broadcast');
      $$;`)
    const before = (await database.query('select * from public.iou_groups order by id')).rows
    await database.exec(migration)
    await database.exec(migration)
    expect((await database.query('select * from public.iou_groups order by id')).rows).toEqual(before)
    await identity(creator)
    const record = await create()
    await identity(collaborator)
    await database.query('select public.iou_join_group($1)', [record.payload.inviteCode])
    await database.exec('reset role; truncate realtime.messages')
    await identity(creator)
    const updated = await save(record, { name: 'Live update' })
    await database.exec('reset role')
    const messages = (await database.query<{ payload: unknown; topic: string; private: boolean; event: string }>('select payload,topic,private,event from realtime.messages order by topic')).rows
    expect(messages).toHaveLength(2)
    expect(messages.map(row => row.topic).sort()).toEqual([creator, collaborator].map(id => `iou:user:${id}`).sort())
    expect(messages.every(row => row.private && row.event === 'changed')).toBe(true)
    expect(messages.map(row => row.payload)).toEqual([0, 1].map(() => ({ id: record.payload.id, revision: updated.version })))
    await identity(creator)
    await database.query("select set_config('realtime.topic',$1,false)", [`iou:user:${creator}`])
    expect((await database.query('select * from realtime.messages')).rows).toHaveLength(1)
    await database.query("select set_config('realtime.topic',$1,false)", [`iou:user:${stranger}`])
    expect((await database.query('select * from realtime.messages')).rows).toEqual([])
    expect((await database.query("select has_table_privilege('authenticated','realtime.messages','insert') as publish")).rows).toEqual([{ publish: false }])
    await database.exec('reset role')
    await database.exec(
      `create or replace function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language plpgsql as $$ begin raise exception 'realtime unavailable'; end $$;`,
    )
    await identity(creator)
    expect((await save(updated, { description: 'Durable despite notification failure' })).version).toBe(updated.version + 1)
  })
})
