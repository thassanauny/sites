import type { Page } from "@playwright/test";
import { createBoard } from "../../src/domain/boards/templates";
import { boardContent } from "../../src/domain/boards/codec";
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
function session() {
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
  return {
    access_token: jwt,
    refresh_token: "test-refresh",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
}
export async function signIn(page: Page) {
  await page.addInitScript(
    (value) => localStorage.setItem("blueprint-auth", JSON.stringify(value)),
    session(),
  );
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
  const writes: string[] = [];
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
      await route.fulfill({ json: [{ revision: rows[index].revision }] });
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
