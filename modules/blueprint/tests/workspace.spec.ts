import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { invite, mockCloud, signIn } from "./support/cloud";

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await mockCloud(page, true, undefined, "Untitled architecture");
  await signIn(page);
});

test("the base URL shows all boards before and after opening an existing board", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.locator(".board-card")).toHaveCount(1);
  await expect(page.locator(".board-card-footer button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create a board", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join a board", exact: true })).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open Untitled architecture", exact: true })
    .click();
  await expect(page.locator(".architecture-node")).toHaveCount(9);
  await page.reload();
  await expect(page.locator(".architecture-node")).toHaveCount(9);
  await page.goto("./");
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.locator(".board-card")).toHaveCount(1);
});

test("the home header shows connection status and Help with a version footer", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".header-actions .connection")).toHaveText("Connected");
  await expect(page.locator(".app-footer")).toContainText("blueprint · ");
  const help = page.getByRole("button", { name: "Help", exact: true });
  await help.click();
  await expect(page.getByRole("dialog", { name: "A space for your systems." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.locator(".shortcuts-list > div")).toHaveCount(11);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(help).toBeFocused();
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); window.dispatchEvent(new Event("offline")); });
  await expect(page.locator(".header-actions .connection")).toHaveText("Offline");
});

test("settings have a name, restore keyboard focus, and skip navigation keeps the route", async ({
  page,
}) => {
  await page.goto("./#/board/" + invite);
  await expect(page).toHaveTitle("Blueprint — a little space for big systems");
  await expect(page.locator(".brand-button")).toContainText("blueprint.");
  const opener = page.getByRole("button", {
    name: "Board settings",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Board settings",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  const url = page.url();
  await page.keyboard.press("Shift+Tab");
  // Focus the skip control as a keyboard user would; it is intentionally hidden until focused.
  const skip = page.getByRole("button", { name: "Skip to content" });
  await skip.focus();
  await skip.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  expect(page.url()).toBe(url);
});

test("the logo opens a persistent home screen and reopens boards without editing them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./#/board/" + invite);
  await openSettings(page);
  await page
    .getByLabel("Board name", { exact: true })
    .fill("Payments architecture");
  await page.keyboard.press("Escape");
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await page.keyboard.press("n");
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".board-card")).toContainText("10 components");
  await page.reload();
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await page.getByRole("button", { name: "Create a board", exact: true }).click();
  await page.getByRole("button", { name: /A clean slate/ }).click();
  await expect(page.getByRole("main", { name: "All boards" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator(".board-card")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Search boards" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open Payments architecture", exact: true })
    .click();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await page.goBack();
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await page.goForward();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  expect(errors).toEqual([]);
});

test("edits, saves, restores, and undoes an architecture", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".architecture-node")).toHaveCount(9);
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toHaveCount(0);
  await page.locator(".react-flow__node.selected").dblclick();
  await page.getByLabel("Name", { exact: true }).fill("Booking service");
  await page.getByLabel("Technology", { exact: true }).click();
  await expect(
    page.locator(".architecture-node").filter({ hasText: "Booking service" }),
  ).toHaveCount(1);
  await page.getByLabel("Technology", { exact: true }).fill("Scala");
  await page.getByLabel("Name", { exact: true }).click();
  await page.getByRole("button", { name: "Select tool", exact: true }).click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(
    page.locator(".architecture-node").filter({ hasText: "Booking service" }),
  ).toContainText("Scala");
  await page.getByTitle("Add Database", { exact: true }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(11);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(11);
  expect(errors).toEqual([]);
});

