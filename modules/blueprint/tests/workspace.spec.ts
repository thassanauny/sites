import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { invite, mockCloud, signIn } from "./support/cloud";

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
  await page
    .getByLabel("Board name", { exact: true })
    .fill("Payments architecture");
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
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
  await page.getByLabel("Toggle properties panel").click();
  await page.getByRole("button", { name: "Connect tool", exact: true }).click();
  await page.locator('[data-id="cdn"]').click();
  await page.locator('[data-id="cache"]').click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(9);
  await page.getByRole("button", { name: "Select tool", exact: true }).click();
  await page.getByLabel("Toggle properties panel").click();
  const newEdge = page.locator(".react-flow__edge").last();
  await newEdge.locator(".react-flow__edge-interaction").click({ force: true });
  await page.getByLabel("Label", { exact: true }).fill("Cache lookup");
  await page.getByText("Show how things flow").click();
  await expect(newEdge).toContainText("Cache lookup");
  await page
    .getByRole("button", { name: "Delete connection", exact: true })
    .click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(8);
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

test("works at a narrow viewport without overflowing the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".brand-button")).toContainText("blueprint.");
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show components", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide components", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect tool", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
