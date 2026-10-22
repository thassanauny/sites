import { createHash, randomUUID } from 'node:crypto';
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
  const load = () => rpc('public.textdrop_poll_page($1,null)', [id]);
  const save = async (text: string) => {
    const base = await load();
    return rpc('public.textdrop_save_checked($1,$2,$3,$4,$5)', [id, text, base.version, createHash('sha256').update(String(base.text)).digest('hex'), randomUUID()]);
  };
  // A differing cached hash requests the full current text for these contract assertions.
  const rename = (name: string) => rpc('public.textdrop_rename_checked($1,$2,$3)', [id, name, '0'.repeat(64)]);
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    await db.query('insert into auth.users values ($1),($2),($3)', [first, second, stranger]);
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    await as(first);
    const page = await rpc('public.textdrop_create_page($1)', [id]);
    expect(page.name).toBeNull();
    await save('Keep exact shared text');
    await as(second);
    await rpc('public.textdrop_join_page($1)', [page.code]);
    const renamed = await rename('Travel notes');
    expect(renamed).toMatchObject({ name: 'Travel notes', text: 'Keep exact shared text', version: 3 });
    expect(await rename('Travel notes')).toEqual(renamed);
    expect(await rpc('public.textdrop_poll_page($1,$2)', [id, 2])).toMatchObject({ name: 'Travel notes', version: 3 });
    const polled = await rpc('public.textdrop_poll_page($1,$2)', [id, 2]);
    expect(polled.name).toBe('Travel notes');
    await save('Current text edit');
    expect(await rpc('public.textdrop_poll_page($1,null)', [id])).toMatchObject({ name: 'Travel notes', text: 'Current text edit' });
    const cleared = await rename('');
    expect(cleared.name).toBeNull();
    expect(cleared.text).toBe('Current text edit');
    await expect(rename('x'.repeat(81))).rejects.toThrow('TEXTDROP_INVALID_NAME');
    await expect(rename('bad\nname')).rejects.toThrow('TEXTDROP_INVALID_NAME');
    expect(await rpc('public.textdrop_poll_page($1,$2)', [id, cleared.version])).toEqual({ id, version: cleared.version, unchanged: true });
    await as(stranger);
    await expect(rename('No access')).rejects.toThrow('TEXTDROP_ACCESS_DENIED');
    expect(await rpc('public.textdrop_names($1)', [[page.code]])).toEqual([]);
    await db.exec('reset role');
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    await as(first);
    expect(await rpc('public.textdrop_names($1)', [[page.code]])).toEqual([{ code: page.code, name: null, version: cleared.version }]);
    await db.exec('reset role;set role anon');
    await expect(rpc('public.textdrop_names($1)', [[page.code]])).rejects.toThrow('permission denied');
  } finally {
    await db.close();
  }
}, 30000);