test("connects nodes, edits labels, and deletes selected connections", async ({
  page,
}) => {
  await page.goto("./#/board/" + invite);
  await page.getByRole("button", { name: "Connect tool", exact: true }).click();
  await page.locator('[data-id="cdn"]').click();
  await page.locator('[data-id="cache"]').click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(9);
  await page.getByRole("button", { name: "Select tool", exact: true }).click();
  const newEdge = page.locator(".react-flow__edge").last();
  await newEdge.locator(".react-flow__edge-interaction").click({ force: true });
  await newEdge.locator(".react-flow__edge-interaction").dblclick({ force: true });
  await page.getByLabel("Label", { exact: true }).fill("Cache lookup");
  await page.getByRole("heading", { name: "Properties", exact: true }).click();
  await expect(newEdge).toContainText("Cache lookup");
  await page
    .getByRole("button", { name: "Delete connection", exact: true })
    .click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(8);
  await expect(page.locator(".properties-popup")).toHaveCount(0);
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toHaveCount(0);
  await page.locator(".react-flow__node.selected .architecture-node.note").dblclick({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toBeVisible();
});

test("exports only PNG from Board settings and creates a blank board", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: /Import/ })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Open Untitled architecture", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Board settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  await expect(settings.getByRole("button", { name: /backup/i })).toHaveCount(0);
  const imagePromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export as PNG", exact: true }).click();
  const image = await imagePromise;
  expect(image.suggestedFilename()).toBe("untitled-architecture.png");
  const data = await readFile((await image.path())!);
  expect(data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(data.readUInt32BE(16)).toBeGreaterThanOrEqual(1200);
  expect(data.readUInt32BE(20)).toBeGreaterThanOrEqual(700);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Open your boards" }).click();
  await page.getByRole("button", { name: "Create a board", exact: true }).click();
  await page.getByRole("button", { name: /A clean slate/ }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "It all starts with an idea." })).toBeVisible();
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator(".board-card")).toHaveCount(2);
});

