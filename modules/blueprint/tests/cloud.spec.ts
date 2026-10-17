import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createBoard } from "../src/domain/boards/templates";
import { boardContent } from "../src/domain/boards/codec";
const userId = "11111111-1111-4111-8111-111111111111";
const invite = "a1".repeat(16);
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
async function signIn(page: Page) {
  await page.addInitScript(
    (value) => localStorage.setItem("blueprint-auth", JSON.stringify(value)),
    session(),
  );
}
async function mockCloud(
  page: Page,
  initiallyJoined = true,
  sharedId?: string,
) {
  const board = createBoard();
  if (sharedId) board.id = sharedId;
  const { title: _title, ...document } = JSON.parse(boardContent(board));
  const original = {
    id: board.id,
    title: "Saved production system",
    document,
    revision: 1,
    updated_at: new Date().toISOString(),
    invite_code: invite,
    sharing_version: 2,
  };
  const rows = [original];
  let joined = initiallyJoined;
  let forceConflict = false;
  let sessionCreates = 0;
  let joins = 0;
  let legacySchema = false;
  const writes: string[] = [];
  await page.route("https://blueprint-test.supabase.co/**", async (route) => {
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
      rows.push(created);
      await route.fulfill({ json: created });
      return;
    }
    if (request.method() === "PATCH") {
      writes.push("PATCH");
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const index = rows.findIndex((row) => row.id === id);
      if (
        forceConflict ||
        index < 0 ||
        url.searchParams.get("revision") !== `eq.${rows[index].revision}`
      ) {
        await route.fulfill({ json: [] });
        return;
      }
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
    useLegacySchema: () => {
      legacySchema = true;
    },
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

test("loads cloud boards and flushes edits to background boards after navigation", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./");
  await expect(page.locator(".board-title-button")).toHaveText(
    "Saved production system",
  );
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("button", { name: /A clean slate/ }).click();
  await page.getByRole("button", { name: "Open your boards" }).click();
  await page
    .locator(".board-card")
    .filter({ hasText: "Saved production system" })
    .locator("button")
    .first()
    .click();
  await expect.poll(() => cloud.rows.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "Saved to cloud", exact: true }),
  ).toBeVisible();
  const count = cloud.writes.length;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Saved to cloud", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(900);
  expect(cloud.writes.length).toBe(count);
});

test("renders an anonymous account with an empty email and creates one device session", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cloud = await mockCloud(page);
  await page.goto("./");
  await expect(page.locator(".board-title-button")).toHaveText(
    "Saved production system",
  );
  expect(cloud.sessionCreates).toBe(1);
  expect(errors).toEqual([]);
});

test("keeps conflicting changes as a new board instead of replacing cloud data", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./");
  await expect(page.locator(".board-title-button")).toHaveText(
    "Saved production system",
  );
  cloud.conflict();
  await page.getByTitle("Add Cache", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cloud needs attention", exact: true }),
  ).toBeVisible();
  expect(cloud.rows[0].document.nodes.length).toBe(9);
  await page
    .getByRole("button", { name: "Board settings", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Save my changes as a new board",
      exact: true,
    })
    .click();
  await expect.poll(() => cloud.rows.length).toBe(2);
  expect(cloud.rows[1].document.nodes.length).toBe(10);
  expect(cloud.rows[0].document.nodes.length).toBe(9);
});

test("simultaneous tabs share one fresh anonymous device identity", async ({
  page,
}) => {
  const other = await page.context().newPage();
  const firstCloud = await mockCloud(page);
  const secondCloud = await mockCloud(other);
  await Promise.all([page.goto("./"), other.goto("http://127.0.0.1:5194/")]);
  await expect(page.locator(".board-title-button")).toHaveText(
    "Saved production system",
  );
  await expect(other.locator(".board-title-button")).toHaveText(
    "Saved production system",
  );
  expect(firstCloud.sessionCreates + secondCloud.sessionCreates).toBe(1);
});

