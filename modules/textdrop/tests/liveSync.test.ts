import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { TextDropPage } from '../src/domain/snippets/model';
let database: PGlite;
const owner = randomUUID(),
  member = randomUUID(),
  stranger = randomUUID();
let page: TextDropPage;
beforeAll(async () => {
  database = new PGlite();
  await database.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create schema realtime;
    create table realtime.messages(extension text, topic text);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic',true) $$;
    create table realtime.captured(payload jsonb, event text, topic text, private boolean);
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ insert into realtime.captured values($1,$2,$3,$4) $$;`);
  await database.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  const live = await readFile(new URL('../supabase/update-live-sync.sql', import.meta.url), 'utf8');
  await database.exec(live);
  await database.exec(live);
  await database.query('insert into auth.users values($1),($2),($3)', [owner, member, stranger]);
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  page = (await database.query<{ page: TextDropPage }>('select public.textdrop_create_page($1::uuid) as page', [randomUUID()])).rows[0]!.page;
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [member]);
  await database.query('select public.textdrop_join_page($1)', [page.code]);
}, 30_000);
afterAll(async () => {
  await database?.close();
});
it('broadcasts only private identifiers to joined identities, without text or invitation codes', async () => {
  await database.exec('truncate realtime.captured');
  await database.query('select public.textdrop_save_checked($1::uuid,$2,$3,$4,$5::uuid)', [page.id, 'Confidential text', 1, createHash('sha256').update('').digest('hex'), randomUUID()]);
  const events = (await database.query<{ payload: unknown; topic: string; private: boolean; event: string }>('select * from realtime.captured order by topic')).rows;
  expect(events).toHaveLength(2);
  expect(events.map(event => event.topic).sort()).toEqual([`textdrop:user:${owner}`, `textdrop:user:${member}`].sort());
  for (const event of events) expect(event).toMatchObject({ private: true, event: 'changed', payload: { id: page.id, version: 2 } });
  expect(JSON.stringify(events)).not.toContain('Confidential');
  expect(JSON.stringify(events)).not.toContain(page.code);
});
it('authorizes only the caller’s own broadcast topic and cannot grant client publishing', async () => {
  await database.query('insert into realtime.messages values($1,$2),($1,$3),($4,$2)', ['broadcast', `textdrop:user:${member}`, `textdrop:user:${owner}`, 'presence']);
  await database.query("select set_config('test.topic',$1,false)", [`textdrop:user:${member}`]);
  await database.exec('set role authenticated');
  expect((await database.query('select * from realtime.messages')).rows).toEqual([{ extension: 'broadcast', topic: `textdrop:user:${member}` }]);
  await database.query("select set_config('test.topic',$1,false)", [`textdrop:user:${owner}`]);
  expect((await database.query('select * from realtime.messages')).rows).toEqual([]);
  await expect(database.exec("insert into realtime.messages values('broadcast','forbidden')")).rejects.toThrow('permission denied');
  await database.exec('reset role');
});
it('commits saves when notification delivery fails and emits no hints for rolled-back writes', async () => {
  await database.exec(`create or replace function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$ begin raise exception 'offline'; end $$`);
  await database.query('select public.textdrop_save_checked($1::uuid,$2,$3,$4,$5::uuid)', [
    page.id,
    'Saved despite realtime outage',
    2,
    createHash('sha256').update('Confidential text').digest('hex'),
    randomUUID(),
  ]);
  expect((await database.query<{ page: TextDropPage }>('select public.textdrop_poll_page($1::uuid,null) as page', [page.id])).rows[0]!.page.text).toBe('Saved despite realtime outage');
  await database.exec(
    `create or replace function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ insert into realtime.captured values($1,$2,$3,$4) $$; truncate realtime.captured;`,
  );
  await database.exec('begin');
  await database.query('select public.textdrop_save_checked($1::uuid,$2,$3,$4,$5::uuid)', [
    page.id,
    'Rolled back',
    3,
    createHash('sha256').update('Saved despite realtime outage').digest('hex'),
    randomUUID(),
  ]);
  await database.exec('rollback');
  expect((await database.query('select * from realtime.captured')).rows).toEqual([]);
});
