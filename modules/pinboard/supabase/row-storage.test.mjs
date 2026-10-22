import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const forward = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('./rollback-row-storage.sql', import.meta.url), 'utf8');
const creator = randomUUID();
const member = randomUUID();
const stranger = randomUUID();
const fieldId = randomUUID();
async function setup(sql) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.query('insert into auth.users values($1),($2),($3)', [creator, member, stranger]);
  await db.exec(sql);
  return db;
}
async function actor(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function create(db) {
  await actor(db, creator);
  return (
    await db.query("select public.pinboard_create_board($1,'Rows preserve work','') board", [
      randomUUID(),
    ])
  ).rows[0].board;
}
async function mutate(db, id, operation, token, base) {
  const call = token
    ? 'public.pinboard_mutate_board_once($1,$3,$2::jsonb,$4)'
    : 'public.pinboard_mutate_board($1,$2::jsonb)';
  return (
    await db.query(
      `select ${call} board`,
      token ? [id, JSON.stringify(operation), token, base] : [id, JSON.stringify(operation)],
    )
  ).rows[0].board;
}
async function document(db, id) {
  await db.exec('reset role');
  return (
    await db.query(
      'select private.pinboard_board_json(b) board from public.pinboard_boards b where id=$1',
      [id],
    )
  ).rows[0].board;
}
const card = (overrides = {}) => ({
  id: randomUUID(),
  title: 'Keep 😀 exactly',
  description: '',
  columnId: 'todo',
  position: 1.25,
  priority: 'medium',
  assignee: '',
  dueDate: '',
  labels: [],
  ...overrides,
});

test('upgrades losslessly, replays without overwriting rows, and rolls back latest accepted rows and receipts', async (t) => {
  const db = await setup(rollback);
  t.after(() => db.close());
  let board = await create(db);
  board = await mutate(db, board.id, {
    type: 'update_board',
    patch: {
      card_fields: { hidden: [], custom: [{ id: fieldId, title: 'Custom', hidden: false }] },
    },
  });
  const cards = [
    card({ customFields: {} }),
    card({ archived: true }),
    card({ archived: false, position: 0, customFields: { [fieldId]: '' } }),
  ];
  for (const value of cards)
    board = await mutate(db, board.id, { type: 'create_card', card: value });
  const gone = card();
  await mutate(db, board.id, { type: 'create_card', card: gone });
  board = await mutate(db, board.id, { type: 'delete_card', id: gone.id });
  const token = randomUUID();
  const operation = {
    type: 'update_card',
    id: cards[0].id,
    patch: { description: 'Accepted before migration' },
  };
  board = await mutate(db, board.id, operation, token, board.revision);
  await actor(db, member);
  await db.query('select public.pinboard_join_board($1)', [board.invite_code]);
  board = await mutate(db, board.id, {
    type: 'update_card',
    id: cards[0].id,
    patch: { description: 'Later collaborator edit' },
  });
  await db.exec('reset role');
  const receipt = (await db.query('select * from private.pinboard_operation_receipts')).rows;
  const access = (await db.query('select * from public.pinboard_board_access order by user_id'))
    .rows;
  await db.exec(forward);
  assert.deepEqual(await document(db, board.id), board);
  const audit = (await db.query('select * from private.pinboard_row_storage_audit')).rows;
  assert.equal(audit[0].source_revision, board.revision);
  assert.deepEqual(audit[0].source_hash, audit[0].reconstructed_hash);
  assert.equal(audit[0].card_count, 3);
  assert.equal(audit[0].active_card_count, 2);
  assert.deepEqual(
    (await db.query('select * from private.pinboard_operation_receipts')).rows,
    receipt,
  );
  assert.deepEqual(
    (await db.query('select * from public.pinboard_board_access order by user_id')).rows,
    access,
  );
  assert.equal(
    (
      await db.query(
        "select count(*) n from pg_attribute where attrelid='public.pinboard_boards'::regclass and attname in ('cards','columns') and not attisdropped",
      )
    ).rows[0].n,
    0,
  );
  await actor(db, creator);
  assert.deepEqual(
    await mutate(db, board.id, operation, token, 1),
    board,
    'pre-migration receipt does not replay an old patch',
  );
  board = await mutate(db, board.id, {
    type: 'update_card',
    id: cards[1].id,
    patch: { archived: false },
  });
  board = await mutate(db, board.id, { type: 'delete_card', id: cards[2].id });
  board = await mutate(db, board.id, {
    type: 'create_card',
    card: card({ archived: true, description: 'Accepted after cutover' }),
  });
  const latestToken = randomUUID();
  const latestOperation = {
    type: 'update_column',
    id: 'todo',
    patch: { title: 'Post-migration title' },
  };
  board = await mutate(db, board.id, latestOperation, latestToken, board.revision);
  await db.exec('reset role');
  await db.exec(forward);
  await db.exec(forward);
  assert.deepEqual(await document(db, board.id), board);
  assert.deepEqual(
    (await db.query('select * from private.pinboard_row_storage_audit')).rows,
    audit,
  );
  const latestReceipts = (
    await db.query('select * from private.pinboard_operation_receipts order by receipt_id')
  ).rows;
  await db.exec(rollback);
  assert.deepEqual(
    await document(db, board.id),
    board,
    'rollback uses latest rows including post-cutover changes',
  );
  assert.equal(
    (await db.query("select to_regclass('public.pinboard_cards') relation")).rows[0].relation,
    null,
  );
  assert.deepEqual(
    (await db.query('select * from private.pinboard_operation_receipts order by receipt_id')).rows,
    latestReceipts,
  );
  await actor(db, creator);
  assert.deepEqual(await mutate(db, board.id, latestOperation, latestToken, 1), board);
  assert.equal(
    (await mutate(db, board.id, { type: 'create_card', card: gone })).cards.some(
      (c) => c.id === gone.id,
    ),
    false,
  );
  await db.exec('reset role');
  await db.exec(rollback);
  assert.deepEqual(await document(db, board.id), board);
  await db.exec(forward);
  assert.deepEqual(await document(db, board.id), board, 'forward is safe after rollback too');
});

test('upgrades older JSON installations without a stored count and aborts malformed historical data atomically', async (t) => {
  const db = await setup(rollback);
  t.after(() => db.close());
  let board = await create(db);
  board = await mutate(db, board.id, { type: 'create_card', card: card() });
  await db.exec(
    'reset role; drop view public.pinboard_board_summaries; alter table public.pinboard_boards drop column active_card_count',
  );
  await db.exec(forward);
  assert.deepEqual(await document(db, board.id), board);
  assert.equal(
    (await db.query('select active_card_count from public.pinboard_boards')).rows[0]
      .active_card_count,
    1,
  );
  await db.exec(rollback);
  await db.exec(`do $$ declare c text; begin
    for c in select conname from pg_constraint where conrelid='public.pinboard_boards'::regclass and contype='c' and pg_get_constraintdef(oid) like '%pinboard_valid_state%'
    loop execute format('alter table public.pinboard_boards drop constraint %I',c); end loop;
  end $$;`);
  const invalid = [{ ...board.cards[0], title: null }];
  await db.query('update public.pinboard_boards set cards=$1::jsonb where id=$2', [
    JSON.stringify(invalid),
    board.id,
  ]);
  await assert.rejects(db.exec(forward), /PINBOARD_ROW_BACKFILL_INVALID/);
  await db.exec('rollback');
  assert.deepEqual(
    (await db.query('select cards from public.pinboard_boards where id=$1', [board.id])).rows[0]
      .cards,
    invalid,
  );
  assert.equal(
    (await db.query("select to_regclass('public.pinboard_cards') relation")).rows[0].relation,
    null,
  );
});

test('ordinary edits validate one entity, retain untouched tuples and enforce parent membership on every row', async (t) => {
  const db = await setup(forward);
  t.after(() => db.close());
  let board = await create(db);
  for (let n = 0; n < 30; n++)
    board = await mutate(db, board.id, { type: 'create_card', card: card({ position: n / 2 }) });
  await db.exec('reset role');
  const tupleSnapshot = async (table) =>
    (
      await db.query(
        `select id,ctid::text tuple,data from public.${table} where board_id=$1 order by id`,
        [board.id],
      )
    ).rows;
  const beforeCards = await tupleSnapshot('pinboard_cards');
  const beforeColumns = await tupleSnapshot('pinboard_columns');
  const definition = (
    await db.query(
      "select pg_get_functiondef('private.pinboard_valid_state(jsonb,jsonb)'::regprocedure) definition",
    )
  ).rows[0].definition;
  await db.exec(
    definition.replace(
      'private.pinboard_valid_state(',
      'private.pinboard_valid_state_unbounded_fixture(',
    ),
  );
  await db.exec(`create or replace function private.pinboard_valid_state(p_columns jsonb,p_cards jsonb)
    returns boolean language plpgsql immutable security invoker set search_path='' as $$ begin
      if jsonb_array_length(p_columns)>1 or jsonb_array_length(p_cards)>1 then raise exception 'FULL_BOARD_VALIDATION_CALLED'; end if;
      return private.pinboard_valid_state_unbounded_fixture(p_columns,p_cards);
    end $$;`);
  await actor(db, creator);
  const target = board.cards[11].id;
  const revision = board.revision;
  board = await mutate(
    db,
    board.id,
    {
      type: 'update_card',
      id: target,
      patch: { description: 'Touched row only 😀', archived: true },
    },
    randomUUID(),
    revision,
  );
  assert.equal(board.revision, revision + 1);
  await db.exec('reset role');
  const afterCards = await tupleSnapshot('pinboard_cards');
  assert.deepEqual(
    afterCards.filter((c) => c.id !== target),
    beforeCards.filter((c) => c.id !== target),
  );
  assert.notEqual(
    afterCards.find((c) => c.id === target).tuple,
    beforeCards.find((c) => c.id === target).tuple,
  );
  assert.deepEqual(await tupleSnapshot('pinboard_columns'), beforeColumns);
  const counters = (
    await db.query(
      'select card_count,active_card_count,content_bytes from public.pinboard_boards where id=$1',
      [board.id],
    )
  ).rows[0];
  assert.equal(counters.card_count, 30);
  assert.equal(counters.active_card_count, 29);
  const size = (
    await db.query(
      `select octet_length(columns::text)+octet_length(cards::text)+octet_length(coalesce(card_fields,'null'::jsonb)::text) bytes from public.pinboard_board_documents where id=$1`,
      [board.id],
    )
  ).rows[0].bytes;
  assert.equal(counters.content_bytes, size);
  await actor(db, creator);
  board = await mutate(db, board.id, {
    type: 'update_column',
    id: 'todo',
    patch: { title: 'Only this column' },
  });
  await db.exec('reset role');
  assert.deepEqual(await tupleSnapshot('pinboard_cards'), afterCards);
  const afterColumns = await tupleSnapshot('pinboard_columns');
  assert.deepEqual(
    afterColumns.filter((c) => c.id !== 'todo'),
    beforeColumns.filter((c) => c.id !== 'todo'),
  );
  await actor(db, stranger);
  for (const table of [
    'pinboard_boards',
    'pinboard_columns',
    'pinboard_cards',
    'pinboard_board_documents',
  ]) {
    assert.equal((await db.query(`select id from public.${table}`)).rows.length, 0, table);
    await assert.rejects(db.query(`delete from public.${table}`), /permission denied/);
  }
  await assert.rejects(
    mutate(db, board.id, { type: 'delete_card', id: target }),
    /PINBOARD_ACCESS_DENIED/,
  );
});

test('bulk operations, archives and removals retain exact incremental counts and JSON byte budgets', async (t) => {
  const db = await setup(forward);
  t.after(() => db.close());
  let board = await create(db);
  const first = card({ assignee: '😀 teammate', description: 'One\nline', columnId: 'doing' });
  const archived = card({ assignee: '😀 teammate', archived: true, columnId: 'doing' });
  const other = card({ columnId: 'todo', position: 1000000000000 });
  const operations = [
    { type: 'create_card', card: first },
    { type: 'create_card', card: archived },
    { type: 'create_card', card: other },
    { type: 'add_assignee', name: 'Another' },
    { type: 'delete_assignee', name: '😀 teammate' },
    { type: 'reorder_columns', columnIds: ['doing', 'done', 'todo'] },
    { type: 'delete_column', id: 'doing', targetColumnId: 'todo' },
    { type: 'update_card', id: archived.id, patch: { archived: false } },
    { type: 'move_card', id: first.id, columnId: 'done', position: 0.125 },
    {
      type: 'update_board',
      patch: {
        card_fields: {
          hidden: ['description'],
          custom: [{ id: fieldId, title: 'Extra 😀', hidden: false }],
        },
      },
    },
    { type: 'update_card', id: first.id, patch: { customFields: { [fieldId]: 'Exact 😀 value' } } },
    { type: 'delete_card', id: other.id },
    { type: 'delete_card', id: first.id },
    { type: 'delete_card', id: archived.id },
  ];
  for (const operation of operations) {
    await actor(db, creator);
    board = await mutate(db, board.id, operation);
    await db.exec('reset role');
    const counts = (
      await db.query(
        `select b.card_count,b.column_count,b.active_card_count,b.content_bytes,
      jsonb_array_length(d.cards) actual_cards,jsonb_array_length(d.columns) actual_columns,
      (select count(*) from jsonb_array_elements(d.cards) c where not coalesce((c->>'archived')::boolean,false)) actual_active,
      octet_length(d.columns::text)+octet_length(d.cards::text)+octet_length(coalesce(d.card_fields,'null'::jsonb)::text) actual_bytes
      from public.pinboard_boards b join public.pinboard_board_documents d using(id) where b.id=$1`,
        [board.id],
      )
    ).rows[0];
    assert.equal(counts.card_count, counts.actual_cards, operation.type);
    assert.equal(counts.column_count, counts.actual_columns, operation.type);
    assert.equal(counts.active_card_count, counts.actual_active, operation.type);
    assert.equal(counts.content_bytes, counts.actual_bytes, operation.type);
  }
  await db.exec(rollback);
  assert.deepEqual(await document(db, board.id), board);
});
