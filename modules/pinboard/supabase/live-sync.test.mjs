import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

let database;
const user = randomUUID();
const member = randomUUID();
const stranger = randomUUID();
const sql = await readFile(new URL('./update-live-sync.sql', import.meta.url), 'utf8');
before(async () => {
  database = new PGlite();
  await database.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  await database.query('insert into auth.users values($1),($2),($3)', [user, member, stranger]);
  await database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  // Isolated stand-in for existing Supabase-owned objects. The app migration may
  // add policies, but must never create/alter these objects in an installed project.
  await database.exec(`create schema realtime;
    create table realtime.messages(topic text, extension text, event text, payload jsonb, private boolean);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$
      select current_setting('realtime.topic',true) $$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void
      language sql as $$ insert into realtime.messages values($3,'broadcast',$2,$1,$4) $$;`);
  await database.exec(sql);
});
after(async () => database?.close());

test('live migration owns only app triggers/functions and a narrowly scoped receive policy', async () => {
  assert.doesNotMatch(
    sql,
    /(?:create\s+(?:table|schema)|alter\s+table|grant\s+\w+\s+on)\s+realtime[.\s]/i,
  );
  await database.exec('reset role');
  await database.exec(sql);
  const policy = await database.query(
    "select cmd,roles,qual from pg_policies where schemaname='realtime' and policyname='pinboard_receive_board_changes'",
  );
  assert.equal(policy.rows[0].cmd, 'SELECT');
  assert.deepEqual(policy.rows[0].roles, ['authenticated']);
  assert.match(policy.rows[0].qual, /extension.*broadcast/);
  assert.match(policy.rows[0].qual, /pinboard:user:/);
  assert.equal(
    (
      await database.query(
        "select has_table_privilege('authenticated','realtime.messages','INSERT') as allowed",
      )
    ).rows[0].allowed,
    false,
  );
});

test('broadcasts contain only changed board IDs/revisions on existing member topics', async () => {
  await database.exec('reset role; truncate realtime.messages');
  const id = randomUUID();
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  const board = (
    await database.query(
      "select public.pinboard_create_board($1,'Private board','Secret description') as board",
      [id],
    )
  ).rows[0].board;
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [member]);
  await database.query('select public.pinboard_join_board($1)', [board.invite_code]);
  await database.exec('truncate realtime.messages');
  const saved = (
    await database.query(
      'select public.pinboard_mutate_board_once($1,gen_random_uuid(),$2::jsonb,(select revision from public.pinboard_boards where id=$1)) as board',
      [id, JSON.stringify({ type: 'update_board', patch: { title: 'Changed privately' } })],
    )
  ).rows[0].board;
  const hints = (await database.query('select * from realtime.messages order by topic')).rows;
  assert.equal(hints.length, 2);
  assert.deepEqual(
    new Set(hints.map((row) => row.topic)),
    new Set([`pinboard:user:${user}`, `pinboard:user:${member}`]),
  );
  for (const hint of hints) {
    assert.deepEqual(hint.payload, { id, revision: saved.revision });
    assert.equal(hint.private, true);
    assert.equal(hint.event, 'board_changed');
  }
  for (const [identity, topic, expected] of [
    [user, `pinboard:user:${user}`, 1],
    [stranger, `pinboard:user:${user}`, 0],
    [user, `other:user:${user}`, 0],
  ]) {
    await database.query(
      "select set_config('request.jwt.claim.sub',$1,false), set_config('realtime.topic',$2,false)",
      [identity, topic],
    );
    await database.exec('set role authenticated');
    assert.equal((await database.query('select * from realtime.messages')).rows.length, expected);
    await assert.rejects(
      database.query("insert into realtime.messages values('x','broadcast','x','{}',true)"),
      /permission denied/,
    );
    await database.exec('reset role');
  }
});

test('moving multiple child rows notifies once per member and receipt replays do not notify', async () => {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  const id = randomUUID();
  const board = (
    await database.query("select public.pinboard_create_board($1,'Bulk rows','') board", [id])
  ).rows[0].board;
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [member]);
  await database.query('select public.pinboard_join_board($1)', [board.invite_code]);
  for (let n = 0; n < 4; n++) {
    await database.query(
      'select public.pinboard_mutate_board_once($1,gen_random_uuid(),$2::jsonb,(select revision from public.pinboard_boards where id=$1))',
      [
        id,
        JSON.stringify({
          type: 'create_card',
          card: {
            id: randomUUID(),
            title: `Row ${n}`,
            description: '',
            columnId: 'doing',
            position: n,
            priority: 'medium',
            assignee: '',
            dueDate: '',
            labels: [],
            archived: n % 2 === 0,
          },
        }),
      ],
    );
  }
  await database.exec('truncate realtime.messages');
  const token = randomUUID();
  const operation = JSON.stringify({ type: 'delete_column', id: 'doing', targetColumnId: 'todo' });
  const result = (
    await database.query('select public.pinboard_mutate_board_once($1,$2,$3::jsonb,1) board', [
      id,
      token,
      operation,
    ])
  ).rows[0].board;
  assert.equal(result.cards.filter((card) => card.columnId === 'todo').length, 4);
  const hints = (await database.query('select * from realtime.messages')).rows;
  assert.equal(hints.length, 2);
  assert.ok(hints.every((hint) => hint.payload.revision === result.revision));
  await database.exec('truncate realtime.messages');
  assert.deepEqual(
    (
      await database.query('select public.pinboard_mutate_board_once($1,$2,$3::jsonb,1) board', [
        id,
        token,
        operation,
      ])
    ).rows[0].board,
    result,
  );
  assert.equal((await database.query('select * from realtime.messages')).rows.length, 0);
});

test('failed notifications do not fail a durable mutation or membership join', async () => {
  await database.exec(`reset role; create or replace function realtime.send(payload jsonb,event text,topic text,private boolean)
    returns void language plpgsql as $$ begin raise exception 'stand-in delivery failed'; end $$;`);
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  const id = randomUUID();
  const board = (
    await database.query("select public.pinboard_create_board($1,'Still saved','') as board", [id])
  ).rows[0].board;
  const saved = (
    await database.query(
      'select public.pinboard_mutate_board_once($1,gen_random_uuid(),$2::jsonb,(select revision from public.pinboard_boards where id=$1)) as board',
      [
        id,
        JSON.stringify({
          type: 'update_board',
          patch: { title: 'Notification failed, data saved' },
        }),
      ],
    )
  ).rows[0].board;
  assert.equal(saved.title, 'Notification failed, data saved');
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [member]);
  assert.equal(
    (await database.query('select public.pinboard_join_board($1) as board', [board.invite_code]))
      .rows[0].board.id,
    id,
  );
});