for (const width of [320, 390, 599, 600]) {
  test(`keeps the board name and panels visible at ${width}px without overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("./#/board/" + invite);
    await expect(page.locator(".brand-button")).toContainText("blueprint.");
    const title = page.getByRole("heading", { name: "Untitled architecture", exact: true });
    await expect(title).toBeVisible();
    const titleBounds = await title.boundingBox();
    expect(titleBounds!.width).toBeGreaterThan(150);
    expect(titleBounds!.height).toBeGreaterThan(20);
    await expect(page.locator(".properties-popup")).toHaveCount(0);
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show components", exact: true })).toHaveCount(0);
    const header = await page.locator(".topbar").boundingBox();
    const sidebar = await page.locator(".sidebar").boundingBox();
    expect(sidebar!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.locator('.sidebar .template-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: 'Components', exact: true }).click();


    await openSettings(page);
    await expect(page.getByRole("dialog", { name: "Board settings", exact: true })).toBeVisible();
    const longName = "A shared architecture with a long name ".repeat(3).trim();
    await page.getByLabel("Board name", { exact: true }).fill(longName);
    await page.getByLabel("Board name", { exact: true }).press("Tab");
    await expect(page.locator(".header-board-title")).toHaveText(longName);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Connect tool", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Open your boards" }).click();
    await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}


test("adding from the palette, by dragging, toolbar and keyboard keeps Properties closed", async ({ page }) => {
  await page.goto("./#/board/" + invite);
  const popup = page.getByRole("dialog", { name: "Properties", exact: true });
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect(page.locator('.architecture-node')).toHaveCount(10);
  await expect(popup).toHaveCount(0);
  await page.locator('.react-flow__node.selected').dblclick();
  await expect(popup).toBeVisible();
  await page.getByTitle("Add Database", { exact: true }).click();
  await expect(page.locator('.architecture-node')).toHaveCount(11);
  await expect(popup).toHaveCount(0);
  await page.getByTitle("Add Cache", { exact: true }).dragTo(page.locator('#main-content'), { targetPosition: { x: 110, y: 110 } });
  await expect(page.locator('.architecture-node')).toHaveCount(12);
  await expect(popup).toHaveCount(0);
  await page.getByRole("button", { name: "Add sticky note", exact: true }).click();
  await expect(page.locator('.architecture-node')).toHaveCount(13);
  await expect(popup).toHaveCount(0);
  await page.keyboard.press("t");
  await expect(page.locator('.architecture-node')).toHaveCount(14);
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.react-flow__node.selected .text-annotation')).toHaveValue("Text");
  await page.keyboard.press("n");
  await expect(page.locator('.architecture-node')).toHaveCount(15);
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.react-flow__node.selected .architecture-node.note')).toHaveCount(1);
});

test("component properties open on double-click beside the component", async ({ page }) => {
  await page.goto("./#/board/" + invite);
  await expect(page.locator("#main-content")).toBeVisible();
  const before = await page.locator("#main-content").boundingBox();
  await page.getByTitle("Add Service", { exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Properties", exact: true });
  await expect(popup).toHaveCount(0);
  await page.locator(".react-flow__node.selected").dblclick();
  await expect(popup).toBeVisible();
  await expect(popup.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(popup.getByLabel("Board name", { exact: true })).toHaveCount(0);
  const compactBounds = (await popup.boundingBox())!;
  expect(compactBounds.width).toBeLessThanOrEqual(280);
  expect(compactBounds.height).toBeLessThanOrEqual(400);
  const selected = page.locator('.react-flow__node.selected');
  await expect.poll(async () => {
    const node = (await selected.boundingBox())!;
    const panel = (await popup.boundingBox())!;
    const dx = Math.max(node.x - panel.x - panel.width, panel.x - node.x - node.width, 0);
    const dy = Math.max(node.y - panel.y - panel.height, panel.y - node.y - node.height, 0);
    return Math.hypot(dx, dy);
  }).toBeLessThanOrEqual(16);
  expect((await page.locator("#main-content").boundingBox())!.width).toBe(before!.width);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(async () => {
    const bounds = (await popup.boundingBox())!;
    const header = (await page.locator('.topbar').boundingBox())!;
    return bounds.x >= 0 && bounds.x + bounds.width <= 360 && bounds.y >= header.y + header.height && bounds.y + bounds.height <= 800;
  }).toBe(true);
  await popup.getByLabel("Name", { exact: true }).fill("My service");
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(page.locator(".architecture-node").filter({ hasText: "My service" })).toHaveCount(1);
});

test("sidebar template cards keep equal sizes across desktop and narrow screens", async ({ page }) => {
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("./#/board/" + invite);
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    const sizes = await page.locator(".sidebar-template-cards .template-card").evaluateAll(cards => cards.map(card => {
      const bounds = card.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
    expect(sizes).toHaveLength(4);
    for (const size of sizes) {
      expect(size.width).toBeCloseTo(sizes[0].width, 0);
      expect(size.height).toBeCloseTo(sizes[0].height, 0);
    }
  }
});

test("compact board settings edits details and commits the focused field on Escape", async ({ page }) => {
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Board settings', exact: true });
  await expect(settings.getByRole('heading', { name: 'Board details', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Properties', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Open invitation', exact: true })).toHaveCount(0);
  await settings.getByLabel('Board name', { exact: true }).fill('Compact architecture');
  await settings.getByRole('textbox', { name: 'Description', exact: true }).fill('A clearer board.');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.locator('.header-board-title')).toHaveText('Compact architecture');
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  await expect(settings.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('A clearer board.');
});


test("settings removal shows the invitation, persists across reload, and requires Join", async ({ page }) => {
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await openSettings(page);
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await expect(page.getByLabel("Invitation code", { exact: true })).toHaveValue(invite);
  await page.getByRole("button", { name: "Keep on this device", exact: true }).click();
  await expect(page.getByLabel("Board name", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".board-card")).toHaveCount(0);
  await page.goto("./#/board/" + invite);
  await expect(page.getByRole("dialog", { name: "Join a board", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Join board", exact: true }).click();
  await expect(page.locator(".board-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Open Untitled architecture", exact: true }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(9);
});

test("settings removal keeps the board and confirmation when storage fails", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "blueprint.workspace.v1.removed") throw new Error("Browser storage unavailable");
      return original.call(this, key, value);
    };
  });
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await openSettings(page);
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await page.getByRole("button", { name: "Remove from this device", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Browser storage unavailable");
  await expect(page.getByLabel("Invitation code", { exact: true })).toHaveValue(invite);
  await page.getByRole("button", { name: "Keep on this device", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".architecture-node")).toHaveCount(9);
});
