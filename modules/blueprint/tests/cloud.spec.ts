import { expect, test, type Page } from "@playwright/test";
import { invite, signIn, mockCloud } from "./support/cloud";

async function openProperties(page: Page) {
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
}

test('centers one divided bottom dock without overlapping its control groups', async ({ page }) => {
  await mockCloud(page);
  await signIn(page);
  for (const width of [360, 768, 1440, 1800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./#/board/' + invite);
    await expect(page.locator('.footer-sync')).toHaveText(/^Synced \d{2}:\d{2} [AP]M$/);
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const tools = rect('.canvas-toolbar'), zoom = rect('.zoom-controls'), dock = rect('.canvas-dock'), canvas = rect('#main-content');
      const sidebar = rect('.sidebar'), sync = rect('.footer-sync');
      return { sidebarVisible: sidebar.width > 0, seamOffset: sync.right - sidebar.right, centerOffset: (dock.left + dock.width / 2) - (canvas.left + canvas.width / 2), divider: rect('.dock-divider').width > 0, gap: canvas.bottom - dock.bottom, footerTextTop: rect('.app-version').top + 10, dockBottom: dock.bottom,
        overlap: tools.left < zoom.right && tools.right > zoom.left && tools.top < zoom.bottom && tools.bottom > zoom.top,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(layout.centerOffset).toBeCloseTo(0, 0);
    expect(layout.divider).toBe(true);
    if (width > 760 && layout.sidebarVisible) expect(layout.seamOffset).toBeCloseTo(0, 0);
    expect(layout.gap).toBeCloseTo(-8, 0);
    expect(layout.dockBottom).toBeLessThan(layout.footerTextTop);
    expect(layout.overlap).toBe(false);
    expect(layout.overflow).toBe(false);
  }
});

test("loads cloud boards and flushes edits to background boards after navigation", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".header-board-title")).toHaveText(
    "Saved production system",
  );
  await expect(page.locator('.footer-sync')).toHaveText(/^Synced \d{2}:\d{2} [AP]M$/);
  await expect(page.locator('.app-version')).toContainText('blueprint ·');
  await expect(page.locator('.sidebar-footer .footer-board-change')).toContainText('Last board change:');
  await expect(page.locator('.sidebar-footer .footer-board-change time')).toHaveAttribute('datetime', cloud.rows[0].updated_at);
  await expect(page.locator('.react-flow__attribution')).toHaveCount(0);
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator('.footer-sync')).toHaveText(/^Synced \d{2}:\d{2} [AP]M$/);
  await expect(page.locator('.sidebar-footer .footer-board-change')).toHaveCount(0);
  await page.getByRole("button", { name: "Create a board", exact: true }).click();
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
    page.locator(".connection").filter({ hasText: "Connected" }),
  ).toBeVisible();
  const count = cloud.writes.length;
  await page.reload();
  await expect(
    page.locator(".connection").filter({ hasText: "Connected" }),
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
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".header-board-title")).toHaveText(
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
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".header-board-title")).toHaveText(
    "Saved production system",
  );
  cloud.conflict();
  await page.getByTitle("Add Cache", { exact: true }).click();
  await expect(
    page.locator(".connection").filter({ hasText: "Needs attention" }),
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
  await Promise.all([
    page.goto("./#/board/" + invite),
    other.goto("http://127.0.0.1:5194/#/board/" + invite),
  ]);
  await expect(page.locator(".header-board-title")).toHaveText(
    "Saved production system",
  );
  await expect(other.locator(".header-board-title")).toHaveText(
    "Saved production system",
  );
  expect(firstCloud.sessionCreates + secondCloud.sessionCreates).toBe(1);
});

