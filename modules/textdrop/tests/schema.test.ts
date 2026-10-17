import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_TEXT_BYTES, readPage, type TextDropPage } from '../src/domain/snippets/model';

const creator = randomUUID();
const collaborator = randomUUID();
const stranger = randomUUID();
const schema = new URL('../supabase/schema.sql', import.meta.url);
const update = new URL('../supabase/update-poll-and-grants.sql', import.meta.url);
const receiptUpdate = new URL('../supabase/update-save-receipt.sql', import.meta.url);
const guide = new URL('../supabase/README.md', import.meta.url);
let database: PGlite;
let siblingState: Record<string, unknown>[];
const dataApiReloads: string[] = [];

async function identity(user: string | null, role = 'authenticated'): Promise<void> {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await database.exec(`set role ${role}`);
}

async function create(id: string = randomUUID()): Promise<TextDropPage> {
  const result = await database.query<{ page: TextDropPage }>('select public.textdrop_create_page($1::uuid) as page', [id]);
  return result.rows[0]!.page;
}

async function join(code: string | null): Promise<TextDropPage> {
  const result = await database.query<{ page: TextDropPage }>('select public.textdrop_join_page($1) as page', [code]);
  return result.rows[0]!.page;
}

async function load(id: string): Promise<TextDropPage> {
  const result = await database.query<{ page: TextDropPage }>('select public.textdrop_poll_page($1::uuid, null) as page', [id]);
  return result.rows[0]!.page;
}

async function save(id: string, text: string | null): Promise<TextDropPage> {
  const result = await database.query<{ receipt: Omit<TextDropPage, 'text'> }>('select public.textdrop_save_page_receipt($1::uuid, $2) as receipt', [id, text]);
  const receipt = result.rows[0]!.receipt;
  expect(Object.keys(receipt).sort()).toEqual(['code', 'id', 'name', 'updatedAt', 'version']);
  return readPage({ ...receipt, text });
}

async function poll(id: string, known: number | null): Promise<Record<string, unknown>> {
  const result = await database.query<{ page: Record<string, unknown> }>('select public.textdrop_poll_page($1::uuid, $2::bigint) as page', [id, known]);
  return result.rows[0]!.page;
}

async function siblings(): Promise<Record<string, unknown>[]> {
  return (
    await database.query<Record<string, unknown>>(`
    select c.relname, c.relacl::text, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('iou_groups','iou_group_access','pinboard_boards','pinboard_board_access')
    order by c.relname
  `)
  ).rows;
}

