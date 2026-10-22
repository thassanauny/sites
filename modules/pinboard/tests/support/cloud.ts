import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { BrowserContext, WebSocketRoute } from '@playwright/test';
import type { Board, Card, Operation } from '../../src/domain/boards/types';

export const users = {
  creator: '11111111-1111-4111-8111-111111111111',
  collaborator: '22222222-2222-4222-8222-222222222222',
  outsider: '33333333-3333-4333-8333-333333333333',
};
export const cardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const otherCardId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cloudOrigin = 'https://pinboard-test.supabase.co';
const columns =
  'id,invite_code,title,description,columns,cards,revision,created_at,updated_at,card_fields';

function session(id: string) {
  const user = {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    is_anonymous: true,
    app_metadata: { provider: 'anonymous' },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const payload = {
    sub: id,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return {
    access_token: `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`,
    refresh_token: `fixture-refresh-${id}`,
    expires_in: 3600,
    expires_at: payload.exp,
    token_type: 'bearer',
    user,
  };
}

function subject(token: string | undefined): string | undefined {
  try {
    return JSON.parse(
      Buffer.from((token ?? '').replace(/^Bearer /, '').split('.')[1]!, 'base64url').toString(),
    ).sub;
  } catch {
    return undefined;
  }
}

interface Gate {
  user: string;
  phase: 'request' | 'response' | 'read';
  remaining: number;
  arrived: number;
  loseReply: boolean;
  promise: Promise<void>;
  release: () => void;
}
interface Write {
  user: string;
  boardId: string;
  operationId: string;
  operation: Operation | { type: 'replace_board'; board: unknown };
  baseRevision: number;
  revision?: number;
  error?: string;
}
interface Socket {
  socket: WebSocketRoute;
  user: string;
  topic: string;
  joinRef: string | null;
}

/** Real app SQL/RLS behind simulated HTTP/auth/Broadcast transports, with separate browser profiles. */
export async function createCloud() {
  const database = new PGlite();
  await database.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const id of Object.values(users))
    await database.query('insert into auth.users values ($1)', [id]);
  await database.exec(
    await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'),
  );

  // PGlite has one connection. Serialize role changes with the statement so one
  // browser's request can never run using another browser's fixture identity.
  let tail: Promise<unknown> = Promise.resolve();
  function run<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  }
  async function query<T>(user: string | null, sql: string, args: unknown[] = []): Promise<T[]> {
    return run(async () => {
      await database.exec('reset role');
      if (user) {
        await database.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
        await database.exec('set role authenticated');
      }
      try {
        return (await database.query<T>(sql, args)).rows;
      } finally {
        await database.exec('reset role');
      }
    });
  }
  const boardId = randomUUID();
  const independentId = randomUUID();
  for (const [id, title] of [
    [boardId, 'Shared project'],
    [independentId, 'Independent project'],
  ]) {
    await query(users.creator, 'select public.pinboard_create_board($1, $2, $3)', [
      id,
      title,
      'Collaboration fixture',
    ]);
  }
  for (const [id, title] of [
    [cardId, 'First task'],
    [otherCardId, 'Second task'],
  ]) {
    const card: Card = {
      id: id!,
      title: title!,
      description: 'Original description',
      columnId: 'todo',
      position: id === cardId ? 1024 : 2048,
      priority: 'medium',
      assignee: '',
      dueDate: '',
      labels: [],
    };
    await query(users.creator, 'select public.pinboard_mutate_board_once($1, $2, $3, null)', [
      boardId,
      randomUUID(),
      JSON.stringify({ type: 'create_card', card }),
    ]);
  }
  const board = async (id: string = boardId) =>
    (
      await query<{ board: Board }>(
        null,
        'select private.pinboard_board_json(b) as board from public.pinboard_boards b where id=$1',
        [id],
      )
    )[0]!.board;
  const original = await board();
  const writes: Write[] = [];
  const joins: string[] = [];
  const polls: { user: string; known: Record<string, number> }[] = [];
  const sockets = new Set<Socket>();
  const gates: Gate[] = [];
  const unhandled: string[] = [];
  async function notify(id: string = boardId) {
    const row = await board(id);
    const members = await query<{ user_id: string }>(
      null,
      'select user_id from public.pinboard_board_access where board_id=$1',
      [id],
    );
    for (const socket of sockets) {
      if (members.some((member) => member.user_id === socket.user)) {
        socket.socket.send(
          JSON.stringify([
            socket.joinRef,
            null,
            socket.topic,
            'broadcast',
            { type: 'broadcast', event: 'board_changed', payload: { id, revision: row.revision } },
          ]),
        );
      }
    }
  }
  async function waitAt(user: string, phase: Gate['phase']) {
    const gate = gates.find(
      (value) => value.user === user && value.phase === phase && value.remaining > 0,
    );
    if (gate) {
      gate.remaining--;
      gate.arrived++;
      await gate.promise;
    }
    return gate;
  }
  return {
    boardId,
    independentId,
    original,
    writes,
    joins,
    polls,
    unhandled,
    board,
    subscriptions: () => [...sockets].map((socket) => socket.user),
    releaseAll() {
      for (const gate of gates) gate.release();
    },
    hold(user: string, phase: Gate['phase'] = 'request', count = 1, loseReply = false) {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gate: Gate = { user, phase, remaining: count, arrived: 0, loseReply, promise, release };
      gates.push(gate);
      return {
        get arrived() {
          return gate.arrived;
        },
        release,
      };
    },
    async expireReceipts() {
      await query(null, 'delete from private.pinboard_operation_receipts where board_id=$1', [
        boardId,
      ]);
      await query(
        null,
        'update public.pinboard_boards set operation_receipt_floor=revision, revision=revision+1 where id=$1',
        [boardId],
      );
      await notify();
    },
    async revoke(user: string) {
      await query(
        null,
        'delete from public.pinboard_board_access where board_id=$1 and user_id=$2',
        [boardId, user],
      );
    },
    async members() {
      return (
        await query<{ user_id: string }>(
          null,
          'select user_id from public.pinboard_board_access where board_id=$1',
          [boardId],
        )
      ).map((row) => row.user_id);
    },
    async close() {
      for (const gate of gates) gate.release();
      await tail;
      await database.close();
    },
    async attach(context: BrowserContext, user: string) {
      await context.addInitScript((value) => {
        if (location.hostname !== '127.0.0.1') return;
        // Seed only a fresh profile; reload must keep the app's actual saved identity.
        if (!localStorage.getItem('pinboard-auth'))
          localStorage.setItem('pinboard-auth', JSON.stringify(value));
      }, session(user));
      await context.routeWebSocket(
        `${cloudOrigin.replace('https:', 'wss:')}/realtime/v1/websocket*`,
        (socket) => {
          let subscription: Socket | undefined;
          socket.onMessage((message) => {
            if (typeof message !== 'string') return;
            const [joinRef, ref, topic, event, payload] = JSON.parse(message);
            const reply = (status = 'ok') =>
              socket.send(
                JSON.stringify([joinRef, ref, topic, 'phx_reply', { status, response: {} }]),
              );
            if (event === 'phx_join') {
              if (
                topic !== `realtime:pinboard:user:${user}` ||
                payload.config?.private !== true ||
                subject(payload.access_token) !== user
              ) {
                reply('error');
                return;
              }
              subscription = { socket, user, topic, joinRef };
              sockets.add(subscription);
              reply();
            } else if (event === 'phx_leave') {
              if (subscription) sockets.delete(subscription);
              reply();
            } else if (event === 'heartbeat') reply();
          });
          socket.onClose(() => {
            if (subscription) sockets.delete(subscription);
          });
        },
      );
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname === '127.0.0.1') {
          await route.continue();
          return;
        }
        if (url.origin !== cloudOrigin) {
          unhandled.push(request.url());
          await route.abort();
          return;
        }
        const fulfill = (json: unknown, status = 200) =>
          route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*' } });
        if (url.pathname === '/auth/v1/user') {
          await fulfill(session(user).user);
          return;
        }
        if (url.pathname === '/auth/v1/token') {
          await fulfill(session(user));
          return;
        }
        if (subject(request.headers().authorization) !== user) {
          await fulfill({ code: 'PGRST301', message: 'PINBOARD_AUTH_REQUIRED' }, 401);
          return;
        }
        const args = request.postDataJSON() ?? {};
        try {
          if (url.pathname === '/rest/v1/rpc/pinboard_sync_summaries') {
            await waitAt(user, 'read');
            polls.push({ user, known: args.p_known });
            const rows = await query<{ result: unknown }>(
              user,
              'select public.pinboard_sync_summaries($1::jsonb) as result',
              [JSON.stringify(args.p_known)],
            );
            await fulfill(rows[0]!.result);
            return;
          }
          if (url.pathname === '/rest/v1/pinboard_board_documents' && request.method() === 'GET') {
            await waitAt(user, 'read');
            const id = url.searchParams
              .get('id')
              ?.replace(/^in\.\("?/, '')
              .replace(/"?\)$/, '');
            if (url.searchParams.get('select') !== columns)
              throw new Error('Unexpected board projection');
            await fulfill(
              await query(
                user,
                `select ${columns} from public.pinboard_board_documents where id=$1`,
                [id],
              ),
            );
            return;
          }
          if (url.pathname === '/rest/v1/rpc/pinboard_join_board') {
            const rows = await query<{ board: Board }>(
              user,
              'select public.pinboard_join_board($1) as board',
              [args.p_code],
            );
            joins.push(user);
            await fulfill(rows[0]!.board);
            await notify(rows[0]!.board.id);
            return;
          }
          if (url.pathname === '/rest/v1/rpc/pinboard_copy_board') {
            await waitAt(user, 'request');
            const rows = await query<{ board: Board }>(
              user,
              'select public.pinboard_copy_board($1,$2::jsonb) board',
              [args.p_id, JSON.stringify(args.p_board)],
            );
            await notify(rows[0]!.board.id);
            const gate = await waitAt(user, 'response');
            if (gate?.loseReply) await route.abort('failed');
            else await fulfill(rows[0]!.board);
            return;
          }
          if (
            url.pathname === '/rest/v1/rpc/pinboard_mutate_board_once' ||
            url.pathname === '/rest/v1/rpc/pinboard_force_board_once'
          ) {
            const force = url.pathname.endsWith('/pinboard_force_board_once');
            await waitAt(user, 'request');
            const write: Write = {
              user,
              boardId: args.p_board_id,
              operationId: args.p_operation_id,
              operation: force ? { type: 'replace_board', board: args.p_board } : args.p_operation,
              baseRevision: args.p_base_revision,
            };
            writes.push(write);
            try {
              const rows = await query<{ board: Board }>(
                user,
                force
                  ? 'select public.pinboard_force_board_once($1,$2,$3::jsonb,$4::bigint) board'
                  : 'select public.pinboard_mutate_board_once($1, $2, $3::jsonb, $4::bigint) as board',
                [
                  write.boardId,
                  write.operationId,
                  JSON.stringify(force ? args.p_board : write.operation),
                  write.baseRevision,
                ],
              );
              write.revision = rows[0]!.board.revision;
              await notify(write.boardId);
              const gate = await waitAt(user, 'response');
              if (gate?.loseReply) await route.abort('failed');
              else await fulfill(rows[0]!.board);
            } catch (error) {
              write.error = error instanceof Error ? error.message : String(error);
              throw error;
            }
            return;
          }
          unhandled.push(request.url());
          await fulfill({ message: 'Unsupported fixture request' }, 400);
        } catch (error) {
          const failure = error as { code?: string; message?: string };
          await fulfill(
            { code: failure.code ?? 'P0001', message: failure.message ?? 'Fixture error' },
            400,
          );
        }
      });
    },
  };
}

export type LocalCloud = Awaited<ReturnType<typeof createCloud>>;