test("legacy invitation links ask for Join first and allow editing without a separate credential", async ({
  page,
}) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  await page.goto("./#/join/" + invite);
  await expect(page.getByLabel("Invitation code or link")).toHaveValue(invite);
  expect(cloud.joins).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Join board", exact: true }).click();
  expect(cloud.writes).toEqual([]);
  await expect(page.locator(".react-flow__edge")).toHaveCount(8);
  await expect(page.getByTitle("Add Service", { exact: true })).toBeEnabled();
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  await page
    .getByRole("button", { name: "Board settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Anyone with the invitation can edit",
  );
  await expect(
    page.getByRole("dialog").getByText(/edit token|read-only/i),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByLabel("Invitation code", { exact: true })).toHaveValue(
    invite,
  );
  await expect(page.getByRole("dialog")).toContainText("join and edit");
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveValue(
    new RegExp("#/board/" + invite),
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await expect(page.getByTitle("Add Service", { exact: true })).toBeEnabled();
});

test("removal stays hidden on the homepage and a confirmed rejoin restores it to the homepage", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/boards");
  await expect(page.locator(".board-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Open Saved production system", exact: true }).click();
  await page.getByRole("button", { name: "Board settings", exact: true }).click();
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await expect(page.getByLabel("Invitation code", { exact: true })).toHaveValue(invite);
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No boards yet", exact: true }),
  ).toBeVisible();
  expect(cloud.writes).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.reload();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await page.goto("./#/board/" + invite);
  await expect(page.getByLabel("Invitation code or link")).toHaveValue(invite);
  expect(cloud.joins).toBe(0);
  await expect(page.locator(".board-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".board-card")).toHaveCount(0);
  expect(cloud.joins).toBe(0);
  await page.goto("./#/board/" + invite);
  await expect(page.getByLabel("Invitation code or link")).toHaveValue(invite);
  await page.getByRole("dialog").getByRole("button", { name: "Join board", exact: true }).click();
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".board-card")).toHaveCount(1);
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/board\//);
  expect(cloud.joins).toBe(1);
  expect(cloud.writes).toEqual([]);
});

test("removing in another tab preserves the open draft and hides the board on both home screens", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".header-board-title")).toHaveText(
    "Saved production system",
  );
  await openProperties(page);
  const draft = page.getByRole("textbox", { name: "Description", exact: true });
  await draft.fill("An unsaved design decision");
  const other = await page.context().newPage();
  await mockCloud(other, true, cloud.rows[0].id);
  await other.goto("http://127.0.0.1:5194/#/boards");
  await other.getByRole("button", { name: "Open Saved production system", exact: true }).click();
  await other.getByRole("button", { name: "Board settings", exact: true }).click();
  await other.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await other.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await expect(other.locator(".board-card")).toHaveCount(0);
  await expect(draft).toHaveValue("An unsaved design decision");
  await expect(page.locator(".architecture-node")).toHaveCount(9);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await other.getByRole("button", { name: "Join a board", exact: true }).click();
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
  await page.getByRole("button", { name: "Open Saved production system", exact: true }).click();
  await page.getByRole("button", { name: "Board settings", exact: true }).click();
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Browser storage unavailable",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open your boards", exact: true }).click();
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
  await page.goto("./#/board/" + invite);
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.locator(".architecture-node")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("rename-to-blueprint.sql");
  await page.waitForTimeout(1000);
  expect(cloud.writes).toEqual([]);
});

test("a schema mismatch discovered after loading cancels pending shared writes", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(
    page.locator(".connection").filter({ hasText: "Connected" }),
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

test("a fresh workspace stays empty and generic board routes never open a board", async ({ page }) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  for (const path of ["./", "./#/board", "./#/board/", "./#/editor"]) {
    await page.goto(path);
    await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
    await expect(page.locator(".board-card")).toHaveCount(0);
    await expect(page.locator(".react-flow")).toHaveCount(0);
  }
  expect(cloud.writes).toEqual([]);
  await page.getByRole("button", { name: "Create a board", exact: true }).click();
  await page.getByRole("button", { name: /A clean slate/ }).click();
  await expect(page).toHaveURL(/#\/board\/d4/);
  await expect(page.getByRole("button", { name: "Invite" })).toBeVisible();
  expect(cloud.writes).toEqual(["CREATE"]);
});

test("a board link asks a new device to Join without creating another board", async ({ page }) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.getByLabel("Invitation code or link")).toHaveValue(invite);
  expect(cloud.joins).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Join board", exact: true }).click();
  await expect(page.locator(".header-board-title")).toHaveText("Saved production system");
  await expect(page.locator(".architecture-node")).toHaveCount(9);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(cloud.joins).toBe(1);
  expect(cloud.writes).toEqual([]);
});

