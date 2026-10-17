import { expect, test } from "@playwright/test";

test("settings have a name, restore keyboard focus, and skip navigation keeps the route", async ({
  page,
}) => {
  await page.goto("./");
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
  await page.goto("./");
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
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("button", { name: /A clean slate/ }).click();
  await expect(page.getByRole("main", { name: "All boards" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator(".board-card")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Search boards" }).fill("payments");
  await expect(page.locator(".board-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search boards" }).fill("no match");
  await expect(
    page.getByRole("heading", { name: "No boards found" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search boards" }).fill("");
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
  await page.goto("./");
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
  await page.goto("./");
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

test("creates boards, exports backups and images, and imports a backup", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const backupPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export board/ }).click();
  const backup = await backupPromise;
  expect(backup.suggestedFilename()).toBe("untitled-architecture.blueprint.json");
  const path = await backup.path();
  expect(path).toBeTruthy();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const imagePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export as PNG/ }).click();
  const image = await imagePromise;
  expect(image.suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("button", { name: /A clean slate/ }).click();
  await expect(page.locator(".architecture-node")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "It all starts with an idea." }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(page.locator(".architecture-node")).toHaveCount(9);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator(".board-card")).toHaveCount(3);
});

test("works at a narrow viewport without overflowing the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
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
