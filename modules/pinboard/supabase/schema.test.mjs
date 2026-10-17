import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const creator = randomUUID();
const collaborator = randomUUID();
const stranger = randomUUID();
let database;
let iouBefore;

async function identity(user, role = 'authenticated') {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await database.exec(`set role ${role}`);
}

async function createBoard(title = 'Project board') {
  const id = randomUUID();
  const result = await database.query(
    'select public.pinboard_create_board($1::uuid, $2, $3) as board',
    [id, title, 'Shared work'],
  );
  return result.rows[0].board;
}

async function mutate(boardId, operation) {
  const result = await database.query(
    'select public.pinboard_mutate_board($1::uuid, $2::jsonb) as board',
    [boardId, JSON.stringify(operation)],
  );
  return result.rows[0].board;
}

async function join(code) {
  const result = await database.query('select public.pinboard_join_board($1) as board', [code]);
  return result.rows[0].board;
}

function card(overrides = {}) {
  return {
    id: randomUUID(),
    title: 'Write the release note',
    description: '',
    columnId: 'todo',
    position: 1000,
    priority: 'medium',
    assignee: '',
    dueDate: '',
    labels: [],
    ...overrides,
  };
}

describe('Supabase schema in actual embedded PostgreSQL', {
  concurrency: false,
}, () => {
  before(async () => {
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
    `);
    await database.query('insert into auth.users (id) values ($1), ($2), ($3)', [
      creator,
      collaborator,
      stranger,
    ]);
    // Represent an initialized sibling app without making this standalone app's
    // tests depend on another checkout. The real IOU schema is verified separately.
    await database.exec(`
      create schema private;
      create table public.iou_groups (id text primary key, payload jsonb not null);
      create table public.iou_group_access (group_id text, user_id uuid);
      alter table public.iou_groups enable row level security;
      alter table public.iou_group_access enable row level security;
      revoke all on public.iou_groups, public.iou_group_access from public, anon, authenticated;
      grant select on public.iou_groups, public.iou_group_access to authenticated;
      create function public.iou_create_group(jsonb) returns jsonb language sql as $$ select $1; $$;
      revoke all on function public.iou_create_group(jsonb) from public, anon;
      grant execute on function public.iou_create_group(jsonb) to authenticated;
      insert into public.iou_groups values ('existing-iou', '{"name":"Untouched"}');
    `);
    iouBefore = await database.query(`
      select c.relname, c.relacl::text, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('iou_groups', 'iou_group_access') order by c.relname
    `);
    await database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  });

  after(async () => {
    await database?.close();
  });

  test('coexists with initialized IOU and exposes only checked invoker RPCs', async () => {
    await database.exec('reset role');
    const iouAfter = await database.query(`
      select c.relname, c.relacl::text, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('iou_groups', 'iou_group_access') order by c.relname
    `);
    assert.deepEqual(iouAfter.rows, iouBefore.rows);
    assert.deepEqual(
      (await database.query("select * from public.iou_groups where id = 'existing-iou'")).rows,
      [{ id: 'existing-iou', payload: { name: 'Untouched' } }],
    );
    const functions = await database.query(`
      select n.nspname, p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname in ('pinboard_create_board','pinboard_join_board','pinboard_mutate_board')
      order by n.nspname, p.proname
    `);
    assert.equal(functions.rows.length, 6);
    for (const row of functions.rows) {
      assert.equal(row.prosecdef, row.nspname === 'private');
      assert.deepEqual(row.proconfig, ['search_path=""']);
    }
    const grants = await database.query(`
      select
        has_function_privilege('anon', 'public.pinboard_create_board(uuid,text,text)', 'execute') as anonymous,
        has_function_privilege('authenticated', 'public.pinboard_create_board(uuid,text,text)', 'execute') as signed_in,
        has_function_privilege('authenticated', 'private.pinboard_valid_state(jsonb,jsonb)', 'execute') as validator,
        has_table_privilege('authenticated', 'public.pinboard_boards', 'insert,update,delete') as direct_write
    `);
    assert.deepEqual(grants.rows[0], {
      anonymous: false,
      signed_in: true,
      validator: false,
      direct_write: false,
    });
    const permissions = await database.query(`
      select n.nspname, p.proname,
        has_function_privilege('anon', p.oid, 'execute') as anonymous,
        has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
          where grantee = 0 and privilege_type = 'EXECUTE') as public
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private') and p.proname like 'pinboard_%'
      order by n.nspname, p.proname
    `);
    assert.equal(permissions.rows.length, 18);
    for (const permission of permissions.rows) {
      assert.equal(permission.anonymous, false, permission.proname);
      assert.equal(permission.public, false, permission.proname);
      assert.equal(
        permission.signed_in,
        [
          'pinboard_create_board',
          'pinboard_join_board',
          'pinboard_mutate_board',
          'pinboard_sync_summaries',
        ].includes(permission.proname),
        permission.proname,
      );
    }
  });

  test('anonymous visitors and signed-in strangers cannot read or mutate a board', async () => {
    await identity(creator);
    const board = await createBoard();
    await identity(null, 'anon');
    await assert.rejects(
      database.query('select * from public.pinboard_boards'),
      /permission denied/,
    );
    await assert.rejects(join(board.invite_code), /permission denied/);
    await identity(null);
    await assert.rejects(createBoard(), /PINBOARD_AUTH_REQUIRED/);
    for (const schema of ['public', 'private']) {
      await assert.rejects(
        database.query(`select ${schema}.pinboard_create_board($1::uuid,$2,$3)`, [
          randomUUID(),
          'Missing session',
          '',
        ]),
        /PINBOARD_AUTH_REQUIRED/,
      );
      await assert.rejects(
        database.query(`select ${schema}.pinboard_join_board($1)`, [board.invite_code]),
        /PINBOARD_AUTH_REQUIRED/,
      );
      await assert.rejects(
        database.query(`select ${schema}.pinboard_mutate_board($1::uuid,$2::jsonb)`, [
          board.id,
          '{"type":"update_board","patch":{}}',
        ]),
        /PINBOARD_AUTH_REQUIRED/,
      );
    }
    await identity(stranger);
    assert.equal(
      (await database.query('select id from public.pinboard_boards where id = $1', [board.id])).rows
        .length,
      0,
    );
    assert.equal(
      (
        await database.query('select * from public.pinboard_board_access where board_id = $1', [
          board.id,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      mutate(board.id, { type: 'update_board', patch: { title: 'Stolen' } }),
      /PINBOARD_ACCESS_DENIED/,
    );
    await assert.rejects(
      database.query('update public.pinboard_boards set title = $1 where id = $2', [
        'Stolen',
        board.id,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      database.query('insert into public.pinboard_board_access (board_id,user_id) values ($1,$2)', [
        board.id,
        stranger,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      database.query('delete from public.pinboard_boards where id = $1', [board.id]),
      /permission denied/,
    );
  });

  test('creation retries preserve the invitation and latest data; joining needs a full code', async () => {
    await identity(creator);
    const board = await createBoard('First title');
    assert.match(board.invite_code, /^[a-f0-9]{32}$/);
    assert.deepEqual(
      Object.keys(board).sort(),
      [
        'id',
        'invite_code',
        'title',
        'description',
        'columns',
        'cards',
        'revision',
        'created_at',
        'updated_at',
      ].sort(),
    );
    assert.deepEqual(
      board.columns.map(({ id }) => id),
      ['todo', 'doing', 'done'],
    );
    const edited = await mutate(board.id, {
      type: 'update_board',
      patch: { title: 'Latest title' },
    });
    const retried = await database.query(
      'select public.pinboard_create_board($1::uuid, $2, $3) as board',
      [board.id, 'Old title', 'Old description'],
    );
    assert.deepEqual(retried.rows[0].board, edited);
    await identity(collaborator);
    await assert.rejects(
      database.query('select public.pinboard_create_board($1::uuid, $2, $3)', [
        board.id,
        'Other creator',
        '',
      ]),
      /PINBOARD_INVALID_BOARD/,
    );
    await assert.rejects(join(board.invite_code.slice(0, 8)), /PINBOARD_INVALID_INVITE/);
    await assert.rejects(join('0'.repeat(32)), /PINBOARD_INVALID_INVITE/);
    const joined = await join(
      ` ${board.invite_code.slice(0, 16).toUpperCase()} \n ${board.invite_code.slice(16).toUpperCase()} `,
    );
    assert.equal(joined.id, board.id);
    assert.equal(joined.title, 'Latest title');
    await join(board.invite_code);
    const accesses = await database.query(
      'select * from public.pinboard_board_access where board_id = $1',
      [board.id],
    );
    assert.equal(accesses.rows.length, 1);
    assert.equal(accesses.rows[0].user_id, collaborator);
    await identity(creator);
    assert.equal(
      (await database.query('select id from public.pinboard_boards where id = $1', [board.id])).rows
        .length,
      1,
    );
  });

  test('later accepted patches win only their fields and moves preserve independent edits', async () => {
    await identity(creator);
    const board = await createBoard();
    const original = card();
    await mutate(board.id, { type: 'create_card', card: original });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { title: 'Collaborator title', assignee: 'Sam' },
    });
    await identity(creator);
    await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { description: 'Independent description' },
    });
    const moved = await mutate(board.id, {
      type: 'move_card',
      id: original.id,
      columnId: 'doing',
      position: 2500.5,
    });
    assert.deepEqual(moved.cards[0], {
      ...original,
      title: 'Collaborator title',
      assignee: 'Sam',
      description: 'Independent description',
      columnId: 'doing',
      position: 2500.5,
    });
    await identity(collaborator);
    const latest = await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { title: 'Latest accepted title' },
    });
    assert.equal(latest.cards[0].title, 'Latest accepted title');
    assert.equal(latest.cards[0].description, 'Independent description');
    assert.equal(latest.cards[0].columnId, 'doing');
    assert.equal(latest.revision, moved.revision + 1);
    assert.ok(Date.parse(latest.updated_at) >= Date.parse(board.created_at));
  });

  test('card retries do not overwrite edits and stale editors cannot resurrect deletions', async () => {
    await identity(creator);
    const board = await createBoard();
    const original = card();
    await mutate(board.id, { type: 'create_card', card: original });
    const edited = await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { title: 'Edited after creation' },
    });
    assert.deepEqual(await mutate(board.id, { type: 'create_card', card: original }), edited);
    const deleted = await mutate(board.id, {
      type: 'delete_card',
      id: original.id,
    });
    assert.deepEqual(await mutate(board.id, { type: 'delete_card', id: original.id }), deleted);
    await assert.rejects(
      mutate(board.id, {
        type: 'update_card',
        id: original.id,
        patch: { title: 'Stale edit' },
      }),
      /PINBOARD_CARD_NOT_FOUND/,
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'move_card',
        id: original.id,
        columnId: 'done',
        position: 0,
      }),
      /PINBOARD_CARD_NOT_FOUND/,
    );
    const stored = await database.query(
      'select cards, revision from public.pinboard_boards where id = $1',
      [board.id],
    );
    assert.deepEqual(stored.rows[0].cards, []);
    assert.equal(Number(stored.rows[0].revision), deleted.revision);
  });

  test('column-creation retries preserve later edits and order without incrementing revisions', async () => {
    await identity(creator);
    const board = await createBoard();
    const column = { id: randomUUID(), title: 'Review', color: 'violet' };
    await mutate(board.id, { type: 'add_column', column });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, {
      type: 'update_column',
      id: column.id,
      patch: { title: 'Peer review', color: 'blue' },
    });
    const current = await mutate(board.id, {
      type: 'reorder_columns',
      columnIds: [column.id, 'done', 'todo', 'doing'],
    });
    await identity(creator);
    assert.deepEqual(await mutate(board.id, { type: 'add_column', column }), current);
    await assert.rejects(
      mutate(board.id, {
        type: 'add_column',
        column: { ...column, unexpected: true },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'add_column',
        column: { ...column, title: '' },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    assert.deepEqual(await mutate(board.id, { type: 'add_column', column }), current);
  });

  test('lost create responses cannot resurrect cards or columns deleted by another member', async () => {
    await identity(creator);
    const board = await createBoard();
    const originalCard = card();
    const originalColumn = {
      id: randomUUID(),
      title: 'Temporary review',
      color: 'violet',
    };
    await mutate(board.id, { type: 'create_card', card: originalCard });
    await mutate(board.id, { type: 'add_column', column: originalColumn });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, { type: 'delete_card', id: originalCard.id });
    await mutate(board.id, {
      type: 'delete_column',
      id: originalColumn.id,
      targetColumnId: 'todo',
    });
    const independentCard = card({ title: 'New independent work' });
    await mutate(board.id, { type: 'create_card', card: independentCard });
    const latest = await mutate(board.id, {
      type: 'update_board',
      patch: { description: 'Keep this later note' },
    });
    await identity(creator);
    assert.deepEqual(await mutate(board.id, { type: 'create_card', card: originalCard }), latest);
    assert.deepEqual(
      await mutate(board.id, {
        type: 'create_card',
        card: { ...originalCard, title: 'Changed stale retry' },
      }),
      latest,
    );
    assert.deepEqual(
      await mutate(board.id, { type: 'add_column', column: originalColumn }),
      latest,
    );
    assert.deepEqual(
      await mutate(board.id, {
        type: 'add_column',
        column: { ...originalColumn, color: 'blue' },
      }),
      latest,
    );
    assert.deepEqual(latest.cards, [independentCard]);
    assert.ok(!latest.columns.some((column) => column.id === originalColumn.id));
    assert.deepEqual(
      Object.keys(latest).sort(),
      [
        'id',
        'invite_code',
        'title',
        'description',
        'columns',
        'cards',
        'revision',
        'created_at',
        'updated_at',
      ].sort(),
    );
    // Receipts are not readable by members, so read them as the administrator.
    await database.exec('reset role');
    const receipts = (
      await database.query(
        'select deleted_card_ids,deleted_column_ids from public.pinboard_boards where id=$1',
        [board.id],
      )
    ).rows[0];
    assert.deepEqual(receipts, {
      deleted_card_ids: [originalCard.id],
      deleted_column_ids: [originalColumn.id],
    });
    await identity(creator);
    assert.deepEqual(await mutate(board.id, { type: 'delete_card', id: originalCard.id }), latest);
  });

  test('column changes move contained cards atomically and always retain one column', async () => {
    await identity(creator);
    const board = await createBoard();
    const original = card();
    await mutate(board.id, { type: 'create_card', card: original });
    await mutate(board.id, {
      type: 'add_column',
      column: { id: 'review', title: 'Review', color: 'violet' },
    });
    await mutate(board.id, {
      type: 'update_column',
      id: 'review',
      patch: { title: 'Peer review', color: 'blue' },
    });
    const moved = await mutate(board.id, {
      type: 'delete_column',
      id: 'todo',
      targetColumnId: 'review',
    });
    assert.equal(moved.cards[0].columnId, 'review');
    assert.deepEqual(
      moved.columns.map(({ id }) => id),
      ['doing', 'done', 'review'],
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'move_card',
        id: original.id,
        columnId: 'todo',
        position: 0,
      }),
      /PINBOARD_COLUMN_NOT_FOUND/,
    );
    await mutate(board.id, {
      type: 'delete_column',
      id: 'doing',
      targetColumnId: 'review',
    });
    await mutate(board.id, {
      type: 'delete_column',
      id: 'done',
      targetColumnId: 'review',
    });
    await assert.rejects(
      mutate(board.id, {
        type: 'delete_column',
        id: 'review',
        targetColumnId: 'review',
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    const stored = await database.query(
      'select columns,cards from public.pinboard_boards where id = $1',
      [board.id],
    );
    assert.equal(stored.rows[0].columns.length, 1);
    assert.equal(stored.rows[0].cards[0].columnId, 'review');
  });

  test('column ordering preserves current metadata, cards, and independent board changes', async () => {
    await identity(creator);
    const board = await createBoard();
    const original = card({ columnId: 'doing' });
    await mutate(board.id, { type: 'create_card', card: original });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, {
      type: 'update_column',
      id: 'doing',
      patch: { title: 'Active work', color: 'blue' },
    });
    const current = await mutate(board.id, {
      type: 'update_board',
      patch: { description: 'Independent board detail' },
    });
    await identity(creator);
    const ordered = await mutate(board.id, {
      type: 'reorder_columns',
      columnIds: ['done', 'doing', 'todo'],
    });
    assert.deepEqual(
      ordered.columns,
      ['done', 'doing', 'todo'].map((id) => current.columns.find((column) => column.id === id)),
    );
    assert.deepEqual(ordered.cards, current.cards);
    assert.equal(ordered.description, current.description);
    assert.equal(ordered.revision, current.revision + 1);
  });

  test('stale column orders omit deleted IDs and append current unlisted columns without losing cards', async () => {
    await identity(creator);
    const board = await createBoard();
    const original = card({ columnId: 'doing' });
    await mutate(board.id, { type: 'create_card', card: original });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, {
      type: 'delete_column',
      id: 'doing',
      targetColumnId: 'todo',
    });
    await mutate(board.id, {
      type: 'add_column',
      column: { id: 'review', title: 'Review', color: 'violet' },
    });
    const current = await mutate(board.id, {
      type: 'add_column',
      column: { id: 'waiting', title: 'Waiting', color: 'amber' },
    });
    await identity(creator);
    const ordered = await mutate(board.id, {
      type: 'reorder_columns',
      columnIds: ['done', 'doing', 'todo'],
    });
    assert.deepEqual(
      ordered.columns.map(({ id }) => id),
      ['done', 'todo', 'review', 'waiting'],
    );
    assert.deepEqual(ordered.cards, current.cards);
    assert.equal(ordered.cards[0].columnId, 'todo');
    assert.deepEqual(ordered.columns.slice(2), current.columns.slice(2));
    // Even an entirely obsolete snapshot preserves all current columns.
    assert.deepEqual(
      await mutate(board.id, {
        type: 'reorder_columns',
        columnIds: ['obsolete-column'],
      }),
      ordered,
    );
  });

  test('later accepted column orders win while independent edits survive', async () => {
    await identity(creator);
    const board = await createBoard();
    const first = await mutate(board.id, {
      type: 'reorder_columns',
      columnIds: ['done', 'todo', 'doing'],
    });
    await identity(collaborator);
    await join(board.invite_code);
    const edited = await mutate(board.id, {
      type: 'update_column',
      id: 'todo',
      patch: { title: 'Backlog' },
    });
    const last = await mutate(board.id, {
      type: 'reorder_columns',
      columnIds: ['doing', 'done', 'todo'],
    });
    assert.deepEqual(
      last.columns.map(({ id }) => id),
      ['doing', 'done', 'todo'],
    );
    assert.equal(last.columns[2].title, 'Backlog');
    assert.equal(last.revision, edited.revision + 1);
    assert.equal(last.revision, first.revision + 2);
    await identity(creator);
    assert.deepEqual(
      (await database.query('select columns from public.pinboard_boards where id = $1', [board.id]))
        .rows[0].columns,
      last.columns,
    );
  });

  test('column ordering rejects malformed or unauthorized input without changing the board', async () => {
    await identity(creator);
    const board = await createBoard();
    const invalidOrders = [
      null,
      {},
      'todo',
      [],
      Array.from({ length: 21 }, (_, index) => `column-${index}`),
      ['todo', 'todo'],
      [''],
      ['unsafe id'],
      ['constructor'],
      ['prototype'],
      ['__proto__'],
      ['x'.repeat(65)],
      [null],
      [1],
      [{ id: 'todo' }],
    ];
    for (const columnIds of invalidOrders) {
      await assert.rejects(
        mutate(board.id, { type: 'reorder_columns', columnIds }),
        /PINBOARD_INVALID_OPERATION/,
      );
    }
    await assert.rejects(
      mutate(board.id, { type: 'reorder_columns' }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'reorder_columns',
        columnIds: ['todo'],
        columns: board.columns,
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await identity(stranger);
    await assert.rejects(
      mutate(board.id, {
        type: 'reorder_columns',
        columnIds: ['done', 'todo', 'doing'],
      }),
      /PINBOARD_ACCESS_DENIED/,
    );
    await identity(creator);
    assert.deepEqual(
      await mutate(board.id, {
        type: 'reorder_columns',
        columnIds: ['todo', 'doing', 'done'],
      }),
      board,
    );
  });

  test('repeating an unchanged column order is a no-op including its revision and timestamp', async () => {
    await identity(creator);
    const board = await createBoard();
    assert.deepEqual(
      await mutate(board.id, {
        type: 'reorder_columns',
        columnIds: ['todo', 'doing', 'done'],
      }),
      board,
    );
    const ordered = await mutate(board.id, {
      type: 'reorder_columns',
      columnIds: ['done', 'doing', 'todo'],
    });
    assert.deepEqual(
      await mutate(board.id, {
        type: 'reorder_columns',
        columnIds: ['done', 'doing', 'todo'],
      }),
      ordered,
    );
    // A partial order appends every omitted current column in its existing order.
    assert.deepEqual(
      await mutate(board.id, { type: 'reorder_columns', columnIds: ['done'] }),
      ordered,
    );
  });

  test('invalid payloads cannot bypass field, reference, date, size, and count limits', async () => {
    await identity(creator);
    await assert.rejects(createBoard(' '), /PINBOARD_INVALID_BOARD/);
    await assert.rejects(createBoard('😀'.repeat(81)), /PINBOARD_INVALID_BOARD/);
    const board = await createBoard();
    const invalid = [
      { title: null },
      { title: 'x'.repeat(161) },
      { description: 'x'.repeat(10001) },
      { columnId: 'missing' },
      { position: -1 },
      { position: 1000000000001 },
      { position: '0' },
      { priority: 'urgent' },
      { assignee: 'x'.repeat(81) },
      { dueDate: '2026-02-30' },
      { dueDate: '0000-01-01' },
      { dueDate: '2026-2-01' },
      { labels: Array(9).fill('tag') },
      { labels: ['x'.repeat(31)] },
      { labels: [''] },
      { id: 'unsafe' },
      { title: '\u0001' },
      { title: '\u007f' },
      { unexpected: true },
    ];
    for (const overrides of invalid) {
      await assert.rejects(
        mutate(board.id, { type: 'create_card', card: card(overrides) }),
        /PINBOARD_INVALID_OPERATION/,
      );
    }
    const valid = card({
      dueDate: '2028-02-29',
      position: 1000000000000,
      title: '😀'.repeat(80),
      description: '\u0085\t\n\r',
      labels: Array(8).fill('tag'),
    });
    await mutate(board.id, { type: 'create_card', card: valid });
    await assert.rejects(
      mutate(board.id, {
        type: 'update_card',
        id: valid.id,
        patch: { id: randomUUID() },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'update_board',
        patch: { invite_code: '0'.repeat(32) },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await assert.rejects(
      mutate(board.id, { type: 'update_board', patch: { title: 42 } }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await assert.rejects(
      mutate(board.id, { type: 'update_board', patch: { description: null } }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'add_column',
        column: { id: 'constructor', title: 'Unsafe', color: 'slate' },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'update_column',
        id: 'todo',
        patch: { color: 'black' },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    for (let index = 3; index < 20; index += 1) {
      await mutate(board.id, {
        type: 'add_column',
        column: {
          id: `column-${index}`,
          title: `Column ${index}`,
          color: 'slate',
        },
      });
    }
    const full = await mutate(board.id, { type: 'update_board', patch: {} });
    assert.deepEqual(await mutate(board.id, { type: 'add_column', column: full.columns[0] }), full);
    await assert.rejects(
      mutate(board.id, {
        type: 'add_column',
        column: { id: 'too-many', title: '21st', color: 'slate' },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    // Seed the maximum through the administrator, then exercise the public RPC.
    await database.exec('reset role');
    await database.query('update public.pinboard_boards set cards = $1::jsonb where id = $2', [
      JSON.stringify(Array.from({ length: 2000 }, () => card())),
      board.id,
    ]);
    await identity(creator);
    await assert.rejects(
      mutate(board.id, { type: 'create_card', card: card() }),
      /PINBOARD_INVALID_OPERATION/,
    );
    const stored = await database.query(
      'select columns,cards from public.pinboard_boards where id = $1',
      [board.id],
    );
    assert.equal(stored.rows[0].columns.length, 20);
    assert.equal(stored.rows[0].cards.length, 2000);
  });

  test('board and membership limits reject new work while permitting creation and join retries', async () => {
    const limitedCreator = randomUUID();
    const limitedMember = randomUUID();
    await database.exec('reset role');
    await database.query('insert into auth.users(id) values ($1),($2)', [
      limitedCreator,
      limitedMember,
    ]);
    await identity(limitedCreator);
    const original = await createBoard('Creator limit retry');
    await database.exec('reset role');
    await database.query(
      `
      insert into public.pinboard_boards (id, invite_code, title, description, columns, created_by)
      select gen_random_uuid(), replace(gen_random_uuid()::text, '-', ''), 'Limit fixture', '', columns, $1::uuid
      from public.pinboard_boards cross join generate_series(1,99) where id = $2::uuid
    `,
      [limitedCreator, original.id],
    );
    await identity(limitedCreator);
    await assert.rejects(createBoard(), /PINBOARD_BOARD_LIMIT/);
    const retry = await database.query(
      'select public.pinboard_create_board($1::uuid,$2,$3) as board',
      [original.id, 'Old title', 'Old description'],
    );
    assert.deepEqual(retry.rows[0].board, original);

    // Bulk-seed the limit as administrator, then exercise only public RPCs.
    await database.exec('reset role');
    const seeded = await database.query(
      `
      insert into public.pinboard_boards (id, invite_code, title, description, columns)
      select gen_random_uuid(), replace(gen_random_uuid()::text, '-', ''), 'Membership fixture', '', columns
      from public.pinboard_boards cross join generate_series(1,1000) where id = $1::uuid
      returning id, invite_code
    `,
      [original.id],
    );
    await database.query(
      `
      insert into public.pinboard_board_access (board_id,user_id)
      select unnest($1::uuid[]), $2::uuid
    `,
      [seeded.rows.map((row) => row.id), limitedMember],
    );
    await identity(limitedMember);
    const existing = await join(seeded.rows[0].invite_code);
    assert.equal(existing.id, seeded.rows[0].id);
    await assert.rejects(join(original.invite_code), /PINBOARD_BOARD_LIMIT/);
    await assert.rejects(createBoard(), /PINBOARD_BOARD_LIMIT/);
    assert.equal(
      Number(
        (await database.query('select count(*) as count from public.pinboard_board_access')).rows[0]
          .count,
      ),
      1000,
    );
  });

  test('revision exhaustion permits no-ops and rejects changes atomically', async () => {
    await identity(creator);
    const board = await createBoard();
    const original = card();
    const saved = await mutate(board.id, {
      type: 'create_card',
      card: original,
    });
    await database.exec('reset role');
    await database.query(
      'update public.pinboard_boards set revision = 9007199254740991 where id = $1',
      [board.id],
    );
    await identity(creator);
    const full = { ...saved, revision: Number.MAX_SAFE_INTEGER };
    for (const operation of [
      { type: 'update_board', patch: {} },
      {
        type: 'update_card',
        id: original.id,
        patch: { title: original.title },
      },
      { type: 'create_card', card: original },
      { type: 'add_column', column: full.columns[0] },
      { type: 'delete_card', id: randomUUID() },
      {
        type: 'reorder_columns',
        columnIds: full.columns.map((column) => column.id),
      },
    ])
      assert.deepEqual(await mutate(board.id, operation), full);
    for (const operation of [
      { type: 'update_board', patch: { title: 'Must not save' } },
      { type: 'delete_card', id: original.id },
      { type: 'reorder_columns', columnIds: ['done', 'doing', 'todo'] },
    ])
      await assert.rejects(mutate(board.id, operation), /PINBOARD_BOARD_LIMIT/);
    assert.deepEqual(await mutate(board.id, { type: 'update_board', patch: {} }), full);
  });

  test('moves or edits into a removed column report a dedicated error while malformed destinations stay invalid', async () => {
    await identity(creator);
    const board = await createBoard();
    const original = card();
    await mutate(board.id, { type: 'create_card', card: original });
    await mutate(board.id, {
      type: 'delete_column',
      id: 'doing',
      targetColumnId: 'todo',
    });
    for (const operation of [
      { type: 'move_card', id: original.id, columnId: 'doing', position: 1 },
      { type: 'update_card', id: original.id, patch: { columnId: 'doing' } },
    ])
      await assert.rejects(mutate(board.id, operation), /PINBOARD_COLUMN_NOT_FOUND/);
    for (const columnId of ['unsafe id', 5, null, '']) {
      await assert.rejects(
        mutate(board.id, {
          type: 'update_card',
          id: original.id,
          patch: { columnId },
        }),
        /PINBOARD_INVALID_OPERATION/,
      );
    }
    // A missing card still takes precedence, so a stale editor cannot learn about or recreate it.
    await assert.rejects(
      mutate(board.id, {
        type: 'move_card',
        id: randomUUID(),
        columnId: 'doing',
        position: 1,
      }),
      /PINBOARD_CARD_NOT_FOUND/,
    );
    const stored = await database.query('select cards from public.pinboard_boards where id = $1', [
      board.id,
    ]);
    assert.deepEqual(stored.rows[0].cards, [original]);
  });

  test('shared field visibility and custom values survive hiding, renaming and a schema refresh', async () => {
    await identity(creator);
    const board = await createBoard('Custom fields');
    const fieldId = randomUUID();
    const settings = {
      hidden: ['assignee', 'labels'],
      custom: [{ id: fieldId, title: 'Project link', hidden: false }],
    };
    const configured = await mutate(board.id, {
      type: 'update_board',
      patch: { card_fields: settings },
    });
    assert.deepEqual(configured.card_fields, settings);
    assert.equal(configured.revision, board.revision + 1);
    const original = card({
      assignee: 'Alex',
      labels: ['Keep'],
      customFields: { [fieldId]: 'Plan' },
    });
    const created = await mutate(board.id, { type: 'create_card', card: original });
    const hidden = { ...settings, custom: [{ id: fieldId, title: 'Reference', hidden: true }] };
    const saved = await mutate(board.id, { type: 'update_board', patch: { card_fields: hidden } });
    assert.deepEqual(saved.cards, created.cards);
    assert.deepEqual(saved.cards[0], original);
    assert.deepEqual(
      await mutate(board.id, { type: 'update_board', patch: { card_fields: hidden } }),
      saved,
    );
    await database.exec('reset role');
    await database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await identity(creator);
    assert.deepEqual(await join(board.invite_code), saved);
    assert.deepEqual(
      (
        await database.query('select card_fields from public.pinboard_boards where id = $1', [
          board.id,
        ])
      ).rows[0].card_fields,
      hidden,
    );
    await identity(stranger);
    assert.deepEqual(
      (
        await database.query('select card_fields from public.pinboard_boards where id = $1', [
          board.id,
        ])
      ).rows,
      [],
    );
    await assert.rejects(
      mutate(board.id, { type: 'update_board', patch: { card_fields: settings } }),
      /PINBOARD_ACCESS_DENIED/,
    );
  });

  test('custom value patches merge independent fields and keep ordinary card edits intact', async () => {
    await identity(creator);
    const board = await createBoard();
    const firstId = randomUUID();
    const secondId = randomUUID();
    await mutate(board.id, {
      type: 'update_board',
      patch: {
        card_fields: {
          hidden: [],
          custom: [
            { id: firstId, title: 'Team', hidden: false },
            { id: secondId, title: 'Reference', hidden: false },
          ],
        },
      },
    });
    const original = card({ customFields: { [firstId]: 'Supply', [secondId]: 'First' } });
    await mutate(board.id, { type: 'create_card', card: original });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { title: 'Renamed', customFields: { [secondId]: 'Second' } },
    });
    await identity(creator);
    const saved = await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { customFields: { [firstId]: 'Platform' } },
    });
    assert.equal(saved.cards[0].title, 'Renamed');
    assert.deepEqual(saved.cards[0].customFields, { [firstId]: 'Platform', [secondId]: 'Second' });
    const cleared = await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { customFields: { [firstId]: '' } },
    });
    assert.deepEqual(cleared.cards[0].customFields, { [firstId]: '', [secondId]: 'Second' });
    const moved = await mutate(board.id, {
      type: 'move_card',
      id: original.id,
      columnId: 'doing',
      position: 1024,
    });
    assert.deepEqual(moved.cards[0].customFields, cleared.cards[0].customFields);
  });

  test('a stale settings editor retains newly added fields and their values', async () => {
    await identity(creator);
    const board = await createBoard();
    const first = { id: randomUUID(), title: 'Team', hidden: false };
    const second = { id: randomUUID(), title: 'Reference', hidden: false };
    await mutate(board.id, {
      type: 'update_board',
      patch: { card_fields: { hidden: [], custom: [first] } },
    });
    const original = card({ customFields: { [first.id]: 'Keep this' } });
    await mutate(board.id, { type: 'create_card', card: original });
    const saved = await mutate(board.id, {
      type: 'update_board',
      patch: { card_fields: { hidden: ['priority'], custom: [second] } },
    });
    assert.deepEqual(saved.card_fields.custom, [second, first]);
    assert.deepEqual(saved.cards, [original]);
    const updated = await mutate(board.id, {
      type: 'update_board',
      patch: { card_fields: { hidden: [], custom: [{ ...first, hidden: true }] } },
    });
    assert.deepEqual(updated.card_fields.custom, [{ ...first, hidden: true }, second]);
    assert.deepEqual(updated.cards, [original]);
  });

  test('saved assignees survive stale settings, retries and membership reads without creating cards', async () => {
    await identity(creator);
    const board = await createBoard();
    await mutate(board.id, { type: 'add_assignee', name: 'Alex' });
    await identity(collaborator);
    await join(board.invite_code);
    const operation = { type: 'add_assignee', name: 'Sam' };
    const saved = await mutate(board.id, operation);
    assert.deepEqual(saved.card_fields.assignees, ['Alex', 'Sam']);
    assert.deepEqual(saved.cards, []);
    assert.deepEqual(await mutate(board.id, operation), saved);
    await identity(creator);
    const legacy = await mutate(board.id, {
      type: 'update_board',
      patch: { card_fields: { hidden: ['labels'], custom: [] } },
    });
    assert.deepEqual(legacy.card_fields.assignees, ['Alex', 'Sam']);
    for (const assignees of [
      null,
      [''],
      ['Alex', 'Alex'],
      ['x'.repeat(81)],
      [42],
      Array.from({ length: 2001 }, (_, i) => `Person ${i}`),
    ])
      await assert.rejects(
        mutate(board.id, {
          type: 'update_board',
          patch: { title: 'Must roll back', card_fields: { hidden: [], custom: [], assignees } },
        }),
        /PINBOARD_INVALID_OPERATION/,
      );
    assert.deepEqual(await join(board.invite_code), legacy);
  });

  test('deleting assignees unassigns active and archived cards and rejects stale assignments', async () => {
    await identity(creator);
    const board = await createBoard();
    const first = card({ assignee: 'Alex' });
    const old = card({ assignee: 'Alex', archived: true });
    const other = card({ assignee: 'Sam' });
    for (const item of [first, old, other])
      await mutate(board.id, { type: 'create_card', card: item });
    const saved = await mutate(board.id, { type: 'delete_assignee', name: 'Alex' });
    assert.deepEqual(saved.card_fields.assignees, ['Sam']);
    assert.deepEqual(saved.cards, [{ ...first, assignee: '' }, { ...old, assignee: '' }, other]);
    assert.deepEqual(await mutate(board.id, { type: 'delete_assignee', name: 'Alex' }), saved);
    const stale = await mutate(board.id, {
      type: 'update_board',
      patch: { card_fields: { hidden: ['labels'], custom: [], assignees: ['Alex', 'Sam'] } },
    });
    assert.deepEqual(stale.card_fields.assignees, ['Sam']);
    assert.deepEqual(stale.cards, saved.cards);
    await assert.rejects(
      mutate(board.id, {
        type: 'update_card',
        id: first.id,
        patch: { title: 'Must roll back', assignee: 'Alex' },
      }),
      /PINBOARD_ASSIGNEE_NOT_FOUND/,
    );
    await assert.rejects(
      mutate(board.id, { type: 'create_card', card: card({ assignee: 'Alex' }) }),
      /PINBOARD_ASSIGNEE_NOT_FOUND/,
    );
    assert.deepEqual(await join(board.invite_code), stale);
    const readded = await mutate(board.id, { type: 'add_assignee', name: 'Alex' });
    assert.deepEqual(readded.card_fields.assignees, ['Sam', 'Alex']);
    assert.deepEqual(readded.cards, saved.cards);
    for (const type of ['add_assignee', 'delete_assignee'])
      for (const name of ['', 'x'.repeat(81), null, 42])
        await assert.rejects(mutate(board.id, { type, name }), /PINBOARD_INVALID_OPERATION/);
    await identity(stranger);
    await assert.rejects(
      mutate(board.id, { type: 'delete_assignee', name: 'Sam' }),
      /PINBOARD_ACCESS_DENIED/,
    );
  });

  test('invalid field settings and custom values roll back every part of the edit', async () => {
    await identity(creator);
    const board = await createBoard();
    const fieldId = randomUUID();
    const field = { id: fieldId, title: 'Team', hidden: false };
    const settings = { hidden: [], custom: [field] };
    await mutate(board.id, { type: 'update_board', patch: { card_fields: settings } });
    const original = card({ customFields: { [fieldId]: 'Keep' } });
    const before = await mutate(board.id, { type: 'create_card', card: original });
    for (const invalid of [
      null,
      { ...settings, hidden: ['title'] },
      { ...settings, hidden: ['labels', 'labels'] },
      { ...settings, custom: [{ ...field, title: 'Priority' }] },
      { ...settings, custom: [{ ...field, title: 'x'.repeat(41) }] },
      { ...settings, custom: [field, { ...field, id: randomUUID(), title: ' team ' }] },
      { ...settings, custom: [{ ...field, hidden: 'yes' }] },
      { ...settings, extra: true },
      {
        ...settings,
        custom: Array.from({ length: 13 }, (_, index) => ({
          ...field,
          id: randomUUID(),
          title: `Field ${index}`,
        })),
      },
    ])
      await assert.rejects(
        mutate(board.id, {
          type: 'update_board',
          patch: { title: 'Must roll back', card_fields: invalid },
        }),
        /PINBOARD_INVALID_OPERATION/,
      );
    for (const customFields of [
      null,
      [],
      { [fieldId]: 42 },
      { [fieldId]: 'x'.repeat(1001) },
      { [randomUUID()]: 'Unknown' },
      { __proto__: null, bad: 'No' },
    ])
      await assert.rejects(
        mutate(board.id, {
          type: 'update_card',
          id: original.id,
          patch: { title: 'Must roll back', customFields },
        }),
        /PINBOARD_INVALID_OPERATION/,
      );
    await assert.rejects(
      mutate(board.id, {
        type: 'create_card',
        card: card({ customFields: { [randomUUID()]: 'Unknown' } }),
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    assert.deepEqual(await join(board.invite_code), before);
  });

  test('archiving and restoring retain independent edits, survive column removal and never revive deletions', async () => {
    await identity(creator);
    const board = await createBoard();
    const fieldId = randomUUID();
    await mutate(board.id, {
      type: 'update_board',
      patch: {
        card_fields: { hidden: [], custom: [{ id: fieldId, title: 'Team', hidden: false }] },
      },
    });
    const original = card({
      assignee: 'Alex',
      customFields: { [fieldId]: 'Keep' },
      labels: ['Work'],
      dueDate: '2030-10-15',
    });
    await mutate(board.id, { type: 'create_card', card: original });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { title: 'Changed elsewhere' },
    });
    await identity(creator);
    const operation = { type: 'update_card', id: original.id, patch: { archived: true } };
    const archived = await mutate(board.id, operation);
    assert.deepEqual(archived.cards, [{ ...original, title: 'Changed elsewhere', archived: true }]);
    assert.deepEqual(await mutate(board.id, operation), archived);
    for (const invalid of [null, 'true', 1, {}]) {
      await assert.rejects(
        mutate(board.id, {
          type: 'update_card',
          id: original.id,
          patch: { title: 'Must roll back', archived: invalid },
        }),
        /PINBOARD_INVALID_OPERATION/,
      );
      await assert.rejects(
        mutate(board.id, { type: 'create_card', card: card({ archived: invalid }) }),
        /PINBOARD_INVALID_OPERATION/,
      );
    }
    assert.deepEqual(await join(board.invite_code), archived);
    const moved = await mutate(board.id, {
      type: 'delete_column',
      id: 'todo',
      targetColumnId: 'done',
    });
    assert.equal(moved.cards[0].archived, true);
    assert.equal(moved.cards[0].columnId, 'done');
    const restored = await mutate(board.id, {
      type: 'update_card',
      id: original.id,
      patch: { archived: false },
    });
    assert.deepEqual(restored.cards, [{ ...moved.cards[0], archived: false }]);
    await database.exec('reset role');
    await database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await identity(collaborator);
    assert.deepEqual(await join(board.invite_code), restored);
    await mutate(board.id, operation);
    await mutate(board.id, { type: 'delete_card', id: original.id });
    await assert.rejects(
      mutate(board.id, { type: 'update_card', id: original.id, patch: { archived: false } }),
      /PINBOARD_CARD_NOT_FOUND/,
    );
    assert.deepEqual((await join(board.invite_code)).cards, []);
  });

  test('same-column moves persist fractional order and retain another member’s independent edits', async () => {
    await identity(creator);
    const board = await createBoard();
    const first = card({ title: 'First', position: 1024 });
    const middle = card({ title: 'Middle', position: 2048 });
    const last = card({ title: 'Last', position: 3072 });
    for (const item of [first, middle, last])
      await mutate(board.id, { type: 'create_card', card: item });
    await identity(collaborator);
    await join(board.invite_code);
    await mutate(board.id, {
      type: 'update_card',
      id: last.id,
      patch: { title: 'Renamed', assignee: 'Sam' },
    });
    await identity(creator);
    const moved = await mutate(board.id, {
      type: 'move_card',
      id: last.id,
      columnId: 'todo',
      position: 1536.5,
    });
    const saved = await join(board.invite_code);
    assert.deepEqual(saved, moved);
    assert.deepEqual(
      saved.cards.filter((item) => item.id !== last.id),
      [first, middle],
    );
    assert.deepEqual(
      saved.cards.find((item) => item.id === last.id),
      { ...last, title: 'Renamed', assignee: 'Sam', position: 1536.5 },
    );
    assert.deepEqual(
      [...saved.cards].sort((a, b) => a.position - b.position).map((item) => item.title),
      ['First', 'Renamed', 'Middle'],
    );
  });

  test('removing a column appends its cards after the destination cards in their original order', async () => {
    await identity(creator);
    const board = await createBoard();
    const at = (title, columnId, position, id) =>
      card({ title, columnId, position, ...(id ? { id } : {}) });
    const first = at('Todo first', 'todo', 1024);
    const last = at('Todo last', 'todo', 4096.5);
    const tieA = at('Doing tie A', 'doing', 700, '00000000-0000-4000-8000-00000000000a');
    const tieB = at('Doing tie B', 'doing', 700, '00000000-0000-4000-8000-00000000000b');
    const later = at('Doing later', 'doing', 90000);
    const sooner = at('Doing sooner', 'doing', 5);
    const bystander = at('Done card', 'done', 321);
    for (const created of [later, tieB, first, bystander, sooner, last, tieA]) {
      await mutate(board.id, { type: 'create_card', card: created });
    }
    const before = await mutate(board.id, { type: 'update_board', patch: {} });
    const removed = await mutate(board.id, {
      type: 'delete_column',
      id: 'doing',
      targetColumnId: 'todo',
    });
    assert.equal(removed.revision, before.revision + 1);
    const inTodo = removed.cards
      .filter((item) => item.columnId === 'todo')
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    assert.deepEqual(
      inTodo.map((item) => item.title),
      ['Todo first', 'Todo last', 'Doing sooner', 'Doing tie A', 'Doing tie B', 'Doing later'],
    );
    assert.deepEqual(
      inTodo.slice(2).map((item) => item.position),
      [5120.5, 6144.5, 7168.5, 8192.5],
    );
    assert.deepEqual(inTodo.slice(0, 2), [first, last]);
    assert.deepEqual(
      removed.cards.find((item) => item.columnId === 'done'),
      bystander,
    );
    assert.equal(removed.cards.length, 7);
    // Nothing to append after, and an upper bound: positions never leave the allowed range.
    const emptyTarget = await mutate(board.id, {
      type: 'delete_column',
      id: 'done',
      targetColumnId: 'doing',
    }).catch((error) => error);
    assert.match(String(emptyTarget), /PINBOARD_COLUMN_NOT_FOUND/);
    await mutate(board.id, {
      type: 'add_column',
      column: { id: 'review', title: 'Review', color: 'violet' },
    });
    const toEmpty = await mutate(board.id, {
      type: 'delete_column',
      id: 'done',
      targetColumnId: 'review',
    });
    assert.deepEqual(
      toEmpty.cards.filter((item) => item.columnId === 'review').map((item) => item.position),
      [1024],
    );
    const crowded = await mutate(board.id, {
      type: 'create_card',
      card: at('At the limit', 'review', 1000000000000),
    });
    assert.ok(crowded.cards.some((item) => item.title === 'At the limit'));
    await mutate(board.id, {
      type: 'add_column',
      column: { id: 'extra', title: 'Extra', color: 'rose' },
    });
    await mutate(board.id, {
      type: 'create_card',
      card: at('Extra one', 'extra', 10),
    });
    const clamped = await mutate(board.id, {
      type: 'delete_column',
      id: 'extra',
      targetColumnId: 'review',
    });
    assert.ok(clamped.cards.every((item) => item.position >= 0 && item.position <= 1000000000000));
    assert.equal(clamped.cards.find((item) => item.title === 'Extra one').columnId, 'review');
  });

  test('rerunning schema.sql refreshes an installed project without changing data, policies, ownership, or grants', async () => {
    await identity(creator);
    const board = await createBoard('Existing board before refresh');
    const original = card();
    const saved = await mutate(board.id, {
      type: 'create_card',
      card: original,
    });
    await database.exec('reset role');
    const functionSnapshot = async () =>
      (
        await database.query(`
      select p.oid, n.nspname, p.proname, p.proowner, p.proacl::text, pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private') and p.proname ~ '^pinboard_' order by n.nspname, p.proname
    `)
      ).rows;
    const tableSnapshot = async () =>
      (
        await database.query(`
      select c.oid, c.relname, c.relowner, c.relacl::text, c.relrowsecurity, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname ~ '^pinboard_' order by c.relname
    `)
      ).rows;
    const policiesSnapshot = async () =>
      (
        await database.query(
          "select * from pg_policies where tablename in ('pinboard_boards','pinboard_board_access') order by tablename,policyname",
        )
      ).rows;
    const dataSnapshot = async () => ({
      boards: (await database.query('select * from public.pinboard_boards order by id')).rows,
      access: (
        await database.query('select * from public.pinboard_board_access order by board_id,user_id')
      ).rows,
      iou: (await database.query('select * from public.iou_groups order by id')).rows,
    });
    const iouSnapshot = async () =>
      (
        await database.query(`
      select c.relname, c.relacl::text, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('iou_groups', 'iou_group_access') order by c.relname
    `)
      ).rows;
    const beforeFunctions = await functionSnapshot();
    const beforeTables = await tableSnapshot();
    const beforePolicies = await policiesSnapshot();
    const beforeData = await dataSnapshot();
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await database.exec(schema);
    await database.exec(schema);
    assert.deepEqual(await functionSnapshot(), beforeFunctions);
    assert.deepEqual(await tableSnapshot(), beforeTables);
    assert.deepEqual(await policiesSnapshot(), beforePolicies);
    assert.deepEqual(await dataSnapshot(), beforeData);
    assert.deepEqual(await iouSnapshot(), iouBefore.rows);
    await identity(creator);
    assert.deepEqual(
      await mutate(board.id, {
        type: 'reorder_columns',
        columnIds: ['todo', 'doing', 'done'],
      }),
      saved,
    );
    const reordered = await mutate(board.id, {
      type: 'reorder_columns',
      columnIds: ['done', 'todo', 'doing'],
    });
    assert.equal(reordered.title, saved.title);
    assert.equal(reordered.invite_code, saved.invite_code);
    assert.deepEqual(reordered.cards, saved.cards);
    assert.deepEqual(
      reordered.columns.map(({ id }) => id),
      ['done', 'todo', 'doing'],
    );
    await identity(stranger);
    await assert.rejects(
      mutate(board.id, { type: 'update_board', patch: { title: 'Stolen' } }),
      /PINBOARD_ACCESS_DENIED/,
    );
  });

  test('a refresh replaces an older result builder with an explicit list that keeps the previous result shape', async () => {
    await identity(creator);
    const board = await createBoard('Result shape');
    await database.exec('reset role');
    await database.exec(`create or replace function private.pinboard_board_json(p_board public.pinboard_boards)
      returns jsonb language sql immutable security invoker set search_path = '' as $$
        -- Model the old schema before optional settings and the computed summary count.
        select to_jsonb(p_board) - array['created_by', 'deleted_card_ids', 'deleted_column_ids', 'card_fields', 'active_card_count'];
      $$`);
    const volatility = async () =>
      (
        await database.query(
          "select provolatile from pg_proc where proname = 'pinboard_board_json'",
        )
      ).rows[0].provolatile;
    const shape = async () =>
      (
        await database.query(
          'select private.pinboard_board_json(b) as json from public.pinboard_boards b where id = $1',
          [board.id],
        )
      ).rows[0].json;
    assert.equal(await volatility(), 'i');
    const previous = await shape();
    await database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    assert.equal(await volatility(), 's');
    assert.deepEqual(await shape(), previous);
    assert.deepEqual(
      Object.keys(previous).sort(),
      [
        'id',
        'invite_code',
        'title',
        'description',
        'columns',
        'cards',
        'revision',
        'created_at',
        'updated_at',
      ].sort(),
    );
    const ownerAfter = await database.query(
      `select has_function_privilege('authenticated', 'private.pinboard_board_json(public.pinboard_boards)', 'execute') as executable`,
    );
    assert.equal(ownerAfter.rows[0].executable, false);
  });

  test('a table column added later never reaches RPC results', async () => {
    await identity(creator);
    const board = await createBoard('Future column');
    await database.exec('reset role');
    await database.exec(
      'alter table public.pinboard_boards add column archived_at timestamptz default now()',
    );
    try {
      await identity(creator);
      const edited = await mutate(board.id, {
        type: 'update_board',
        patch: { title: 'After the new column' },
      });
      const expected = [
        'id',
        'invite_code',
        'title',
        'description',
        'columns',
        'cards',
        'revision',
        'created_at',
        'updated_at',
      ].sort();
      assert.deepEqual(Object.keys(edited).sort(), expected);
      assert.deepEqual(Object.keys(await join(board.invite_code)).sort(), expected);
      assert.deepEqual(
        Object.keys(
          (
            await database.query('select public.pinboard_create_board($1::uuid, $2, $3) as board', [
              board.id,
              'Retry',
              '',
            ])
          ).rows[0].board,
        ).sort(),
        expected,
      );
      await database.exec('reset role');
      const row = (
        await database.query(
          'select to_jsonb(b) as row from public.pinboard_boards b where id = $1',
          [board.id],
        )
      ).rows[0].row;
      assert.ok('archived_at' in row, 'the added column exists in the table');
    } finally {
      await database.exec('reset role');
      await database.exec('alter table public.pinboard_boards drop column archived_at');
    }
  });
  test('members read only the public board columns directly, never created_by or receipts', async () => {
    await identity(creator);
    const board = await createBoard('Column grants');
    const allowed =
      'id, invite_code, title, description, columns, cards, revision, created_at, updated_at';
    const rows = (
      await database.query(`select ${allowed} from public.pinboard_boards where id = $1`, [
        board.id,
      ])
    ).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].id, board.id);
    for (const hidden of ['created_by', 'deleted_card_ids', 'deleted_column_ids']) {
      await assert.rejects(
        database.query(`select ${hidden} from public.pinboard_boards where id = $1`, [board.id]),
        /permission denied/,
        hidden,
      );
    }
    await assert.rejects(
      database.query('select * from public.pinboard_boards'),
      /permission denied/,
    );
    await identity(stranger);
    assert.deepEqual(
      (await database.query(`select ${allowed} from public.pinboard_boards`)).rows,
      [],
    );
  });

  test('a refresh narrows an older table-wide read grant and keeps the narrow one', async () => {
    await database.exec('reset role');
    const columnPrivileges = async () =>
      (
        await database.query(`
        select a.attname, has_column_privilege('authenticated', 'public.pinboard_boards', a.attname, 'select') as readable
        from pg_attribute a where a.attrelid = 'public.pinboard_boards'::regclass and a.attnum > 0 and not a.attisdropped
        order by a.attname`)
      ).rows;
    const expected = await columnPrivileges();
    assert.deepEqual(
      expected.filter((column) => !column.readable).map((column) => column.attname),
      ['created_by', 'deleted_card_ids', 'deleted_column_ids'],
    );
    await database.exec('grant select on public.pinboard_boards to authenticated');
    assert.ok(
      (await columnPrivileges()).every((column) => column.readable),
      'the old grant reads every column',
    );
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await database.exec(schema);
    assert.deepEqual(await columnPrivileges(), expected);
  });

  test('deletion receipts keep only the newest entries and a deleted card stays deleted for retries', async () => {
    await identity(creator);
    const board = await createBoard('Receipt bound');
    const columnTwo = { id: 'extra', title: 'Extra', color: 'slate' };
    await mutate(board.id, { type: 'add_column', column: columnTwo });
    await database.exec('reset role');
    // 1,200 old card receipts and 250 old column receipts, as a long-lived board would hold.
    await database.query(
      `update public.pinboard_boards set
         deleted_card_ids = array(select gen_random_uuid()::text from generate_series(1, 1200)),
         deleted_column_ids = array(select 'old' || n from generate_series(1, 250) n)
       where id = $1`,
      [board.id],
    );
    await identity(creator);
    const kept = card({ title: 'Delete me' });
    await mutate(board.id, { type: 'create_card', card: kept });
    await mutate(board.id, { type: 'delete_card', id: kept.id });
    await mutate(board.id, { type: 'delete_column', id: 'extra', targetColumnId: 'todo' });
    await database.exec('reset role');
    const receipts = (
      await database.query(
        'select deleted_card_ids, deleted_column_ids from public.pinboard_boards where id = $1',
        [board.id],
      )
    ).rows[0];
    assert.equal(receipts.deleted_card_ids.length, 1000);
    assert.equal(receipts.deleted_card_ids.at(-1), kept.id);
    assert.equal(receipts.deleted_column_ids.length, 200);
    assert.equal(receipts.deleted_column_ids.at(-1), 'extra');
    await identity(creator);
    // A retried creation inside the window is still ignored.
    const after = await mutate(board.id, { type: 'create_card', card: kept });
    assert.equal(after.cards.length, 0);
    assert.equal(
      (await mutate(board.id, { type: 'add_column', column: columnTwo })).columns.length,
      3,
    );
  });

  test('compact summaries maintain active counts without exposing card data or bypassing membership', async () => {
    await identity(creator);
    const board = await createBoard('Compact collection');
    const first = card();
    const archived = card({ archived: true });
    await mutate(board.id, { type: 'create_card', card: first });
    await mutate(board.id, { type: 'create_card', card: archived });
    const summary = async () =>
      (
        await database.query('select * from public.pinboard_board_summaries where id=$1', [
          board.id,
        ])
      ).rows;
    assert.equal((await summary())[0].active_card_count, 1);
    assert.equal('cards' in (await summary())[0], false);
    assert.equal('card_fields' in (await summary())[0], false);
    await mutate(board.id, { type: 'update_card', id: archived.id, patch: { archived: false } });
    assert.equal((await summary())[0].active_card_count, 2);
    await mutate(board.id, { type: 'delete_card', id: first.id });
    assert.equal((await summary())[0].active_card_count, 1);
    await mutate(board.id, { type: 'update_board', patch: { description: '😀'.repeat(400) } });
    assert.equal(Array.from((await summary())[0].description).length, 240);
    const sync = async (known) =>
      (
        await database.query('select public.pinboard_sync_summaries($1::jsonb) as result', [
          JSON.stringify(known),
        ])
      ).rows[0].result;
    const firstSync = await sync({});
    assert.equal(firstSync.format, 1);
    assert.ok(firstSync.boards.some((item) => item.id === board.id));
    assert.ok(firstSync.boards.every((item) => !('cards' in item)));
    const known = Object.fromEntries(firstSync.heads.map((head) => [head.id, head.revision]));
    assert.deepEqual((await sync(known)).boards, []);
    await mutate(board.id, { type: 'update_board', patch: { title: 'Changed summary' } });
    const changed = await sync(known);
    assert.equal(changed.boards.length, 1);
    assert.equal(changed.boards[0].id, board.id);
    await identity(stranger);
    assert.deepEqual(await summary(), []);
    assert.equal(
      (await sync(known)).heads.some((head) => head.id === board.id),
      false,
    );
    await identity(creator, 'anon');
    await assert.rejects(summary(), (error) => error.code === '42501');
    await assert.rejects(sync(known), (error) => error.code === '42501');
  });

  test('a board cannot grow past the size cap, but shrinking edits always work', async () => {
    await identity(creator);
    const board = await createBoard('Size cap');
    await database.exec('reset role');
    // 202 cards with 10,000-character descriptions: about 2.05 MB, over the cap.
    const cards = Array.from({ length: 202 }, (_, index) =>
      card({ position: 1000 * (index + 1), description: 'x'.repeat(10000) }),
    );
    await database.query('update public.pinboard_boards set cards = $2::jsonb where id = $1', [
      board.id,
      JSON.stringify(cards),
    ]);
    await identity(creator);
    await assert.rejects(
      mutate(board.id, { type: 'create_card', card: card() }),
      /PINBOARD_BOARD_TOO_LARGE/,
    );
    await assert.rejects(
      mutate(board.id, {
        type: 'update_card',
        id: cards[0].id,
        patch: { description: `${'y'.repeat(10000)}z` },
      }),
      /PINBOARD_INVALID_OPERATION/,
    );
    const revision = (
      await mutate(board.id, { type: 'update_board', patch: { title: 'Still editable' } })
    ).revision;
    const shrunk = await mutate(board.id, {
      type: 'update_card',
      id: cards[0].id,
      patch: { description: '' },
    });
    assert.equal(shrunk.revision, revision + 1);
    for (const old of cards.slice(1, 9))
      await mutate(board.id, { type: 'delete_card', id: old.id });
    // Back under the cap, a small card fits again.
    const added = await mutate(board.id, { type: 'create_card', card: card() });
    assert.equal(added.cards.length, 195);
  });
});
