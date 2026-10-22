import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Expense, Group, Payment } from '../../domain/groups/types'
import { groupDelta } from './groupDelta'
import { exportGroupCsv } from '../../domain/groups/csv'

const creator = randomUUID()
const stranger = randomUUID()
const sql = (file: string) => readFile(new URL(`../../../supabase/${file}`, import.meta.url), 'utf8')
let database: PGlite
interface Record {
  payload: Group
  version: number
}
const expense: Expense = {
  id: 'expense',
  type: 'expense',
  description: 'Dinner',
  amount: 1_000_000_000_000,
  paidBy: 'alice',
  shares: { alice: 1_000_000_000_000, bob: 0 },
  category: 'Food',
  date: '2026-01-02',
  createdAt: '2026-01-02T00:00:00Z',
}
const payment: Payment = { id: 'payment', type: 'payment', amount: 321, fromId: 'bob', toId: 'alice', note: 'Thanks 🌴', date: '2026-01-03', createdAt: '2026-01-03T00:00:00.1Z' }
function group(): Group {
  return {
    id: `row-${randomUUID()}`,
    name: 'Exact trip',
    description: 'Unicode 日本語',
    currency: 'THB',
    icon: '🌴',
    color: '#123',
    inviteCode: '0'.repeat(32),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00.100Z',
    members: [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
    ],
    transactions: [expense, payment],
  }
}
async function identity(user = creator) {
  await database.exec('reset role')
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  await database.exec('set role authenticated')
}
async function initialize(source: string) {
  const db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`)
  await db.query('insert into auth.users values($1),($2)', [creator, stranger])
  await db.exec(source)
  return db
}
async function installLive() {
  await database.exec(`create schema realtime;
    create table realtime.messages(payload jsonb,event text,topic text,private boolean,extension text);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$
      insert into realtime.messages values(payload,event,topic,private,'broadcast');$$;`)
  await database.exec(await sql('update-live-sync.sql'))
}
async function create(payload = group()): Promise<Record> {
  return (await database.query<{ value: Record }>('select public.iou_create_group($1::jsonb) value', [JSON.stringify(payload)])).rows[0]!.value
}
async function delta(record: Record, payload: Group) {
  return (
    await database.query<{ value: { format: number; id: string; version: number } }>('select public.iou_save_group_delta($1,$2,$3::jsonb) value', [
      payload.id,
      record.version,
      JSON.stringify(groupDelta(record.payload, payload)),
    ])
  ).rows[0]!.value
}
async function stored(id: string): Promise<Record> {
  return (await database.query<Record>('select payload,version from public.iou_groups where id=$1', [id])).rows[0]!
}
async function budget(id: string) {
  await database.exec('reset role')
  const result = (
    await database.query<{ valid: boolean }>(
      `select h.payload_bytes=octet_length(g.payload::text)
    and h.member_count=jsonb_array_length(g.payload->'members') and h.transaction_count=jsonb_array_length(g.payload->'transactions')
    and h.member_bytes=(select sum(payload_bytes) from public.iou_members where group_id=h.id)
    and h.transaction_bytes=(select coalesce(sum(payload_bytes),0) from public.iou_transactions where group_id=h.id) as valid
    from public.iou_group_headers h join public.iou_groups g on g.id=h.id where h.id=$1`,
      [id],
    )
  ).rows[0]!.valid
  await identity()
  expect(result).toBe(true)
}

describe('authoritative IOU rows and checked deltas', () => {
  beforeAll(async () => {
    database = await initialize(await sql('schema.sql'))
    await identity()
  }, 30_000)
  afterAll(async () => {
    await database?.close()
  })

  it('preserves exact money, zero versus excluded shares, textual timestamps and CSV', async () => {
    const record = await create()
    expect(record.payload.transactions).toEqual([expense, payment])
    const changed = { ...record.payload, transactions: [{ ...expense, shares: { alice: expense.amount }, description: 'Revised' }, payment] }
    const receipt = await delta(record, changed)
    expect(receipt).toEqual({ format: 1, id: changed.id, version: 2 })
    const current = await stored(changed.id)
    expect(current).toEqual({ payload: changed, version: 2 })
    expect(exportGroupCsv(current.payload)).toBe(exportGroupCsv(changed))
    await budget(changed.id)
  })

  it('preserves integer-valued scaled JSON numerics and budgets from affected stored rows', async () => {
    const raw = JSON.stringify(group()).replace('"amount":1000000000000', '"amount":1000000000000.0').replace('"bob":0', '"bob":0.0')
    const record = (await database.query<{ value: Record }>('select public.iou_create_group($1::jsonb) value', [raw])).rows[0]!.value
    const changed = { ...record.payload, transactions: [{ ...expense, description: 'Scaled money' }, payment] }
    const patch = JSON.stringify(groupDelta(record.payload, changed)).replace('"amount":1000000000000', '"amount":1000000000000.00').replace('"bob":0', '"bob":0.000')
    await database.query('select public.iou_save_group_delta($1,$2,$3::jsonb)', [record.payload.id, record.version, patch])
    const text = (await database.query<{ payload: string }>('select payload::text from public.iou_groups where id=$1', [record.payload.id])).rows[0]!.payload
    expect(text).toContain('1000000000000.00')
    expect(text).toContain('"bob": 0.000')
    await budget(record.payload.id)
    await database.exec('reset role')
    await database.exec(await sql('schema.sql'))
    await identity()
    expect((await database.query<{ payload: string }>('select payload::text from public.iou_groups where id=$1', [record.payload.id])).rows[0]!.payload).toBe(text)
  })

  it('retains transaction positions through deletion, insertion, type changes and explicit reordering', async () => {
    let record = await create()
    const converted = { ...payment, id: expense.id }
    let changed: Group = { ...record.payload, transactions: [converted, payment] }
    await delta(record, changed)
    record = await stored(changed.id)
    expect(record.payload.transactions.map(t => t.id)).toEqual([expense.id, payment.id])
    changed = { ...record.payload, transactions: [payment, converted] }
    await delta(record, changed)
    record = await stored(changed.id)
    expect(record.payload.transactions).toEqual([payment, converted])
    changed = { ...record.payload, transactions: [converted, { ...expense, id: 'new-expense' }] }
    await delta(record, changed)
    expect((await stored(changed.id)).payload).toEqual(changed)
    await budget(changed.id)
  })

  it('enforces the exact serialized byte boundary incrementally, including multibyte notes', async () => {
    const payload = { ...group(), transactions: Array.from({ length: 5000 }, (_, i) => ({ ...payment, id: `budget-${i}`, note: 'A'.repeat(500) })) }
    const size = (await database.query<{ bytes: number }>('select octet_length($1::jsonb::text) bytes', [JSON.stringify(payload)])).rows[0]!.bytes
    let extra = 4_000_000 - size
    expect(extra).toBeGreaterThan(0)
    for (const transaction of payload.transactions) {
      const multibyte = Math.min(extra, 500)
      transaction.note = 'Æ'.repeat(multibyte) + 'A'.repeat(500 - multibyte)
      extra -= multibyte
    }
    expect(extra).toBe(0)
    const record = await create(payload)
    await budget(record.payload.id)
    const index = record.payload.transactions.findIndex(t => t.type === 'payment' && t.note.includes('A'))
    const changed = { ...record.payload, transactions: record.payload.transactions.map((t, i) => (i === index && t.type === 'payment' ? { ...t, note: t.note.replace('A', 'Æ') } : t)) }
    await expect(delta(record, changed)).rejects.toMatchObject({ code: '22023', message: 'IOU_INVALID_GROUP' })
    expect((await stored(record.payload.id)).version).toBe(record.version)
    await budget(record.payload.id)
    // The size boundary is checked here; later migration tests use their own fixtures.
    await database.exec('reset role')
    await database.query('delete from public.iou_group_headers where id=$1', [record.payload.id])
    await identity()
  }, 30_000)

  it('rejects lost-response retries and accepts rebased subsequent deltas', async () => {
    const record = await create()
    const changed = { ...record.payload, description: 'Accepted edit' }
    await delta(record, changed)
    await expect(delta(record, changed)).rejects.toMatchObject({ code: 'PT409', message: 'IOU_CONFLICT' })
    const accepted = await stored(record.payload.id)
    const next = { ...accepted.payload, transactions: [expense, { ...payment, note: 'Rebased edit' }] }
    await delta(accepted, next)
    expect(await stored(record.payload.id)).toEqual({ payload: next, version: 3 })
  })

  it('rejects invalid financial tuples, orphaning removals, malformed orders and hidden metadata arrays atomically', async () => {
    const record = await create()
    const invalid = [
      { ...record.payload, transactions: [{ ...expense, shares: { alice: 1 } }, payment] },
      { ...record.payload, members: [record.payload.members[0]] },
      { ...record.payload, currency: 'USD' },
    ]
    for (const value of invalid) {
      await expect(delta(record, value as Group)).rejects.toMatchObject({ code: '22023' })
      expect(await stored(record.payload.id)).toEqual(record)
    }
    const patch = groupDelta(record.payload, record.payload)
    for (const bad of [
      { ...patch, metadata: { ...patch.metadata, transactions: [expense] } },
      { ...patch, transactions: { ...patch.transactions, order: [expense.id, expense.id] } },
      { ...patch, members: { ...patch.members, remove: ['missing', 'missing'] } },
    ]) {
      await expect(database.query('select public.iou_save_group_delta($1,$2,$3::jsonb)', [record.payload.id, record.version, JSON.stringify(bad)])).rejects.toMatchObject({ code: '22023' })
      expect(await stored(record.payload.id)).toEqual(record)
    }
  })

  it('checks deferred references before receipts and allows later writes after a failed savepoint', async () => {
    const record = await create()
    await database.exec('begin;savepoint invalid_member')
    try {
      await expect(delta(record, { ...record.payload, members: [record.payload.members[0]] })).rejects.toMatchObject({ code: '22023', message: 'IOU_INVALID_GROUP' })
      await database.exec('rollback to savepoint invalid_member')
      const changed = { ...record.payload, description: 'Valid after rejected orphaning edit' }
      expect(await delta(record, changed)).toEqual({ format: 1, id: record.payload.id, version: 2 })
      const accepted = await stored(record.payload.id)
      expect((await delta(accepted, { ...accepted.payload, name: 'Another valid save in this transaction' })).version).toBe(3)
      await database.exec('set constraints all immediate;commit')
      expect((await stored(record.payload.id)).version).toBe(3)
    } catch (error) {
      await database.exec('rollback')
      throw error
    }
  })

  it('preserves administrative whole-group deletion without orphaning normalized rows', async () => {
    const record = await create()
    await database.exec('reset role')
    await database.query('delete from public.iou_groups where id=$1', [record.payload.id])
    for (const table of ['iou_group_access', 'iou_members', 'iou_transactions', 'iou_expenses', 'iou_payments', 'iou_expense_shares'])
      expect((await database.query(`select * from public.${table} where group_id=$1`, [record.payload.id])).rows).toEqual([])
    await identity()
  })

  it('denies child reads/writes and projection helpers to identities without membership', async () => {
    const record = await create()
    await identity(stranger)
    expect((await database.query('select * from public.iou_groups where id=$1', [record.payload.id])).rows).toEqual([])
    expect((await database.query<{ value: Group | null }>('select private.iou_group_payload($1) value', [record.payload.id])).rows[0]!.value).toBeNull()
    for (const table of ['iou_group_headers', 'iou_members', 'iou_transactions', 'iou_expenses', 'iou_payments', 'iou_expense_shares']) {
      expect((await database.query(`select * from public.${table}`)).rows).toEqual([])
      await expect(database.query(`delete from public.${table}`)).rejects.toMatchObject({ code: '42501' })
    }
    await expect(delta(record, record.payload)).rejects.toMatchObject({ code: '42501', message: 'IOU_ACCESS_DENIED' })
    await identity()
  })

  it('replaces stale broad policy bodies under maintained names and reasserts browser grants', async () => {
    const record = await create()
    await database.exec(`reset role;
      drop policy iou_read_joined_groups on public.iou_group_headers;
      create policy iou_read_joined_groups on public.iou_group_headers for select to authenticated using(true);
      drop policy iou_read_own_access on public.iou_group_access;
      create policy iou_read_own_access on public.iou_group_access for select to authenticated using(true);
      grant update on public.iou_group_headers,public.iou_group_access to authenticated;`)
    await identity(stranger)
    // Child policies still fence ledger rows, but the stale header policy leaks its invitation.
    expect((await stored(record.payload.id)).payload.inviteCode).toBe(record.payload.inviteCode)
    await database.exec('reset role')
    await database.exec(await sql('schema.sql'))
    await identity(stranger)
    expect((await database.query('select * from public.iou_groups where id=$1', [record.payload.id])).rows).toEqual([])
    expect((await database.query('select * from public.iou_group_access')).rows).toEqual([])
    expect((await database.query<{ value: Group | null }>('select private.iou_group_payload($1) value', [record.payload.id])).rows[0]!.value).toBeNull()
    expect(
      (
        await database.query<{ writes: boolean }>(`select has_table_privilege('authenticated','public.iou_group_headers','update')
      or has_table_privilege('authenticated','public.iou_group_access','update') writes`)
      ).rows[0]!.writes,
    ).toBe(false)
    await identity()
  })

  it('notifies once per member for a checked entity change, with no child-row notifications', async () => {
    await database.exec('reset role')
    await installLive()
    await database.exec(await sql('update-live-sync.sql'))
    await identity()
    const record = await create()
    await database.exec('reset role;truncate realtime.messages')
    await identity()
    await delta(record, { ...record.payload, transactions: [{ ...expense, description: 'Live note', shares: { alice: expense.amount - 1, bob: 1 } }, payment] })
    await database.exec('reset role')
    const messages = (await database.query<{ payload: unknown; topic: string; private: boolean }>('select payload,topic,private from realtime.messages')).rows
    expect(messages).toEqual([{ payload: { id: record.payload.id, revision: 2 }, topic: `iou:user:${creator}`, private: true }])
    await identity()
  })

  it('edits one of 1000 transactions without validating or assembling the whole ledger or touching other entities', async () => {
    const payload = { ...group(), transactions: Array.from({ length: 1000 }, (_, i) => ({ ...payment, id: `payment-${i}` })) }
    const record = await create(payload)
    await database.exec('reset role')
    const definitions = (
      await database.query<{ name: string; body: string }>(`select proname name,pg_get_functiondef(oid) body from pg_proc
      where oid in ('private.iou_valid_group(jsonb)'::regprocedure,'private.iou_group_payload(text)'::regprocedure)`)
    ).rows
    await database.exec(`create table public.iou_test_touches(relation text,id text);
      create function private.iou_test_touch() returns trigger language plpgsql as $$ begin insert into public.iou_test_touches values(tg_table_name,new.id);return new;end $$;
      create trigger iou_test_payments after update on public.iou_payments for each row execute function private.iou_test_touch();
      create trigger iou_test_transactions after update on public.iou_transactions for each row execute function private.iou_test_touch();`)
    for (const { name, body } of definitions) {
      if (name === 'iou_valid_group')
        await database.exec(body.replace('begin\n', "begin\n  if jsonb_array_length(p_payload->'transactions')>0 then raise exception 'Whole-ledger validation'; end if;\n"))
      else
        await database.exec(
          `create or replace function private.iou_group_payload(p_group_id text) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin raise exception 'Whole-ledger assembly';end;$$;`,
        )
    }
    try {
      await identity()
      const changed = { ...record.payload, transactions: record.payload.transactions.map((t, i) => (i === 500 ? { ...t, note: 'One changed note' } : t)) }
      expect(await delta(record, changed)).toEqual({ format: 1, id: record.payload.id, version: 2 })
      await database.exec('reset role')
      const touched = (await database.query<{ relation: string; id: string }>('select * from public.iou_test_touches')).rows
      expect(touched).toHaveLength(2)
      expect(touched.every(t => t.id === 'payment-500')).toBe(true)
    } finally {
      await database.exec('reset role')
      for (const { body } of definitions) await database.exec(body)
      await database.exec(
        'drop trigger iou_test_payments on public.iou_payments;drop trigger iou_test_transactions on public.iou_transactions;drop function private.iou_test_touch();drop table public.iou_test_touches;',
      )
      await identity()
    }
    await budget(record.payload.id)
    await database.exec('reset role')
    await database.query('delete from public.iou_group_headers where id=$1', [record.payload.id])
    await identity()
  }, 15_000)

  it('refreshes current rows after edits without changing documents, access, ordering or versions', async () => {
    const record = await create()
    await delta(record, { ...record.payload, name: 'Latest accepted data', transactions: [payment, { ...expense, description: 'Newest' }] })
    const latest = await stored(record.payload.id)
    await database.exec('reset role')
    const access = (await database.query('select * from public.iou_group_access order by group_id,user_id')).rows
    await database.exec(await sql('schema.sql'))
    await database.exec(await sql('schema.sql'))
    expect((await database.query('select * from public.iou_group_access order by group_id,user_id')).rows).toEqual(access)
    await identity()
    expect(await stored(record.payload.id)).toEqual(latest)
    await budget(record.payload.id)
  }, 15_000)

  it('aborts a refresh atomically when current row budgets are inconsistent', async () => {
    const record = await create()
    await database.exec('reset role')
    await database.query('update public.iou_group_headers set payload_bytes=payload_bytes+1 where id=$1', [record.payload.id])
    await expect(database.exec(await sql('schema.sql'))).rejects.toThrow('IOU_ROW_AUTHORITY_INVALID')
    await database.exec('rollback')
    await database.query('update public.iou_group_headers set payload_bytes=payload_bytes-1 where id=$1', [record.payload.id])
    await identity()
    expect(await stored(record.payload.id)).toEqual(record)
    await budget(record.payload.id)
  })
})