test("invitation links require Join and then allow editing without a separate credential", async ({
  page,
}) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  await page.goto("./#/join/" + invite);
  await expect(page.getByLabel("Invitation code or link")).toHaveValue(invite);
  await page.waitForTimeout(1000);
  expect(cloud.joins).toBe(0);
  expect(cloud.writes).toEqual([]);
  await page.getByRole("button", { name: "Join board", exact: true }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(8);
  await expect(page.getByTitle("Add Service", { exact: true })).toBeEnabled();
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  await page
    .getByRole("button", { name: "Board settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Everyone who joins with the invitation can edit",
  );
  await expect(
    page.getByRole("dialog").getByText(/edit token|read-only/i),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expect(page.getByLabel("Invitation code", { exact: true })).toHaveValue(
    invite,
  );
  await expect(page.getByRole("dialog")).toContainText("join and edit");
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveValue(
    new RegExp("#/join/" + invite),
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await expect(page.getByTitle("Add Service", { exact: true })).toBeEnabled();
});

test("removal shows the invitation and stays hidden through polling and reloads until explicit Join", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/boards");
  await expect(page.locator(".board-card")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Remove Saved production system from this device",
      exact: true,
    })
    .click();
  await expect(page.locator(".board-remove-note")).toContainText(invite);
  await page.getByRole("button", { name: "Remove?", exact: true }).click();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No boards yet", exact: true }),
  ).toBeVisible();
  expect(cloud.writes).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.reload();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await page.goto("./");
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Join board", exact: true }).click();
  await page.getByLabel("Invitation code or link").fill("0".repeat(32));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Join board", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Invitation not found");
  await expect(page.locator(".board-card")).toHaveCount(0);
  await page.getByLabel("Invitation code or link").fill(invite);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Join board", exact: true })
    .click();
  await expect(page.getByTitle("Add Service", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator(".board-card")).toHaveCount(1);
  expect(cloud.joins).toBe(2);
  expect(cloud.writes).toEqual([]);
});

test("removing in another tab preserves the open draft and hides the board on both home screens", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./");
  await expect(page.locator(".board-title-button")).toHaveText(
    "Saved production system",
  );
  const draft = page.getByRole("textbox", { name: "Description", exact: true });
  await draft.fill("An unsaved design decision");
  const other = await page.context().newPage();
  await mockCloud(other, true, cloud.rows[0].id);
  await other.goto("http://127.0.0.1:5194/#/boards");
  await other
    .getByRole("button", {
      name: "Remove Saved production system from this device",
      exact: true,
    })
    .click();
  await other.getByRole("button", { name: "Remove?", exact: true }).click();
  await expect(other.locator(".board-card")).toHaveCount(0);
  await expect(draft).toHaveValue("An unsaved design decision");
  await expect(page.locator(".architecture-node")).toHaveCount(9);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await other.getByRole("button", { name: "Join board", exact: true }).click();
  await other.getByLabel("Invitation code or link").fill(invite);
  await other
    .getByRole("dialog")
    .getByRole("button", { name: "Join board", exact: true })
    .click();
  await expect(page.locator(".board-card")).toHaveCount(1);
});

test("a failed removal preference write leaves the board visible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "blueprint.workspace.v1.removed")
        throw new Error("Browser storage unavailable");
      return original.call(this, key, value);
    };
  });
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/boards");
  await page
    .getByRole("button", {
      name: "Remove Saved production system from this device",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Remove?", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Browser storage unavailable",
  );
  await expect(page.locator(".board-card")).toHaveCount(1);
  expect(cloud.writes).toEqual([]);
  await page.reload();
  await expect(page.locator(".board-card")).toHaveCount(1);
});

test("an older database shows the migration requirement and never sends document writes", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  cloud.useLegacySchema();
  await signIn(page);
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Cloud needs attention", exact: true }),
  ).toBeVisible();
  await page.getByTitle("Add Service", { exact: true }).click();
  await page
    .getByRole("button", { name: "Board settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("rename-to-blueprint.sql");
  await page.waitForTimeout(1000);
  expect(cloud.writes).toEqual([]);
});

test("a schema mismatch discovered after loading cancels pending shared writes", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Saved to cloud", exact: true }),
  ).toBeVisible();
  await page.getByTitle("Add Service", { exact: true }).click();
  cloud.useLegacySchema();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTitle("Add Service", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Board settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("rename-to-blueprint.sql");
  await page.waitForTimeout(900);
  expect(cloud.writes).toEqual([]);
  expect(cloud.rows[0].document.nodes.length).toBe(9);
});
