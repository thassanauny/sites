import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";
import { createBoard } from "../../src/domain/boards/templates";
import { boardContent } from "../../src/domain/boards/codec";
import type { Board, DiagramEdge, DiagramNode } from "../../src/domain/boards/types";
const userId = "11111111-1111-4111-8111-111111111111";
export const invite = "a1".repeat(16);
const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "",
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
  user_metadata: {},
  created_at: new Date().toISOString(),
};
function session(id = userId) {
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
  return {
    access_token: jwt,
    refresh_token: "test-refresh",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { ...user, id },
  };
}
export async function signIn(page: Page) {
  await page.addInitScript(
    (value) => localStorage.setItem("blueprint-auth", JSON.stringify(value)),
    session(),
  );
}

export const collaborationUsers = {
  creator: userId,
  collaborator: "22222222-2222-4222-8222-222222222222",
};

type SharedDocument = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  description: string;
};
type SharedRow = {
  id: string;
  title: string;
  document: SharedDocument;
  revision: number;
  created_at: string;
  updated_at: string;
  invite_code: string;
  sharing_version: number;
};
type SharedWrite = {
  userId: string;
  boardId: string;
  expectedRevision: number | undefined;
  accepted: boolean;
  revision: number;
  document: SharedDocument;
};

/** One simulated server shared by genuinely separate browser profiles. */
export function collaborativeCloud(board: Board) {
  const { title, ...document } = JSON.parse(boardContent(board));
  const now = new Date().toISOString();
  const original: SharedRow = {
    id: board.id, title, document, revision: 1, created_at: now, updated_at: now,
    invite_code: invite, sharing_version: 2,
  };
  const rows = new Map([[original.id, original]]);
  const creators = new Map([[original.id, collaborationUsers.creator]]);
  const memberships = new Map([[original.id, new Set([collaborationUsers.creator])]]);
  const writes: SharedWrite[] = [];
  const sockets = new Set<{ socket: WebSocketRoute; userId: string; topic: string; joinRef: string | null }>();
  let gate: { remaining: number; arrived: number; released: Promise<void>; release: () => void } | undefined;

  const subject = (token: string | undefined) => {
    try { return JSON.parse(Buffer.from((token || "").replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub; }
    catch { return undefined; }
  };
  const notify = (row: SharedRow, onlyUser?: string) => {
    for (const socket of sockets) {
      if ((!onlyUser || socket.userId === onlyUser) && memberships.get(row.id)?.has(socket.userId))
        socket.socket.send(JSON.stringify([socket.joinRef, null, socket.topic, "broadcast", {
          event: "changed", type: "broadcast", payload: { id: row.id, revision: row.revision },
        }]));
    }
  };

  return {
    originalId: original.id,
    writes,
    board: (id = original.id) => structuredClone(rows.get(id)!),
    boards: () => structuredClone([...rows.values()]),
    members: (id = original.id) => [...memberships.get(id) ?? []],
    subscriptions: () => [...sockets].map(socket => socket.userId),
    holdNextSaves(count = 2) {
      let release!: () => void;
      const released = new Promise<void>(resolve => { release = resolve; });
      const held = { remaining: count, arrived: 0, released, release };
      gate = held;
      return { get arrived() { return held.arrived; }, release };
    },
    async attach(context: BrowserContext, id: string) {
      await context.addInitScript(value => localStorage.setItem("blueprint-auth", JSON.stringify(value)), session(id));
      await context.routeWebSocket(/\/realtime\/v1\/websocket/, socket => {
        let subscription: { socket: WebSocketRoute; userId: string; topic: string; joinRef: string | null } | undefined;
        socket.onMessage(message => {
          if (typeof message !== "string") return;
          const [joinRef, ref, topic, event, payload] = JSON.parse(message);
          const reply = (status = "ok") => socket.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status, response: {} }]));
          if (event === "phx_join") {
            if (topic !== `realtime:blueprint:user:${id}` || payload.config?.private !== true || subject(payload.access_token) !== id) {
              reply("error");
              return;
            }
            subscription = { socket, userId: id, topic, joinRef };
            sockets.add(subscription);
            reply();
          } else if (event === "phx_leave") {
            if (subscription) sockets.delete(subscription);
            reply();
          } else if (event === "heartbeat") reply();
        });
        socket.onClose(() => { if (subscription) sockets.delete(subscription); });
      });
      await context.route(/\/(?:auth|rest)\/v1\//, async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/auth/v1/user") { await route.fulfill({ json: { ...user, id } }); return; }
        if (url.pathname === "/auth/v1/token") { await route.fulfill({ json: session(id) }); return; }
        if (subject(request.headers().authorization) !== id) {
          await route.fulfill({ status: 401, json: { message: "Authenticated identity required" } }); return;
        }
        if (url.pathname === "/auth/v1/logout") { await route.fulfill({ status: 204, body: "" }); return; }
        const args = request.postDataJSON() || {};
        if (url.pathname.endsWith("/rpc/blueprint_sync_boards")) {
          const visible = [...rows.values()].filter(row => memberships.get(row.id)?.has(id));
          const changed = visible.filter(row => args.p_known?.[row.id] !== row.revision);
          await route.fulfill({ json: { sharing_version: 2, heads: visible.map(row => ({ id: row.id, revision: row.revision })), boards: changed } });
          return;
        }
        if (url.pathname.endsWith("/rpc/blueprint_join_board")) {
          const row = [...rows.values()].find(row => row.invite_code === args.p_code);
          if (!row) { await route.fulfill({ status: 404, json: { message: "Invitation not found" } }); return; }
          memberships.get(row.id)!.add(id);
          await route.fulfill({ json: row });
          notify(row, id);
          return;
        }
        if (url.pathname.endsWith("/rpc/blueprint_create_board")) {
          const existing = rows.get(args.p_id);
          if (existing && creators.get(existing.id) !== id) {
            await route.fulfill({ status: 403, json: { message: "Board creation denied" } }); return;
          }
          const created: SharedRow = existing ?? {
            ...original, id: args.p_id, title: args.p_title, document: structuredClone(args.p_document),
            revision: 1, invite_code: crypto.randomUUID().replaceAll("-", ""),
          };
          if (!existing) { rows.set(created.id, created); creators.set(created.id, id); memberships.set(created.id, new Set([id])); }
          await route.fulfill({ json: created });
          notify(created, id);
          return;
        }
        if (request.method() === "PATCH" && url.pathname.endsWith("/blueprint_boards")) {
          const boardId = url.searchParams.get("id")?.replace(/^eq\./, "") || "";
          const expected = url.searchParams.get("revision");
          const expectedRevision = expected === null ? undefined : Number(expected.replace(/^eq\./, ""));
          const held = gate;
          if (held && held.remaining > 0) { held.remaining--; held.arrived++; await held.released; }
          const row = rows.get(boardId);
          const accepted = Boolean(row && memberships.get(boardId)?.has(id) && (expectedRevision === undefined || expectedRevision === row.revision));
          if (accepted) Object.assign(row!, { title: args.title, document: structuredClone(args.document), revision: row!.revision + 1, updated_at: new Date().toISOString() });
          writes.push({ userId: id, boardId, expectedRevision, accepted, revision: row?.revision ?? 0, document: structuredClone(args.document) });
          await route.fulfill({ json: accepted ? [{ revision: row!.revision }] : [] });
          if (accepted) notify(row!);
          return;
        }
        await route.fulfill({ status: 403, json: { message: "Unsupported or unauthorized operation" } });
      });
    },
  };
}
export async function mockCloud(
  page: Page,
  initiallyJoined = true,
  sharedId?: string,
  title = "Saved production system",
) {
  const board = createBoard();
  if (sharedId) board.id = sharedId;
  const { title: _title, ...document } = JSON.parse(boardContent(board));
  const original = {
    id: board.id,
    title,
    document,
    revision: 1,
    updated_at: new Date().toISOString(),
    invite_code: invite,
    sharing_version: 2,
  };
  const rows = [original];
  let joined = initiallyJoined;
  let forceConflict = false;
  let rejectForce = false;
  let sessionCreates = 0;
  let joins = 0;
  let legacySchema = false;
  let loseCreateReply = false;
  let loseSaveReply = false;
  const polls: Record<string, number>[] = [];
  const downloaded: string[][] = [];
  const writes: string[] = [];
  // Browser fixtures keep the optional live transport offline; checked REST
  // polling remains active. The live protocol has separate mocked-client tests.
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, socket => socket.close());
  await page.route(/\/(?:auth|rest)\/v1\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/auth/v1/signup") {
      sessionCreates++;
      await route.fulfill({ json: session() });
      return;
    }
    if (path === "/auth/v1/user") {
      await route.fulfill({ json: user });
      return;
    }
    const args = request.postDataJSON() || {};
    if (path.endsWith("/rpc/blueprint_sync_boards")) {
      const visible = joined ? rows : [];
      polls.push(args.p_known ?? {});
      downloaded.push(visible.filter(row => args.p_known?.[row.id] !== row.revision).map(row => row.id));
      await route.fulfill({
        json: legacySchema
          ? visible
          : {
              sharing_version: 2,
              heads: visible.map((row) => ({
                id: row.id,
                revision: row.revision,
              })),
              boards: visible.filter(
                (row) => args.p_known?.[row.id] !== row.revision,
              ),
            },
      });
      return;
    }
    if (path.endsWith("/rpc/blueprint_join_board")) {
      joins++;
      if (args.p_code !== invite) {
        await route.fulfill({
          status: 404,
          json: { message: "Invitation not found" },
        });
        return;
      }
      joined = true;
      await route.fulfill({ json: original });
      return;
    }
    if (path.endsWith("/rpc/blueprint_create_board")) {
      writes.push("CREATE");
      const created = {
        ...original,
        id: args.p_id,
        title: args.p_title,
        document: args.p_document,
        revision: 1,
        invite_code: "d4".repeat(16),
      };
      const existing = rows.find((row) => row.id === args.p_id);
      if (!existing) rows.push(created);
      if (loseCreateReply) {
        loseCreateReply = false;
        await route.fulfill({ status: 400, json: { message: "Create response lost" } });
      } else await route.fulfill({ json: existing || created });
      return;
    }
    if (request.method() === "PATCH") {
      writes.push("PATCH");
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const index = rows.findIndex((row) => row.id === id);
      const forced = !url.searchParams.has("revision");
      if (forced && rejectForce) {
        await route.fulfill({ status: 403, json: { message: "Board access denied" } });
        return;
      }
      if (
        (!forced && forceConflict) ||
        index < 0 ||
        (!forced && url.searchParams.get("revision") !== `eq.${rows[index].revision}`)
      ) {
        await route.fulfill({ json: [] });
        return;
      }
      if (forced) forceConflict = false;
      Object.assign(rows[index], args, { revision: rows[index].revision + 1 });
      if (loseSaveReply) {
        loseSaveReply = false;
        await route.fulfill({ status: 400, json: { message: "Save response lost" } });
      } else await route.fulfill({ json: [{ revision: rows[index].revision }] });
      return;
    }
    if (request.method() === "DELETE") {
      writes.push("DELETE");
      await route.fulfill({
        status: 403,
        json: { message: "Shared boards cannot be deleted" },
      });
      return;
    }
    await route.fulfill({
      status: 400,
      json: { message: "Unexpected request " + path },
    });
  });
  return {
    rows,
    writes,
    polls,
    downloaded,
    loseNextSaveReply: () => { loseSaveReply = true; },
    loseNextCreateReply: () => { loseCreateReply = true; },
    useLegacySchema: () => {
      legacySchema = true;
    },
    rejectForce: () => { rejectForce = true; },
    conflict: () => {
      forceConflict = true;
    },
    get joins() {
      return joins;
    },
    get sessionCreates() {
      return sessionCreates;
    },
  };
}
