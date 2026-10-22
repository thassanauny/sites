import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const forward = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
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
  return (
    await db.query('select public.pinboard_mutate_board_once($1,$3,$2::jsonb,$4) board', [
      id,
      JSON.stringify(operation),
      token ?? randomUUID(),
      base ??
        (
          await db.query('select revision from public.pinboard_boards where id=$1', [id])
        ).rows[0]?.revision ??
        null,
    ])
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

const content = ({ title, description, columns, cards, card_fields }) => ({
  title,
  description,
  columns,
  cards,
  ...(card_fields ? { card_fields } : {}),
});

test('board copies are complete, private, atomic and idempotent after a lost reply', async (t) => {
  const db = await setup(forward);
  t.after(() => db.close());
  let source = await create(db);
  source = await mutate(db, source.id, {
    type: 'update_board',
    patch: {
      card_fields: {
        hidden: ['dueDate'],
        custom: [{ id: fieldId, title: 'Estimate', hidden: false }],
        assignees: ['Alex'],
      },
    },
  });
  source = await mutate(db, source.id, {
    type: 'create_card',
    card: card({ assignee: 'Alex', customFields: { [fieldId]: 'Large' } }),
  });
  source = await mutate(db, source.id, { type: 'create_card', card: card({ archived: true }) });
  const snapshot = { ...content(source), title: 'Recovered project (copy)' },
    id = randomUUID();
  const copy = async (target = id, value = snapshot) =>
    (
      await db.query('select public.pinboard_copy_board($1,$2::jsonb) board', [
        target,
        JSON.stringify(value),
      ])
    ).rows[0].board;
  let copied = await copy();
  assert.deepEqual(content(copied), snapshot);
  assert.notEqual(copied.invite_code, source.invite_code);
  assert.equal(copied.id, id);
  assert.deepEqual(await document(db, source.id), source);
  await actor(db, creator);
  assert.deepEqual(
    (
      await db.query('select user_id from public.pinboard_board_access where board_id=$1', [id])
    ).rows.map((row) => row.user_id),
    [creator],
  );
  copied = await mutate(db, id, {
    type: 'update_card',
    id: copied.cards[0].id,
    patch: { description: 'Edited after the first copy was committed' },
  });
  assert.deepEqual(await copy(), copied);
  await db.exec('reset role');
  assert.equal(
    (await db.query('select count(*)::int total from public.pinboard_boards')).rows[0].total,
    2,
  );
  const counts = (
    await db.query(
      'select card_count,active_card_count,column_count,deleted_column_ids from public.pinboard_boards where id=$1',
      [id],
    )
  ).rows[0];
  assert.deepEqual(counts, {
    card_count: 2,
    active_card_count: 1,
    column_count: 3,
    deleted_column_ids: [],
  });
  await actor(db, stranger);
  await assert.rejects(copy(), /PINBOARD_INVALID_BOARD/);
  await assert.rejects(
    db.query('select private.pinboard_replace_snapshot($1,$2::jsonb)', [
      id,
      JSON.stringify(snapshot),
    ]),
    /permission denied/,
  );
  await actor(db, creator);
  const invalid = randomUUID();
  await assert.rejects(
    copy(invalid, { ...snapshot, cards: [card({ columnId: 'missing' })] }),
    /PINBOARD_INVALID_BOARD/,
  );
  await assert.rejects(copy(invalid, { ...snapshot, title: undefined }), /PINBOARD_INVALID_BOARD/);
  await db.exec('reset role');
  assert.equal(
    (
      await db.query('select count(*)::int total from public.pinboard_boards where id=$1', [
        invalid,
      ])
    ).rows[0].total,
    0,
  );
});

test('force sync is checked, atomic and receipt-protected without replaying over later shared changes', async (t) => {
  const db = await setup(forward);
  t.after(() => db.close());
  let board = await create(db);
  const restored = card(),
    removed = card();
  board = await mutate(db, board.id, { type: 'create_card', card: restored });
  const local = content(board);
  board = await mutate(db, board.id, { type: 'delete_card', id: restored.id });
  board = await mutate(db, board.id, { type: 'create_card', card: removed });
  const token = randomUUID(),
    base = board.revision;
  const force = async (value = local, receipt = token) =>
    (
      await db.query('select public.pinboard_force_board_once($1,$2,$3::jsonb,$4) board', [
        board.id,
        receipt,
        JSON.stringify(value),
        base,
      ])
    ).rows[0].board;
  await actor(db, stranger);
  await assert.rejects(force(), /PINBOARD_ACCESS_DENIED/);
  await actor(db, creator);
  const before = await document(db, board.id);
  await actor(db, creator);
  await assert.rejects(
    force({ ...local, cards: [card({ columnId: 'missing' })] }),
    /PINBOARD_INVALID_BOARD/,
  );
  assert.deepEqual(await document(db, board.id), before);
  await actor(db, creator);
  const saved = await force();
  assert.deepEqual(content(saved), local);
  board = await mutate(db, board.id, { type: 'create_card', card: removed });
  assert.deepEqual(board.cards, [restored]); // A stale queued creation cannot undo the explicit removal.
  board = await mutate(db, board.id, {
    type: 'update_card',
    id: restored.id,
    patch: { description: 'Saved later by a collaborator' },
  });
  assert.deepEqual(await force(), board);
  await assert.rejects(
    force({ ...local, description: 'Different replay payload' }),
    /PINBOARD_INVALID_OPERATION/,
  );
  await db.exec('reset role');
  assert.equal(
    (
      await db.query(
        'select count(*)::int total from private.pinboard_operation_receipts where board_id=$1 and operation_id=$2',
        [board.id, token],
      )
    ).rows[0].total,
    1,
  );
  const counts = (
    await db.query(
      'select card_count,active_card_count,column_count from public.pinboard_boards where id=$1',
      [board.id],
    )
  ).rows[0];
  assert.deepEqual(counts, { card_count: 1, active_card_count: 1, column_count: 3 });
});

test('refresh preserves current card counts and initializes future boards without changing saved work', async (t) => {
  const db = await setup(forward);
  t.after(() => db.close());
  let board = await create(db);
  const value = card();
  board = await mutate(db, board.id, { type: 'create_card', card: value });
  board = await mutate(db, board.id, {
    type: 'move_card',
    id: value.id,
    columnId: 'doing',
    position: 1024,
  });
  board = await mutate(db, board.id, { type: 'create_card', card: card({ archived: true }) });
  await db.exec('reset role');
  const snapshot = async () => ({
    board: await document(db, board.id),
    access: (
      await db.query(
        'select * from public.pinboard_board_access where board_id=$1 order by user_id',
        [board.id],
      )
    ).rows,
    receipts: (
      await db.query(
        'select * from private.pinboard_operation_receipts where board_id=$1 order by operation_id',
        [board.id],
      )
    ).rows,
  });
  const before = await snapshot();
  assert.equal(
    (await db.query('select active_card_count from public.pinboard_boards where id=$1', [board.id]))
      .rows[0].active_card_count,
    1,
  );
  await db.exec(forward);
  assert.deepEqual(await snapshot(), before);
  const column = (
    await db.query(`select is_nullable,column_default from information_schema.columns
    where table_schema='public' and table_name='pinboard_boards' and column_name='active_card_count'`)
  ).rows[0];
  assert.equal(column.is_nullable, 'NO');
  assert.equal(column.column_default, '0');
  await actor(db, creator);
  const summaries = (await db.query("select public.pinboard_sync_summaries('{}') result")).rows[0]
    .result;
  assert.equal(summaries.boards.find((item) => item.id === board.id).active_card_count, 1);
  const next = await create(db);
  assert.equal(
    (
      await db.query('select active_card_count from public.pinboard_board_summaries where id=$1', [
        next.id,
      ])
    ).rows[0].active_card_count,
    0,
  );
  await mutate(db, next.id, { type: 'create_card', card: card() });
  assert.equal(
    (
      await db.query('select active_card_count from public.pinboard_board_summaries where id=$1', [
        next.id,
      ])
    ).rows[0].active_card_count,
    1,
  );
  await db.exec('reset role');
  await db.exec(forward);
  assert.deepEqual(await snapshot(), before);
});

test('refresh preserves current rows, invitations and receipts with only checked APIs', async (t) => {
  const db = await setup(forward);
  t.after(() => db.close());
  let board = await create(db);
  const value = card({ archived: false, customFields: {} });
  board = await mutate(db, board.id, { type: 'create_card', card: value });
  const token = randomUUID();
  const operation = { type: 'update_card', id: value.id, patch: { title: 'Accepted once' } };
  board = await mutate(db, board.id, operation, token, board.revision);
  await actor(db, member);
  await db.query('select public.pinboard_join_board($1)', [board.invite_code]);
  board = await mutate(db, board.id, {
    type: 'update_card',
    id: value.id,
    patch: { title: 'Later shared title' },
  });
  await db.exec('reset role');
  const receipts = (
    await db.query('select * from private.pinboard_operation_receipts order by receipt_id')
  ).rows;
  const access = (await db.query('select * from public.pinboard_board_access order by user_id'))
    .rows;
  await db.exec(forward);
  await db.exec(forward);
  assert.deepEqual(await document(db, board.id), board);
  assert.deepEqual(
    (await db.query('select * from private.pinboard_operation_receipts order by receipt_id')).rows,
    receipts,
  );
  assert.deepEqual(
    (await db.query('select * from public.pinboard_board_access order by user_id')).rows,
    access,
  );
  assert.deepEqual(
    (
      await db.query(`select to_regprocedure('public.pinboard_mutate_board(uuid,jsonb)') public_old,
    to_regprocedure('private.pinboard_mutate_board(uuid,jsonb)') private_old,
    to_regclass('private.pinboard_row_storage_audit') audit`)
    ).rows[0],
    { public_old: null, private_old: null, audit: null },
  );
  await actor(db, creator);
  assert.deepEqual(
    await mutate(db, board.id, operation, token, 1),
    board,
    'refresh never replays a previously accepted patch',
  );
  await assert.rejects(
    db.query('select private.pinboard_apply_operation($1,$2::jsonb)', [
      board.id,
      JSON.stringify(operation),
    ]),
    /permission denied/,
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
  await db.exec(forward);
  assert.deepEqual(await document(db, board.id), board);
});

test('compact mutations avoid whole-board construction and safely reconcile stale caches and retries', async (t) => {
  const db = await setup(forward);
  t.after(() => db.close());
  let board = await create(db);
  const cards = Array.from({ length: 100 }, () => card({ description: 'x'.repeat(200) }));
  for (const value of cards)
    board = await mutate(db, board.id, { type: 'create_card', card: value });
  const baseline = board.revision;
  const token = randomUUID();
  const operation = {
    type: 'update_card',
    id: cards[0].id,
    patch: { title: 'Compact accepted edit' },
  };
  const save = async (op, receipt, known) =>
    (
      await db.query('select public.pinboard_mutate_board_receipt($1,$2,$3::jsonb,$4,$5) reply', [
        board.id,
        receipt,
        JSON.stringify(op),
        baseline,
        known,
      ])
    ).rows[0].reply;
  await db.exec('reset role');
  const definition = (
    await db.query(
      "select pg_get_functiondef('private.pinboard_board_json(public.pinboard_boards)'::regprocedure) definition",
    )
  ).rows[0].definition;
  // A compact save must not assemble full JSON and then discard most of it.
  await db.exec(`create or replace function private.pinboard_board_json(p_board public.pinboard_boards)
    returns jsonb language plpgsql stable security invoker set search_path='' as $$
    begin raise exception 'FULL_BOARD_BUILDER_CALLED'; end; $$;`);
  await actor(db, creator);
  const reply = await save(operation, token, baseline);
  assert.equal(reply.format, 1);
  assert.equal(reply.baseRevision, baseline);
  assert.equal(reply.board.revision, baseline + 1);
  assert.deepEqual(reply.removedCardIds, [cards[0].id]);
  assert.equal(reply.cards.length, 1);
  assert.equal(reply.cards[0].title, 'Compact accepted edit');
  assert.equal('cards' in reply.board, false);
  assert.ok(
    Buffer.byteLength(JSON.stringify(reply)) < Buffer.byteLength(JSON.stringify(board)) / 20,
  );
  const deletion = await save({ type: 'delete_card', id: cards[1].id }, randomUUID(), baseline + 1);
  assert.deepEqual(deletion.cards, []);
  assert.deepEqual(deletion.removedCardIds, [cards[1].id]);
  await db.exec('reset role');
  await db.exec(definition);
  await actor(db, creator);
  // Lost-response replay returns CURRENT state, retaining later collaborator edits.
  board = await mutate(db, board.id, {
    type: 'update_card',
    id: cards[0].id,
    patch: { title: 'Later shared edit' },
  });
  const replay = await save(operation, token, baseline);
  assert.equal(replay.format, undefined);
  assert.equal(replay.cards.find((c) => c.id === cards[0].id).title, 'Later shared edit');
  const stale = await save(
    { type: 'update_board', patch: { description: 'Independent edit' } },
    randomUUID(),
    baseline,
  );
  assert.equal(stale.format, undefined);
  assert.equal(stale.cards.length, 99);
  await actor(db, stranger);
  await assert.rejects(save(operation, randomUUID(), baseline), /PINBOARD_ACCESS_DENIED/);
});