test("retrying creation after a lost response reuses the same board", async ({ page }) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "No boards yet", exact: true })).toBeVisible();
  cloud.loseNextCreateReply();
  await page.getByRole("button", { name: "Create a board", exact: true }).click();
  const template = page.getByRole("button", { name: /A clean slate/ });
  await template.click();
  await expect(page.getByText("Create response lost", { exact: true })).toBeVisible();
  expect(cloud.rows).toHaveLength(2);
  const createdId = cloud.rows[1].id;
  await template.click();
  await expect(page).toHaveURL(/#\/board\/d4/);
  expect(cloud.rows).toHaveLength(2);
  expect(cloud.rows[1].id).toBe(createdId);
});

test("an invalid invitation keeps the Join prompt available for correction", async ({ page }) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  await page.goto("./#/board/" + "0".repeat(32));
  await expect(page.getByLabel("Invitation code or link")).toHaveValue("0".repeat(32));
  expect(cloud.joins).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Join board", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invitation not found");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Invitation code or link").fill(invite);
  await page.getByRole("dialog").getByRole("button", { name: "Join board", exact: true }).click();
  await expect(page.locator(".header-board-title")).toHaveText("Saved production system");
});

test('edits cached boards offline and automatically saves them after reconnecting', async ({ page, context }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto('./#/board/' + invite);
  await expect(page.locator('.header-board-title')).toHaveText('Saved production system');
  await expect(page.locator('.connection')).toHaveText('Connected');
  await context.setOffline(true);
  await page.getByTitle('Add Cache', { exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(10);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('blueprint.workspace.v1') || '{}').boards?.[0]?.nodes.length)).toBe(10);
  expect(cloud.rows[0].document.nodes.length).toBe(9);
  await context.setOffline(false);
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  await expect(page.locator('.connection')).toHaveText('Connected');
});


test("force sync requires confirmation, keeps the board identity, and resumes normal saves", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  cloud.conflict();
  await page.getByTitle("Add Cache", { exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Needs attention");
  const id = cloud.rows[0].id;
  await page.getByRole("button", { name: "Board settings", exact: true }).click();
  await page.getByRole("button", { name: "Force sync my changes", exact: true }).click();
  await expect(page.getByText(/Changes saved from other tabs or devices will be overwritten/)).toBeVisible();
  expect(cloud.rows[0].document.nodes).toHaveLength(9);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(cloud.rows[0].document.nodes).toHaveLength(9);
  await page.getByRole("button", { name: "Force sync my changes", exact: true }).click();
  await page.getByRole("button", { name: "Replace cloud board", exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  expect(cloud.rows).toHaveLength(1);
  expect(cloud.rows[0].id).toBe(id);
  expect(cloud.rows[0].invite_code).toBe(invite);
  await expect(page.getByRole("button", { name: "Force sync my changes", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(11);
  await page.reload();
  await expect(page.locator(".architecture-node")).toHaveCount(11);
});

test("a denied force sync retains the local draft and recovery actions", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  cloud.conflict();
  cloud.rejectForce();
  await page.getByTitle("Add Cache", { exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Needs attention");
  await page.getByRole("button", { name: "Board settings", exact: true }).click();
  await page.getByRole("button", { name: "Force sync my changes", exact: true }).click();
  await page.getByRole("button", { name: "Replace cloud board", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Board access denied");
  expect(cloud.rows[0].document.nodes).toHaveLength(9);
  await expect(page.getByRole("button", { name: "Save my changes as a new board", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
});


test("sync and copy actions remain available without a conflict and copying retains the original", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page.getByRole("button", { name: "Board settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sync and recovery", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Force sync my changes", exact: true }).click();
  expect(cloud.writes).toEqual([]);
  await page.getByRole("button", { name: "Replace cloud board", exact: true }).click();
  await expect.poll(() => cloud.writes).toEqual(["PATCH"]);
  await expect(page.getByRole("button", { name: "Force sync my changes", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save my changes as a new board", exact: true }).click();
  await expect.poll(() => cloud.rows.length).toBe(2);
  await expect(page.locator(".board-card")).toHaveCount(2);
  expect(cloud.rows[0].title).toBe("Saved production system");
  expect(cloud.rows[1].title).toBe("Saved production system (copy)");
});