describe('TextDrop schema in embedded PostgreSQL', () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create schema private;
      create table public.iou_groups (id text primary key, payload jsonb not null);
      create table public.iou_group_access (group_id text, user_id uuid);
      create table public.pinboard_boards (id text primary key, payload jsonb not null);
      create table public.pinboard_board_access (board_id text, user_id uuid);
      alter table public.iou_groups enable row level security;
      alter table public.iou_group_access enable row level security;
      alter table public.pinboard_boards enable row level security;
      alter table public.pinboard_board_access enable row level security;
      revoke all on public.iou_groups, public.iou_group_access, public.pinboard_boards, public.pinboard_board_access from public, anon, authenticated;
      grant select on public.iou_groups, public.iou_group_access, public.pinboard_boards, public.pinboard_board_access to authenticated;
      create function public.iou_create_group(jsonb) returns jsonb language sql as $$ select $1; $$;
      revoke all on function public.iou_create_group(jsonb) from public, anon;
      grant execute on function public.iou_create_group(jsonb) to authenticated;
      insert into public.iou_groups values ('existing-iou', '{"name":"Untouched"}');
      insert into public.pinboard_boards values ('existing-pinboard', '{"title":"Untouched"}');
    `);
    await database.query('insert into auth.users (id) values ($1), ($2), ($3)', [creator, collaborator, stranger]);
    siblingState = await siblings();
    await database.listen('pgrst', payload => {
      dataApiReloads.push(payload);
    });
    await database.exec(await readFile(schema, 'utf8'));
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it('installs additively without changing sibling data, permissions, or RLS', async () => {
    await database.exec('reset role');
    expect(await siblings()).toEqual(siblingState);
    expect((await database.query("select payload from public.iou_groups where id = 'existing-iou'")).rows).toEqual([{ payload: { name: 'Untouched' } }]);
    expect((await database.query("select payload from public.pinboard_boards where id = 'existing-pinboard'")).rows).toEqual([{ payload: { title: 'Untouched' } }]);
    const functions = await database.query<{ nspname: string; proname: string; prosecdef: boolean; proconfig: string[] }>(`
      select n.nspname, p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname in ('textdrop_create_page','textdrop_join_page','textdrop_load_page','textdrop_save_page','textdrop_poll_page','textdrop_save_page_receipt')
      order by n.nspname, p.proname
    `);
    expect(functions.rows).toHaveLength(11);
    for (const row of functions.rows) {
      expect(row.prosecdef).toBe(row.nspname === 'private');
      expect(row.proconfig).toEqual(['search_path=""']);
    }
    const grants = await database.query(`
      select
        has_function_privilege('anon', 'public.textdrop_create_page(uuid)', 'execute') as anonymous,
        has_function_privilege('authenticated', 'public.textdrop_create_page(uuid)', 'execute') as signed_in,
        has_function_privilege('authenticated', 'private.textdrop_page_json(public.textdrop_pages)', 'execute') as serializer,
        has_table_privilege('authenticated', 'public.textdrop_pages', 'insert,update,delete') as direct_write,
        has_table_privilege('authenticated', 'public.textdrop_pages', 'select') as pages_read,
        has_table_privilege('authenticated', 'public.textdrop_page_access', 'select') as access_read,
        has_function_privilege('anon', 'public.textdrop_poll_page(uuid,bigint)', 'execute') as anonymous_poll,
        has_function_privilege('authenticated', 'public.textdrop_poll_page(uuid,bigint)', 'execute') as signed_in_poll,
        has_function_privilege('authenticated', 'public.iou_create_group(jsonb)', 'execute') as iou_unchanged
    `);
    expect(grants.rows[0]).toEqual({
      anonymous: false,
      signed_in: true,
      serializer: false,
      direct_write: false,
      pages_read: false,
      access_read: false,
      anonymous_poll: false,
      signed_in_poll: true,
      iou_unchanged: true,
    });
    const policies = await database.query("select policyname from pg_policies where tablename like 'textdrop_%'");
    expect(policies.rows).toEqual([]);
  });

  it('asks the Data API to reload its schema cache after installing', async () => {
    await vi.waitFor(() => {
      expect(dataApiReloads).toEqual(['reload schema']);
    });
  });

  // The setup guide is not part of standalone source snapshots.
  it.skipIf(!existsSync(guide))('runs every SQL query shown in the setup guide', async () => {
    const queries = [...(await readFile(guide, 'utf8')).matchAll(/`(select [^`]+;)`/g)].map(match => match[1]!);
    expect(queries).toHaveLength(2);
    await database.exec('reset role');
    for (const query of queries) expect((await database.query(query)).rows).toHaveLength(1);
  });

  it('denies anonymous visitors and signed-in strangers access to page contents and codes', async () => {
    await identity(creator);
    const page = await create();
    await identity(null, 'anon');
    await expect(database.query('select * from public.textdrop_pages')).rejects.toThrow('permission denied');
    await expect(join(page.code)).rejects.toThrow('permission denied');
    await expect(save(page.id, 'Stolen')).rejects.toThrow('permission denied');
    await identity(null);
    await expect(create()).rejects.toThrow('TEXTDROP_AUTH_REQUIRED');
    await expect(join(page.code)).rejects.toThrow('TEXTDROP_AUTH_REQUIRED');
    await expect(load(page.id)).rejects.toThrow('TEXTDROP_AUTH_REQUIRED');
    await expect(save(page.id, 'Stolen')).rejects.toThrow('TEXTDROP_AUTH_REQUIRED');
    await identity(stranger);
    await expect(database.query('select * from public.textdrop_pages where id = $1', [page.id])).rejects.toThrow('permission denied');
    await expect(database.query('select * from public.textdrop_page_access where page_id = $1', [page.id])).rejects.toThrow('permission denied');
    await expect(poll(page.id, 1)).rejects.toThrow('TEXTDROP_ACCESS_DENIED');
    await expect(save(page.id, 'Stolen')).rejects.toThrow('TEXTDROP_ACCESS_DENIED');
    await expect(database.query('update public.textdrop_pages set content = $1 where id = $2', ['Stolen', page.id])).rejects.toThrow('permission denied');
    await expect(database.query('delete from public.textdrop_pages where id = $1', [page.id])).rejects.toThrow('permission denied');
    await expect(database.query('insert into public.textdrop_page_access (page_id,user_id) values ($1,$2)', [page.id, stranger])).rejects.toThrow('permission denied');
    await expect(database.query('insert into public.textdrop_pages (id,code) values ($1,$2)', [randomUUID(), 'f'.repeat(32)])).rejects.toThrow('permission denied');
  });

  it('answers a conditional poll with a few bytes when the known version is current', async () => {
    await identity(creator);
    const page = await create();
    expect(await poll(page.id, 1)).toEqual({ id: page.id, unchanged: true, version: 1 });
    const edited = await save(page.id, 'Changed '.repeat(1000));
    expect(await poll(page.id, 1)).toEqual(edited);
    expect(await poll(page.id, null)).toEqual(edited);
    expect(await poll(page.id, 99)).toEqual(edited);
    expect(await poll(page.id, edited.version)).toEqual({ id: page.id, unchanged: true, version: edited.version });
    await identity(null);
    await expect(poll(page.id, 1)).rejects.toThrow('TEXTDROP_AUTH_REQUIRED');
    await identity(creator);
    await expect(poll(randomUUID(), 1)).rejects.toThrow('TEXTDROP_ACCESS_DENIED');
    await identity(null, 'anon');
    await expect(poll(page.id, 1)).rejects.toThrow('permission denied');
  });

  it('creates unique server codes and retries a stable ID without resetting later edits', async () => {
    await identity(creator);
    const page = await create();
    const other = await create();
    expect(page.code).toMatch(/^[a-f0-9]{32}$/);
    expect(other.code).not.toBe(page.code);
    expect(page.text).toBe('');
    expect(page.version).toBe(1);
    expect(readPage(page)).toEqual(page);
    const edited = await save(page.id, 'Edited after creation');
    expect(await create(page.id)).toEqual(edited);
    await identity(collaborator);
    await expect(create(page.id)).rejects.toThrow('TEXTDROP_INVALID_PAGE');
    await join(page.code);
    await expect(create(page.id)).rejects.toThrow('TEXTDROP_INVALID_PAGE');
    expect(await load(page.id)).toEqual(edited);
  });

  it('joins by a complete code with matching formatting rules and records membership once', async () => {
    await identity(creator);
    const page = await create();
    await identity(collaborator);
    await expect(join(page.code.slice(0, 8))).rejects.toThrow('TEXTDROP_INVALID_CODE');
    await expect(join('0'.repeat(32))).rejects.toThrow('TEXTDROP_INVALID_CODE');
    await expect(join(null)).rejects.toThrow('TEXTDROP_INVALID_CODE');
    await expect(join(`${page.code}\u00a0`)).rejects.toThrow('TEXTDROP_INVALID_CODE');
    const formatted = ` \t${page.code.slice(0, 16).toUpperCase()}-\n${page.code.slice(16).toUpperCase()}\r\f\v`;
    expect(await join(formatted)).toEqual(page);
    expect(await join(page.code)).toEqual(page);
    await database.exec('reset role');
    const access = await database.query<{ user_id: string }>('select user_id from public.textdrop_page_access where page_id = $1', [page.id]);
    expect(access.rows.map(row => row.user_id).sort()).toEqual([creator, collaborator].sort());
  });

  it('replaces the whole text in server acceptance order, including a stale client save', async () => {
    await identity(creator);
    const original = await create();
    await identity(collaborator);
    await join(original.code);
    const first = await save(original.id, 'The collaborator saves first');
    await identity(creator);
    // This caller still holds original version 1. There is deliberately no
    // expected-version argument: its later accepted save wins the entire text.
    const latest = await save(original.id, 'The creator saves later');
    expect(first.version).toBe(2);
    expect(latest.version).toBe(3);
    expect(latest.text).toBe('The creator saves later');
    expect(await load(original.id)).toEqual(latest);
    expect(Date.parse(latest.updatedAt)).toBeGreaterThanOrEqual(Date.parse(first.updatedAt));
    const repeated = await save(original.id, latest.text);
    expect(repeated.version).toBe(4);
    await identity(collaborator);
    expect(await load(original.id)).toEqual(repeated);
  });

  it('preserves exact literal text and allows clearing a page', async () => {
    await identity(creator);
    const page = await create();
    const text = '\t<script>alert(1)</script>\r\nবাংলা 😀\u0001  \n';
    expect((await save(page.id, text)).text).toBe(text);
    expect((await load(page.id)).text).toBe(text);
    expect((await save(page.id, '')).text).toBe('');
  });

  it('enforces the UTF-8 byte limit at the database and leaves content intact after invalid saves', async () => {
    await identity(creator);
    const page = await create();
    const maximum = '😀'.repeat(MAX_TEXT_BYTES / 4);
    const saved = await save(page.id, maximum);
    expect(saved.text).toBe(maximum);
    await expect(save(page.id, `${maximum}x`)).rejects.toThrow('TEXTDROP_INVALID_TEXT');
    await expect(save(page.id, 'é'.repeat(MAX_TEXT_BYTES / 2 + 1))).rejects.toThrow('TEXTDROP_INVALID_TEXT');
    await expect(save(page.id, null)).rejects.toThrow('TEXTDROP_INVALID_TEXT');
    expect(await load(page.id)).toEqual(saved);
    await expect(database.query('select public.textdrop_create_page(null::uuid)')).rejects.toThrow('TEXTDROP_INVALID_PAGE');
    await expect(save(randomUUID(), 'Missing')).rejects.toThrow('TEXTDROP_ACCESS_DENIED');
  });

  it('rejects version overflow without losing the final safe version', async () => {
    await identity(creator);
    const page = await create();
    await database.exec('reset role');
    await database.query('update public.textdrop_pages set version = 9007199254740991 where id = $1', [page.id]);
    await identity(creator);
    await expect(save(page.id, 'Overflow')).rejects.toThrow('TEXTDROP_VERSION_LIMIT');
    const final = await load(page.id);
    expect(final.version).toBe(Number.MAX_SAFE_INTEGER);
    expect(final.text).toBe('');
  });

  it('enforces create and join limits while allowing existing create and join retries', async () => {
    await database.exec('reset role');
    const limitedCreator = randomUUID();
    const limitedJoiner = randomUUID();
    await database.query('insert into auth.users (id) values ($1), ($2)', [limitedCreator, limitedJoiner]);
    await database.query(
      `
      insert into public.textdrop_pages (id,code,created_by)
      select gen_random_uuid(), lpad(to_hex(series), 32, '0'), $1::uuid
      from generate_series(1,100) as series
    `,
      [limitedCreator],
    );
    await database.query(
      `
      insert into public.textdrop_page_access (page_id,user_id)
      select id, $1::uuid from public.textdrop_pages where created_by = $1::uuid
    `,
      [limitedCreator],
    );
    const existing = (await database.query<{ id: string }>('select id from public.textdrop_pages where created_by = $1 limit 1', [limitedCreator])).rows[0]!;
    await identity(limitedCreator);
    await expect(create()).rejects.toThrow('TEXTDROP_PAGE_LIMIT');
    expect((await create(existing.id)).id).toBe(existing.id);
    await database.exec('reset role');
    await database.query(`
      insert into public.textdrop_pages (id,code)
      select gen_random_uuid(), lpad(to_hex(series), 32, '0')
      from generate_series(1001,2000) as series
    `);
    await database.query(
      `
      insert into public.textdrop_page_access (page_id,user_id)
      select id, $1::uuid from public.textdrop_pages where created_by is null
    `,
      [limitedJoiner],
    );
    const joined = (await database.query<{ code: string }>('select code from public.textdrop_pages where created_by is null limit 1')).rows[0]!;
    const unjoined = (await database.query<{ code: string }>('select code from public.textdrop_pages where created_by = $1 limit 1', [limitedCreator])).rows[0]!;
    await identity(limitedJoiner);
    await expect(join(unjoined.code)).rejects.toThrow('TEXTDROP_PAGE_LIMIT');
    await expect(create()).rejects.toThrow('TEXTDROP_PAGE_LIMIT');
    expect((await join(joined.code)).code).toBe(joined.code);
  });

  it('updates a project installed before the poll function and the read-grant removal, and can run again', async () => {
    const earlier = new PGlite();
    try {
      await earlier.exec(`
        create role anon; create role authenticated; create schema auth;
        create table auth.users (id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        grant usage on schema auth to anon, authenticated;
        grant execute on function auth.uid() to anon, authenticated;
        create schema private;
      `);
      await earlier.exec(await readFile(schema, 'utf8'));
      // Put the earlier schema back: no poll function, direct read grants and policies.
      await earlier.exec(`
        drop function public.textdrop_poll_page(uuid, bigint);
        drop function private.textdrop_poll_page(uuid, bigint);
        grant select on public.textdrop_pages, public.textdrop_page_access to authenticated;
        create policy textdrop_read_own_access on public.textdrop_page_access
          for select to authenticated using (user_id = (select auth.uid()));
        create policy textdrop_read_joined_pages on public.textdrop_pages
          for select to authenticated using (exists (
            select 1 from public.textdrop_page_access access
            where access.page_id = textdrop_pages.id and access.user_id = (select auth.uid())
          ));
      `);
      await earlier.query('insert into auth.users (id) values ($1)', [creator]);
      await earlier.query("select set_config('request.jwt.claim.sub', $1, false)", [creator]);
      await earlier.exec('set role authenticated');
      const kept = (await earlier.query<{ page: TextDropPage }>('select public.textdrop_create_page($1::uuid) as page', [randomUUID()])).rows[0]!.page;
      await expect(earlier.query('select public.textdrop_poll_page($1::uuid, 1)', [kept.id])).rejects.toThrow();
      expect((await earlier.query('select id from public.textdrop_pages')).rows).toHaveLength(1);
      await earlier.exec('reset role');
      for (let run = 0; run < 2; run += 1) await earlier.exec(await readFile(update, 'utf8'));
      expect((await earlier.query("select policyname from pg_policies where tablename like 'textdrop_%'")).rows).toEqual([]);
      expect(
        (
          await earlier.query(`
        select has_table_privilege('authenticated', 'public.textdrop_pages', 'select') as pages,
          has_table_privilege('authenticated', 'public.textdrop_page_access', 'select') as access,
          has_function_privilege('authenticated', 'public.textdrop_poll_page(uuid,bigint)', 'execute') as poll,
          has_function_privilege('anon', 'public.textdrop_poll_page(uuid,bigint)', 'execute') as anonymous_poll
      `)
        ).rows,
      ).toEqual([{ pages: false, access: false, poll: true, anonymous_poll: false }]);
      await earlier.exec('set role authenticated');
      expect((await earlier.query<{ page: unknown }>('select public.textdrop_poll_page($1::uuid, 1) as page', [kept.id])).rows[0]!.page).toEqual({ id: kept.id, unchanged: true, version: 1 });
      expect((await earlier.query<{ page: TextDropPage }>('select public.textdrop_load_page($1::uuid) as page', [kept.id])).rows[0]!.page).toEqual(kept);
    } finally {
      await earlier.close();
    }
  }, 30_000);

  it('rolls back an attempted rerun without changing existing pages or sibling objects', async () => {
    await database.exec('reset role');
    const before = (await database.query('select count(*) as count from public.textdrop_pages')).rows;
    await expect(database.exec(await readFile(schema, 'utf8'))).rejects.toThrow('already exists');
    await database.exec('rollback');
    expect((await database.query('select count(*) as count from public.textdrop_pages')).rows).toEqual(before);
    expect(await siblings()).toEqual(siblingState);
  });

  it('saves through a compact receipt with identical literal text, versions and legacy reads', async () => {
    await identity(creator);
    const page = await create();
    const text = '😀'.repeat(MAX_TEXT_BYTES / 4);
    const response = await database.query<{ receipt: Omit<TextDropPage, 'text'> }>('select public.textdrop_save_page_receipt($1::uuid,$2) as receipt', [page.id, text]);
    const receipt = response.rows[0]!.receipt;
    expect(Object.keys(receipt).sort()).toEqual(['code', 'id', 'name', 'updatedAt', 'version']);
    expect(receipt).toMatchObject({ id: page.id, code: page.code, version: 2 });
    expect(readPage({ ...receipt, text })).toEqual(await load(page.id));
    expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThan(256);
    expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThan(Buffer.byteLength(JSON.stringify({ ...receipt, text })) / 1000);
    const later = (await database.query<{ page: TextDropPage }>('select public.textdrop_save_page($1::uuid, $2) as page', [page.id, 'Legacy caller'])).rows[0]!.page;
    expect(later.version).toBe(3);
    expect((await database.query<{ page: TextDropPage }>('select public.textdrop_load_page($1::uuid) as page', [page.id])).rows[0]!.page).toEqual(later);
    const cleared = (await database.query<{ receipt: Omit<TextDropPage, 'text'> }>('select public.textdrop_save_page_receipt($1::uuid,$2) as receipt', [page.id, ''])).rows[0]!.receipt;
    expect(cleared.version).toBe(4);
    expect(await load(page.id)).toEqual({ ...cleared, text: '' });
  });

  it('rolls back an earlier receipt save when a later statement fails', async () => {
    await identity(creator);
    const page = await create();
    await database.exec('begin');
    await save(page.id, 'Rolled back');
    await expect(save(page.id, null)).rejects.toThrow('TEXTDROP_INVALID_TEXT');
    await database.exec('rollback');
    expect(await load(page.id)).toEqual(page);
  });

  it('adds and replays the receipt API without changing tables or the original save implementation', async () => {
    await database.exec('reset role');
    const original = (await database.query("select pg_get_functiondef('private.textdrop_save_page(uuid,text)'::regprocedure) as body")).rows;
    const initial = (await database.query("select pg_get_functiondef('public.textdrop_save_page_receipt(uuid,text)'::regprocedure) as body")).rows;
    const before = (await database.query('select id,code,version,updated_at from public.textdrop_pages order by id')).rows;
    await database.exec('drop function public.textdrop_save_page_receipt(uuid,text)');
    for (let run = 0; run < 2; run++) await database.exec(await readFile(receiptUpdate, 'utf8'));
    expect((await database.query("select pg_get_functiondef('public.textdrop_save_page_receipt(uuid,text)'::regprocedure) as body")).rows).toEqual(initial);
    expect((await database.query("select pg_get_functiondef('private.textdrop_save_page(uuid,text)'::regprocedure) as body")).rows).toEqual(original);
    expect((await database.query('select id,code,version,updated_at from public.textdrop_pages order by id')).rows).toEqual(before);
    expect(
      (
        await database.query(`select
      has_function_privilege('anon','public.textdrop_save_page_receipt(uuid,text)','execute') as anonymous,
      has_function_privilege('authenticated','public.textdrop_save_page_receipt(uuid,text)','execute') as signed_in,
      has_table_privilege('authenticated','public.textdrop_pages','select,insert,update,delete') as direct`)
      ).rows,
    ).toEqual([{ anonymous: false, signed_in: true, direct: false }]);
    expect(await siblings()).toEqual(siblingState);
  });
});
