import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('shares optional names without changing text, access, or replay safety', async () => {
  const db = new PGlite();
  const first = randomUUID(),
    second = randomUUID(),
    stranger = randomUUID(),
    id = randomUUID();
  const as = async (who: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
    await db.exec('set role authenticated');
  };
  const rpc = async (sql: string, args: unknown[] = []) => (await db.query<{ result: Record<string, unknown> }>(`select ${sql} as result`, args)).rows[0]!.result;
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    await db.query('insert into auth.users values ($1),($2),($3)', [first, second, stranger]);
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    await as(first);
    const page = await rpc('public.textdrop_create_page($1)', [id]);
    expect(page.name).toBeNull();
    await rpc('public.textdrop_save_page_receipt($1,$2)', [id, 'Keep exact shared text']);
    await as(second);
    await rpc('public.textdrop_join_page($1)', [page.code]);
    const renamed = await rpc('public.textdrop_rename_page($1,$2)', [id, 'Travel notes']);
    expect(renamed).toMatchObject({ name: 'Travel notes', text: 'Keep exact shared text', version: 3 });
    expect(await rpc('public.textdrop_rename_page($1,$2)', [id, 'Travel notes'])).toEqual(renamed);
    expect(await rpc('public.textdrop_poll_page($1,$2)', [id, 2])).toMatchObject({ name: 'Travel notes', version: 3 });
    const legacy = await rpc('public.textdrop_poll_page($1,$2)', [id, 2]);
    expect(legacy.name).toBe('Travel notes');
    await rpc('public.textdrop_save_page_receipt($1,$2)', [id, 'Legacy text edit']);
    expect(await rpc('public.textdrop_poll_page($1,null)', [id])).toMatchObject({ name: 'Travel notes', text: 'Legacy text edit' });
    const cleared = await rpc('public.textdrop_rename_page($1,$2)', [id, '']);
    expect(cleared.name).toBeNull();
    expect(cleared.text).toBe('Legacy text edit');
    await expect(rpc('public.textdrop_rename_page($1,$2)', [id, 'x'.repeat(81)])).rejects.toThrow('TEXTDROP_INVALID_NAME');
    await expect(rpc('public.textdrop_rename_page($1,$2)', [id, 'bad\nname'])).rejects.toThrow('TEXTDROP_INVALID_NAME');
    expect(await rpc('public.textdrop_poll_page($1,$2)', [id, cleared.version])).toEqual({ id, version: cleared.version, unchanged: true });
    await as(stranger);
    await expect(rpc('public.textdrop_rename_page($1,$2)', [id, 'No access'])).rejects.toThrow('TEXTDROP_ACCESS_DENIED');
    expect(await rpc('public.textdrop_names($1)', [[page.code]])).toEqual([]);
    await db.exec('reset role');
    await db.exec(await readFile(new URL('../supabase/update-shared-names.sql', import.meta.url), 'utf8'));
    await as(first);
    expect(await rpc('public.textdrop_names($1)', [[page.code]])).toEqual([{ code: page.code, name: null, version: cleared.version }]);
    await db.exec('reset role;set role anon');
    await expect(rpc('public.textdrop_names($1)', [[page.code]])).rejects.toThrow('permission denied');
  } finally {
    await db.close();
  }
}, 30000);
