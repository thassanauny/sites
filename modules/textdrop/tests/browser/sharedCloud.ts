import { createHash, randomUUID } from 'node:crypto';
import type { BrowserContext, WebSocketRoute } from '@playwright/test';
import type { TextDropPage } from '../../src/domain/snippets/model';

export const identities = {
  alice: '11111111-1111-4111-8111-111111111111',
  bob: '22222222-2222-4222-8222-222222222222',
  outsider: '33333333-3333-4333-8333-333333333333',
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const subject = (token?: string) => {
  try {
    return JSON.parse(Buffer.from((token ?? '').replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).sub as string;
  } catch {
    return undefined;
  }
};
function session(id: string) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const jwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: expires })).toString('base64url'),
    'fixture-signature',
  ].join('.');
  return {
    access_token: jwt,
    refresh_token: `fixture-refresh-${id}`,
    token_type: 'bearer',
    expires_at: expires,
    expires_in: 3600,
    user: { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, email: '', app_metadata: { provider: 'anonymous' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
type SaveArgs = { p_id: string; p_text: string; p_expected: number; p_base_hash: string; p_operation_id: string };
type Gate = { remaining: number; arrived: number; promise: Promise<void>; release: () => void };

/** A shared simulated server; isolated browser profiles run the real app and SDK. SQL is tested separately. */
export function sharedCloud() {
  const rows = new Map<string, TextDropPage>();
  const members = new Map<string, Set<string>>();
  const receipts = new Map<string, { args: SaveArgs; user: string; result: Omit<TextDropPage, 'text'> }>();
  const sockets = new Set<{ socket: WebSocketRoute; user: string; topic: string; joinRef: string | null }>();
  const writes: { user: string; page: string; text: string; accepted: boolean; version: number; operation: string }[] = [];
  const joins: { user: string; page: string }[] = [];
  let beforeSave: Gate | undefined;
  let beforeReply: Gate | undefined;
  const receipt = ({ text: _text, ...page }: TextDropPage) => page;
  const notify = (page: TextDropPage) => {
    for (const listener of sockets)
      if (members.get(page.id)?.has(listener.user))
        listener.socket.send(JSON.stringify([listener.joinRef, null, listener.topic, 'broadcast', { type: 'broadcast', event: 'changed', payload: { id: page.id, version: page.version } }]));
  };
  const gate = (phase: 'save' | 'reply', count: number) => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => {
      release = resolve;
    });
    const held: Gate = { remaining: count, arrived: 0, promise, release };
    if (phase === 'save') beforeSave = held;
    else beforeReply = held;
    return {
      get arrived() {
        return held.arrived;
      },
      release,
    };
  };
  const wait = async (held: Gate | undefined) => {
    if (held && held.remaining > 0) {
      held.remaining--;
      held.arrived++;
      await held.promise;
    }
  };
  return {
    writes,
    joins,
    seed(text = 'First line\nSecond line') {
      const id = randomUUID();
      const page: TextDropPage = { id, code: hash(id).slice(0, 32), name: null, text, version: 1, updatedAt: new Date().toISOString() };
      rows.set(id, page);
      members.set(id, new Set([identities.alice]));
      return structuredClone(page);
    },
    page: (id: string) => structuredClone(rows.get(id)!),
    members: (id: string) => [...(members.get(id) ?? [])],
    subscriptions: () => [...sockets].map(row => row.user),
    holdSaves: (count = 2) => gate('save', count),
    holdReplies: (count = 1) => gate('reply', count),
    async attach(context: BrowserContext, id: string) {
      await context.addInitScript(value => localStorage.setItem('textdrop-auth', JSON.stringify(value)), session(id));
      await context.routeWebSocket(/\/realtime\/v1\/websocket/, socket => {
        let joined: { socket: WebSocketRoute; user: string; topic: string; joinRef: string | null } | undefined;
        socket.onMessage(message => {
          if (typeof message !== 'string') return;
          const [joinRef, ref, topic, event, payload] = JSON.parse(message);
          const reply = (status = 'ok') => socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status, response: {} }]));
          if (event === 'phx_join') {
            if (topic !== `realtime:textdrop:user:${id}` || payload.config?.private !== true || subject(payload.access_token) !== id) {
              reply('error');
              return;
            }
            joined = { socket, user: id, topic, joinRef };
            sockets.add(joined);
            reply();
          } else if (event === 'phx_leave') {
            if (joined) sockets.delete(joined);
            reply();
          } else if (event === 'heartbeat') reply();
        });
        socket.onClose(() => {
          if (joined) sockets.delete(joined);
        });
      });
      await context.route(/\/(?:auth|rest)\/v1\//, async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/auth/v1/user') {
          await route.fulfill({ json: session(id).user });
          return;
        }
        if (url.pathname === '/auth/v1/token') {
          await route.fulfill({ json: session(id) });
          return;
        }
        if (subject(request.headers().authorization) !== id) {
          await route.fulfill({ status: 401, json: { message: 'TEXTDROP_AUTH_REQUIRED' } });
          return;
        }
        const args = request.postDataJSON() ?? {};
        const rpc = url.pathname.split('/').at(-1);
        if (rpc === 'textdrop_create_page') {
          const page = rows.get(args.p_id) ?? { id: args.p_id, code: hash(args.p_id).slice(0, 32), name: null, text: '', version: 1, updatedAt: new Date().toISOString() };
          if (rows.has(page.id) && !members.get(page.id)?.has(id)) {
            await route.fulfill({ status: 403, json: { message: 'TEXTDROP_ACCESS_DENIED' } });
            return;
          }
          rows.set(page.id, page);
          if (!members.has(page.id)) members.set(page.id, new Set([id]));
          await route.fulfill({ json: page });
          return;
        }
        if (rpc === 'textdrop_join_page') {
          const page = [...rows.values()].find(row => row.code === args.p_code);
          if (!page) {
            await route.fulfill({ status: 404, json: { message: 'TEXTDROP_INVALID_CODE' } });
            return;
          }
          members.get(page.id)!.add(id);
          joins.push({ user: id, page: page.id });
          await route.fulfill({ json: page });
          return;
        }
        if (rpc === 'textdrop_names') {
          await route.fulfill({ json: [...rows.values()].filter(row => members.get(row.id)?.has(id) && args.p_codes.includes(row.code)).map(({ code, name, version }) => ({ code, name, version })) });
          return;
        }
        const page = rows.get(args.p_id);
        if (!page || !members.get(page.id)?.has(id)) {
          await route.fulfill({ status: 403, json: { message: 'TEXTDROP_ACCESS_DENIED' } });
          return;
        }
        if (rpc === 'textdrop_poll_page') {
          await route.fulfill({ json: args.p_known === page.version ? { id: page.id, version: page.version, unchanged: true } : page });
          return;
        }
        if (rpc === 'textdrop_save_checked') {
          await wait(beforeSave);
          const saved = receipts.get(`${page.id}:${args.p_operation_id}`);
          if (saved) {
            if (saved.user !== id || JSON.stringify(saved.args) !== JSON.stringify(args)) {
              await route.fulfill({ status: 400, json: { message: 'TEXTDROP_INVALID_SAVE' } });
              return;
            }
            await route.fulfill({ json: saved.result });
            return;
          }
          const accepted = args.p_expected <= page.version && (args.p_expected === page.version || hash(page.text) === args.p_base_hash || page.text === args.p_text);
          writes.push({ user: id, page: page.id, text: args.p_text, accepted, version: page.version, operation: args.p_operation_id });
          if (!accepted) {
            await route.fulfill({ json: { conflict: page } });
            return;
          }
          if (page.text !== args.p_text) {
            page.text = args.p_text;
            page.version++;
            page.updatedAt = new Date().toISOString();
          }
          const result = structuredClone(receipt(page));
          receipts.set(`${page.id}:${args.p_operation_id}`, { args: structuredClone(args), user: id, result });
          notify(page);
          await wait(beforeReply);
          await route.fulfill({ json: result });
          return;
        }
        if (rpc === 'textdrop_rename_checked') {
          const name = args.p_name?.trim() || null;
          if (page.name !== name) {
            page.name = name;
            page.version++;
            page.updatedAt = new Date().toISOString();
          }
          notify(page);
          await route.fulfill({ json: args.p_text_hash === hash(page.text) ? receipt(page) : page });
          return;
        }
        await route.fulfill({ status: 403, json: { message: 'Unsupported fixture operation' } });
      });
    },
  };
}
