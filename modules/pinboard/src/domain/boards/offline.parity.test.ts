import schema from '../../../supabase/schema.sql?raw';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { applyOfflineOperation } from './offline';
import { readBoard } from './board';
import type { Board, Operation } from './types';

it('projects every offline operation with the same content as the installed SQL functions', async () => {
  const database = new PGlite();
  const owner = crypto.randomUUID();
  const boardId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const fieldId = crypto.randomUUID();
  try {
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
    await database.query('insert into auth.users values ($1)', [owner]);
    await database.exec(schema);
    await database.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await database.exec('set role authenticated');
    const created = await database.query<{ board: Board }>(
      'select public.pinboard_create_board($1::uuid, $2, $3) as board',
      [boardId, 'Parity board', ''],
    );
    let board = readBoard(created.rows[0]!.board);
    const operations: Operation[] = [
      { type: 'update_board', patch: { title: 'Offline title', description: 'Kept' } },
      {
        type: 'update_board',
        patch: {
          card_fields: { hidden: [], custom: [{ id: fieldId, title: 'Estimate', hidden: false }] },
        },
      },
      { type: 'add_assignee', name: 'Tanvir' },
      {
        type: 'create_card',
        card: {
          id: cardId,
          title: 'Task',
          description: '',
          columnId: 'todo',
          position: 1024,
          priority: 'medium',
          assignee: 'Tanvir',
          dueDate: '',
          labels: [],
          customFields: { [fieldId]: 'One' },
        },
      },
      {
        type: 'update_card',
        id: cardId,
        patch: { description: 'Edited offline', customFields: { [fieldId]: 'Two' } },
      },
      { type: 'update_board', patch: { card_fields: { hidden: ['priority'], custom: [] } } },
      { type: 'add_column', column: { id: 'review', title: 'Review', color: 'violet' } },
      { type: 'update_column', id: 'review', patch: { title: 'Review queue', color: 'blue' } },
      { type: 'move_card', id: cardId, columnId: 'review', position: 2048 },
      { type: 'reorder_columns', columnIds: ['review', 'done', 'todo', 'doing'] },
      { type: 'update_card', id: cardId, patch: { archived: true } },
      { type: 'delete_assignee', name: 'Tanvir' },
      { type: 'delete_column', id: 'review', targetColumnId: 'done' },
      { type: 'delete_card', id: cardId },
    ];
    const content = ({
      revision: _revision,
      updated_at: _updated,
      localPending: _pending,
      ...value
    }: Board) => value;
    for (const operation of operations) {
      const local = applyOfflineOperation(board, operation);
      const result = await database.query<{ board: Board }>(
        'select public.pinboard_mutate_board_once($1::uuid,gen_random_uuid(),$2::jsonb,$3) as board',
        [boardId, JSON.stringify(operation), board.revision],
      );
      board = readBoard(result.rows[0]!.board);
      expect(content(local), operation.type).toEqual(content(board));
    }
  } finally {
    await database.close();
  }
}, 30_000);
