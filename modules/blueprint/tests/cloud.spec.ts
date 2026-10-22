import { expect, test, type Locator, type Page } from "@playwright/test";
import { invite, signIn, mockCloud } from "./support/cloud";
import { componentIconSets, componentKinds, flowComponentKinds, type ComponentIconStyle, type DiagramEdge } from "../src/domain/boards/types";
import { componentMeta, makeNode } from "../src/domain/boards/components";
import { createBoard } from "../src/domain/boards/templates";

async function openProperties(page: Page) {
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
}

async function expectIconPreview(page: Page, iconStyle: ComponentIconStyle) {
  const toggle = page.getByRole("button", { name: /^(Preview all icons|Hide icon preview)$/ });
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  const label = componentIconSets.find(({ id }) => id === iconStyle)!.label;
  const popup = page.getByRole("region", { name: `${label} icon preview`, exact: true });
  await expect(popup).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Board settings", exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const preview = popup.getByRole("list", { name: "Selected icon set preview", exact: true });
  await expect(preview.getByRole("listitem")).toHaveText(componentKinds.map(kind => componentMeta[kind].label));
  const icons = preview.locator(`svg[data-icon-style="${iconStyle}"]`);
  await expect(icons).toHaveCount(componentKinds.length);
  expect(await icons.evaluateAll(items => items.every(icon => icon.children.length > 0))).toBe(true);
}

async function closeIconPreview(page: Page) {
  await page.getByRole("button", { name: "Close icon preview", exact: true }).click();
  await expect(page.getByRole("region", { name: / icon preview$/ })).toHaveCount(0);
}

async function iconArtwork(icon: Locator) {
  return icon.evaluate(svg => ({
    content: svg.innerHTML,
    viewBox: svg.getAttribute("viewBox"),
    lineCap: svg.getAttribute("stroke-linecap"),
    fills: [...svg.querySelectorAll("[fill-opacity]")].map(fill => getComputedStyle(fill).fillOpacity),
  }));
}

test("workflow cards convert in place, retain connected content and support icon preferences, undo and reload", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.getByRole("heading", { name: "System components", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workflows", exact: true })).toHaveCount(1);
  const original = structuredClone(cloud.rows[0].document.nodes.find((node: { data: { kind: string } }) => node.data.kind === "service"));
  const connections = (edges: DiagramEdge[]) => edges.map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle,
    label: edge.label || "", animated: Boolean(edge.animated),
  }));
  const edges = connections(cloud.rows[0].document.edges);
  const node = page.locator(`.react-flow__node[data-id="${original.id}"]`);
  await node.click();
  await expect(node).toHaveClass(/selected/);
  await node.dblclick();
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  await properties.getByLabel("Component type", { exact: true }).selectOption("module");
  await expect(node.locator('.workflow.module')).toHaveCount(1);
  await expect(properties.getByLabel("Name", { exact: true })).toHaveValue(original.data.label);
  await expect(properties.getByLabel("Subtitle (optional)", { exact: true })).toHaveValue(original.data.technology);
  await properties.getByLabel("Show icon", { exact: true }).uncheck();
  await properties.getByRole("button", { name: "Close properties", exact: true }).click();
  await expect(node.locator('.node-icon')).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(node.locator('.node-icon')).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(node.locator('.node-icon')).toHaveCount(0);
  await expect.poll(() => cloud.rows[0].document.nodes.find((item: { id: string }) => item.id === original.id).data.showIcon).toBe(false);
  const changed = cloud.rows[0].document.nodes.find((item: { id: string }) => item.id === original.id);
  expect(changed.position).toEqual(original.position);
  expect(changed.data).toEqual({ ...original.data, kind: "module", showIcon: false });
  expect(connections(cloud.rows[0].document.edges)).toEqual(edges);
  await page.reload();
  await expect(node.locator('.workflow.module')).toHaveCount(1);
  await expect(node.locator('.node-icon')).toHaveCount(0);
});

test("all workflow shapes add without opening Properties, save, reload and export", async ({ page }) => {
  const cloud = await mockCloud(page);
  cloud.rows[0].document.nodes = [];
  cloud.rows[0].document.edges = [];
  await signIn(page);
  await page.goto("./#/board/" + invite);
  for (const kind of flowComponentKinds) {
    await page.getByTitle(`Add ${componentMeta[kind].label}`, { exact: true }).click();
    await expect(page.locator(`.architecture-node.workflow.${kind}`)).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toHaveCount(0);
  }
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(flowComponentKinds.length);
  await page.reload();
  await expect(page.locator('.architecture-node.workflow')).toHaveCount(flowComponentKinds.length);
  await openProperties(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export as PNG", exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/\.png$/);
  expect(await exported.failure()).toBeNull();
});

test("swimlane rows edit and resize while interior components remain clickable", async ({ page }) => {
  const cloud = await mockCloud(page);
  const lane = makeNode("swimlane", { x: 0, y: 0 }, { label: "Order lifecycle" });
  const step = makeNode("step", { x: 180, y: 80 }, { label: "Place order" });
  cloud.rows[0].document.nodes = [lane, step];
  cloud.rows[0].document.edges = [];
  await signIn(page);
  await page.goto("./#/board/" + invite);
  const frame = page.locator(`.react-flow__node[data-id="${lane.id}"]`);
  const card = page.locator(`.react-flow__node[data-id="${step.id}"]`);
  await frame.locator('.boundary-label').click();
  await expect(frame).toHaveClass(/selected/);
  await frame.locator('.boundary-label').dblclick();
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  await properties.getByRole("textbox", { name: "Lanes (one per line, up to 8)", exact: true }).fill("Customer\nOperations\nPayments\nReturns");
  await properties.getByRole("button", { name: "Close properties", exact: true }).click();
  await expect(frame.locator('.swimlane-row-label')).toHaveText(["Customer", "Operations", "Payments", "Returns"]);
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThanOrEqual(396);
  await card.click();
  await expect(card).toHaveClass(/selected/);
  await frame.locator('.boundary-hit-top').click();
  const corner = frame.locator('.react-flow__resize-control.handle.bottom.right');
  const bounds = (await corner.boundingBox())!;
  const before = (await frame.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 60, bounds.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(before.width + 30);
  await card.dblclick();
  await expect(properties.getByLabel("Name", { exact: true })).toHaveValue("Place order");
  await properties.getByRole("button", { name: "Close properties", exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.find((item: { id: string }) => item.id === lane.id).data.lanes).toEqual(["Customer", "Operations", "Payments", "Returns"]);
  await page.reload();
  await expect(frame.locator('.swimlane-row-label')).toHaveCount(4);
  await card.click();
  await expect(card).toHaveClass(/selected/);
});

test("Save changes bypasses autosave delays and waits for the cloud acknowledgement", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await openProperties(page);
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let requestStarted = false;
  let release!: () => void;
  const acknowledged = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/blueprint_boards?*", async route => {
    if (route.request().method() === "PATCH") { requestStarted = true; await acknowledged; }
    await route.fallback();
  });
  try {
    await settings.getByLabel("Board name", { exact: true }).fill("Saved settings");
    await settings.getByRole("button", { name: "Classic infrastructure", exact: true }).click();
    await expect(page.getByRole("region", { name: / icon preview$/ })).toHaveCount(0);
    await settings.getByRole("textbox", { name: "Description", exact: true }).fill("Saved while this field is focused.");
    await settings.getByRole("button", { name: "Save changes", exact: true }).click();
    let elapsed = 0;
    await expect.poll(async () => {
      if (elapsed < 100) { elapsed++; await page.clock.runFor(1); }
      return requestStarted;
    }, { intervals: [10] }).toBe(true);
    await expect(settings.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await expect(settings).toBeVisible();
    expect(cloud.rows[0].title).toBe("Saved production system");
  } finally { release(); }
  await expect(settings).toHaveCount(0);
  expect(cloud.rows[0].title).toBe("Saved settings");
  expect(cloud.rows[0].document.description).toBe("Saved while this field is focused.");
  expect(cloud.rows[0].document.iconStyle).toBe("classic");
  await page.reload();
  await expect(page.locator(".header-board-title")).toHaveText("Saved settings");
  await expect(page.locator('.architecture-node svg[data-icon-style="classic"]')).toHaveCount(9);
});

test("Save changes keeps Settings and the draft open when local storage fails", async ({ page }) => {
  await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await openProperties(page);
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  await settings.getByRole("textbox", { name: "Description", exact: true }).fill("Keep this draft safe.");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("blueprint.workspace.v1")) throw new Error("Storage unavailable");
      return original.call(this, key, value);
    };
  });
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("Could not save on this device");
  await expect(settings.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Keep this draft safe.");
  await expect(settings.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
});

test("Save changes preserves conflicts without force replacing the cloud board", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await openProperties(page);
  cloud.conflict();
  const updates: string[] = [];
  page.on("request", request => { if (request.method() === "PATCH") updates.push(request.url()); });
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  await settings.getByLabel("Board name", { exact: true }).fill("My conflicting changes");
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings.getByRole("alert").filter({ hasText: "Resolve the cloud conflict" })).toBeVisible();
  await expect(settings.getByLabel("Board name", { exact: true })).toHaveValue("My conflicting changes");
  expect(cloud.rows[0].title).toBe("Saved production system");
  expect(updates.length).toBeGreaterThan(0);
  expect(updates.every(url => new URL(url).searchParams.has("revision"))).toBe(true);
});

test("Save changes stores offline edits and syncs them after reconnecting", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); window.dispatchEvent(new Event("offline")); });
  await openProperties(page);
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  await settings.getByRole("textbox", { name: "Description", exact: true }).fill("Saved on this device while offline.");
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await openProperties(page);
  await expect(settings.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Saved on this device while offline.");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => cloud.rows[0].document.description).toBe("Saved on this device while offline.");
});

test("sticky notes stay straight and compact, edit inline, undo together and persist without Properties", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  const originalDescription = cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === "note").data.description;
  await expect(page.locator('.react-flow__node[data-id="note"]').getByRole("textbox", { name: "Note description" })).toHaveValue(originalDescription);
  await page.getByRole("button", { name: "Add sticky note", exact: true }).click();
  await expect(page.locator('.architecture-node')).toHaveCount(10);
  const noteId = (await page.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  const note = page.locator(`.react-flow__node[data-id="${noteId}"] .architecture-node.note`);
  const editor = note.getByRole("textbox", { name: "Note description", exact: true });
  await expect(editor).toHaveValue("");
  await expect(note.locator('.note-heading')).toHaveCount(0);
  const textTop = () => editor.evaluate(element => {
    const note = element.closest('.architecture-node')!;
    return (element as HTMLElement).offsetTop - parseFloat(getComputedStyle(note).paddingTop) - note.clientTop;
  });
  expect(Math.abs(await textTop())).toBeLessThanOrEqual(1);
  await expect(editor).toHaveAttribute("placeholder", "Write a note…");
  await expect(note).toHaveCSS("width", "222px");
  await expect(note).toHaveCSS("min-height", "139px");
  await expect(note).toHaveCSS("transform", "none");
  await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toHaveCount(0);
  const position = await note.locator('..').evaluate(element => getComputedStyle(element).transform);
  await editor.click();
  await editor.pressSequentially("n t c v h / ?");
  await editor.press("Enter");
  await editor.pressSequentially("Retry safely.");
  const description = "n t c v h / ?\nRetry safely.";
  await expect(editor).toHaveValue(description);
  await expect(editor).toBeFocused();
  await expect(page.locator('.architecture-node')).toHaveCount(10);
  expect(await note.locator('..').evaluate(element => getComputedStyle(element).transform)).toBe(position);
  await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === noteId)?.data.description).toBe(description);
  await editor.dblclick();
  await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).toHaveValue("");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor).toHaveValue(description);
  await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === noteId)?.data.description).toBe(description);
  await page.reload();
  await expect(editor).toHaveValue(description);
  await expect(page.locator('.react-flow__node[data-id="note"]').getByRole("textbox", { name: "Note description" })).toHaveValue(originalDescription);
  const longDescription = Array.from({ length: 10 }, (_, index) => `Decision ${index + 1}: keep this complete.`).join('\n');
  await editor.fill(longDescription);
  await expect.poll(() => note.evaluate(element => parseFloat(getComputedStyle(element).height))).toBeGreaterThan(139);
  await expect.poll(() => editor.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await editor.fill(description);
  await expect.poll(() => note.evaluate(element => parseFloat(getComputedStyle(element).height))).toBeLessThanOrEqual(140);
  await note.dblclick({ position: { x: 8, y: 8 } });
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  const name = properties.getByRole("textbox", { name: "Name (optional)", exact: true });
  await expect(name).toHaveValue("");
  await expect(properties.getByRole("textbox")).toHaveCount(1);
  await expect(properties.getByText("Description", { exact: true })).toHaveCount(0);
  await name.fill("Decision");
  await name.press("Tab");
  await expect(note.locator('.note-heading')).toHaveText("Decision");
  expect(await textTop()).toBeGreaterThan(15);
  await name.fill("");
  await name.press("Tab");
  await expect(note.locator('.note-heading')).toHaveCount(0);
  expect(Math.abs(await textTop())).toBeLessThanOrEqual(1);
  await expect(editor).toHaveValue(description);
  await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === noteId)?.data.label).toBe("");
  await page.reload();
  await expect(note.locator('.note-heading')).toHaveCount(0);
  await expect(editor).toHaveValue(description);
});

test("text annotations edit inline, grow, undo together and preserve multiline text in Properties and after reload", async ({ page }) => {
  const cloud = await mockCloud(page);
  cloud.rows[0].document.nodes.push({ ...makeNode("text", { x: 250, y: 540 }, { label: "Existing annotation" }), id: "existing-text" });
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator('.react-flow__node[data-id="existing-text"] .text-annotation')).toHaveValue("Existing annotation");
  await page.getByTitle("Add Text", { exact: true }).click();
  const textId = (await page.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  const node = page.locator(`.react-flow__node[data-id="${textId}"] .architecture-node.text`);
  const editor = node.getByRole("textbox", { name: "Text annotation", exact: true });
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  await expect(editor).toHaveValue("Text");
  await expect(properties).toHaveCount(0);
  const position = await node.locator('..').evaluate(element => getComputedStyle(element).transform);
  await editor.fill("n t c v h / ?");
  await editor.press("Enter");
  await editor.pressSequentially("Retry safely.");
  const content = "n t c v h / ?\nRetry safely.";
  await expect(editor).toHaveValue(content);
  await expect(editor).toBeFocused();
  await expect(page.locator('.architecture-node')).toHaveCount(11);
  expect(await node.locator('..').evaluate(element => getComputedStyle(element).transform)).toBe(position);
  await expect.poll(() => cloud.rows[0].document.nodes.find((item: { id: string }) => item.id === textId)?.data.label).toBe(content);
  await editor.dblclick();
  await expect(properties).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).toHaveValue("Text");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor).toHaveValue(content);
  await editor.fill("One\nTwo\nThree\nFour\nFive");
  await expect.poll(() => editor.evaluate(element => parseFloat(getComputedStyle(element).height))).toBeGreaterThan(100);
  await expect.poll(() => editor.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await editor.fill(content);
  await node.dblclick({ position: { x: 8, y: 4 } });
  await expect(properties.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(content);
  await properties.getByRole("button", { name: "Close properties", exact: true }).click();
  await expect(editor).toHaveValue(content);
  await editor.fill("");
  await expect(editor).toHaveAttribute("placeholder", "Write text…");
  await expect.poll(() => cloud.rows[0].document.nodes.find((item: { id: string }) => item.id === textId)?.data.label).toBe("");
  await page.reload();
  await expect(editor).toHaveValue("");
  await editor.fill(content);
  await expect.poll(() => cloud.rows[0].document.nodes.find((item: { id: string }) => item.id === textId)?.data.label).toBe(content);
  await page.reload();
  await expect(editor).toHaveValue(content);
  await expect(page.locator('.react-flow__node[data-id="existing-text"] .text-annotation')).toHaveValue("Existing annotation");
});

test("clicked or dragged sticky notes keep their stacking order after deselection without interrupting typing", async ({ page }) => {
  const cloud = await mockCloud(page);
  cloud.rows[0].document.nodes = [
    { ...makeNode("note", { x: 0, y: 0 }, { label: "First", description: "First note." }), id: "first" },
    { ...makeNode("note", { x: 70, y: 30 }, { label: "Second", description: "Second note." }), id: "second" },
    { ...makeNode("note", { x: 140, y: 60 }, { label: "Third", description: "Third note." }), id: "third" },
  ];
  cloud.rows[0].document.edges = [];
  await signIn(page);
  await page.goto("./#/board/" + invite);
  const first = page.locator('.react-flow__node[data-id="first"]');
  const second = page.locator('.react-flow__node[data-id="second"]');
  const third = page.locator('.react-flow__node[data-id="third"]');
  const editor = first.getByRole("textbox", { name: "Note description", exact: true });
  const deselect = async () => {
    await page.locator('.react-flow__pane').click({ position: { x: 25, y: 25 } });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  };
  const frontAtOverlap = () => third.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + 20, bounds.y + 20)?.closest('.react-flow__node')?.getAttribute('data-id');
  });
  await expect.poll(frontAtOverlap).toBe("third");
  await editor.click({ position: { x: 10, y: 10 } });
  await expect(editor).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editor.press("End");
  await editor.pressSequentially(" Still typing.");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("First note. Still typing.");
  await deselect();
  await expect.poll(frontAtOverlap).toBe("first");
  await second.click({ position: { x: 210, y: 8 } });
  await deselect();
  await expect.poll(frontAtOverlap).toBe("second");
  const bounds = (await third.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - 8, bounds.y + 8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 12, bounds.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await third.boundingBox())!.x).toBeGreaterThan(bounds.x + 5);
  await deselect();
  await expect.poll(frontAtOverlap).toBe("third");
  await editor.click({ position: { x: 10, y: 10 } });
  await deselect();
  await expect.poll(frontAtOverlap).toBe("first");
  const layers = await page.locator('.react-flow__node').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.getAttribute('data-id'), Number(getComputedStyle(element).zIndex)])));
  expect(layers.first).toBeGreaterThan(layers.third);
  expect(layers.third).toBeGreaterThan(layers.second);
  await expect.poll(() => cloud.rows[0].document.nodes[0].data.description).toBe("First note. Still typing.");
  expect(cloud.rows[0].document.nodes.map((node: { id: string }) => node.id)).toEqual(["first", "second", "third"]);
});

test("component stacking follows clicks and keyboard selection, including text inside a note", async ({ page }) => {
  const cloud = await mockCloud(page);
  cloud.rows[0].document.nodes = [
    { ...makeNode("note", { x: 100, y: 25 }, { description: "Editable note." }), id: "overlap-note" },
    { ...makeNode("service", { x: 0, y: 0 }), id: "overlap-service" },
    { ...makeNode("database", { x: 70, y: -25 }), id: "overlap-database" },
    { ...makeNode("text", { x: 280, y: -70 }), id: "annotation" },
  ];
  cloud.rows[0].document.edges = [];
  await signIn(page);
  await page.goto("./#/board/" + invite);
  const service = page.locator('.react-flow__node[data-id="overlap-service"]');
  const database = page.locator('.react-flow__node[data-id="overlap-database"]');
  const note = page.locator('.react-flow__node[data-id="overlap-note"]');
  const editor = note.getByRole("textbox", { name: "Note description", exact: true });
  const deselect = async () => {
    await page.locator('.react-flow__pane').click({ position: { x: 25, y: 25 } });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  };
  const frontAtOverlap = () => service.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + 150, bounds.y + 50)?.closest('.react-flow__node')?.getAttribute('data-id');
  });
  await expect.poll(frontAtOverlap).toBe("overlap-database");
  await service.click({ position: { x: 10, y: 10 } });
  await deselect();
  await expect.poll(frontAtOverlap).toBe("overlap-service");
  await database.click({ position: { x: 180, y: 8 } });
  await deselect();
  await expect.poll(frontAtOverlap).toBe("overlap-database");
  await service.focus();
  await page.keyboard.press("Enter");
  await expect(service).toHaveClass(/selected/);
  await deselect();
  await expect.poll(frontAtOverlap).toBe("overlap-service");
  await service.click({ position: { x: 10, y: 10 } });
  await editor.click({ position: { x: 170, y: 60 } });
  await expect(editor).toBeFocused();
  await expect.poll(frontAtOverlap).toBe("overlap-note");
  await deselect();
  await expect.poll(frontAtOverlap).toBe("overlap-note");
  const annotation = page.locator('.react-flow__node[data-id="annotation"]');
  await annotation.click();
  await deselect();
  expect(await annotation.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(
    await note.evaluate(element => Number(getComputedStyle(element).zIndex)),
  );
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(cloud.rows[0].document.nodes.map((node: { id: string }) => node.id)).toEqual(["overlap-note", "overlap-service", "overlap-database", "annotation"]);
});

for (const kind of ["note", "text"] as const) {
  test(`inline ${kind} edits sync after reconnecting and become read-only when editing is unavailable`, async ({ page }) => {
    const cloud = await mockCloud(page);
    const id = kind === "note" ? "note" : "offline-text";
    if (kind === "text") cloud.rows[0].document.nodes.push({ ...makeNode("text", { x: 250, y: 540 }), id });
    const field = kind === "note" ? "description" : "label";
    const original = cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === id).data[field];
    const draft = kind === "note" ? "Keep this note while offline." : "Keep this text\nwhile offline.";
    await signIn(page);
    await page.goto("./#/board/" + invite);
    await expect(page.locator('.connection')).toHaveText('Connected');
    const editor = page.locator(`.react-flow__node[data-id="${id}"]`).getByRole("textbox", { name: kind === "note" ? "Note description" : "Text annotation", exact: true });
    await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); window.dispatchEvent(new Event("offline")); });
    await editor.fill(draft);
    await expect(editor).toHaveValue(draft);
    expect(cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === id).data[field]).toBe(original);
    await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); window.dispatchEvent(new Event("online")); });
    await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === id).data[field]).toBe(draft);
    await expect(editor).toBeFocused();
    cloud.returnInvalidProtocol();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTitle('Add Service', { exact: true })).toBeDisabled();
    await expect(editor).not.toBeEditable();
    await expect(editor).toHaveValue(draft);
  });
}

test("the board icon set updates all components and the sidebar, with undo, sync and reload", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator('.architecture-node svg[data-icon-style="duotone"]')).toHaveCount(9);
  await expect(page.locator('.component-tile svg[data-icon-style="duotone"]')).toHaveCount(componentKinds.length);
  await openProperties(page);
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  const styles = settings.getByRole("group", { name: "Default icon set", exact: true });
  await expect(styles.locator(".icon-style-options").getByRole("button")).toHaveText(["Soft duotone", "Classic infrastructure", "Architecture symbols", "Technical outline"]);
  const duotone = styles.getByRole("button", { name: "Soft duotone", exact: true });
  const architecture = styles.getByRole("button", { name: "Architecture symbols", exact: true });
  await expect(duotone).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("list", { name: "Selected icon set preview", exact: true })).toHaveCount(0);
  await duotone.click();
  await expect(page.getByRole("region", { name: / icon preview$/ })).toHaveCount(0);
  await expectIconPreview(page, "duotone");
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview all icons", exact: true })).toBeFocused();
  await duotone.click();
  await expectIconPreview(page, "duotone");
  await architecture.click();
  await expectIconPreview(page, "architecture");
  await closeIconPreview(page);
  await expect(architecture).toHaveAttribute("aria-pressed", "true");
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.locator('.architecture-node svg[data-icon-style="architecture"]')).toHaveCount(9);
  await expect(page.locator('.component-tile svg[data-icon-style="architecture"]')).toHaveCount(componentKinds.length);
  await page.locator('.react-flow__node[data-id="api"]').dblclick();
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  await expect(properties.getByRole("button", { name: "Architecture symbols", exact: true })).toHaveCount(0);
  await expect(page.locator('.selected-component svg[data-icon-style="architecture"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('.architecture-node svg[data-icon-style="duotone"]')).toHaveCount(9);
  await expect(page.locator('.component-tile svg[data-icon-style="duotone"]')).toHaveCount(componentKinds.length);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('.architecture-node svg[data-icon-style="architecture"]')).toHaveCount(9);
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect(page.locator('.architecture-node svg[data-icon-style="architecture"]')).toHaveCount(10);
  await expect.poll(() => cloud.rows[0].document.iconStyle).toBe("architecture");
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  await page.reload();
  await expect(page.locator('.architecture-node svg[data-icon-style="architecture"]')).toHaveCount(10);
  await expect(page.locator('.component-tile svg[data-icon-style="architecture"]')).toHaveCount(componentKinds.length);
  await openProperties(page);
  await expect(architecture).toHaveAttribute("aria-pressed", "true");
  await architecture.click();
  await expectIconPreview(page, "architecture");
  await closeIconPreview(page);
  await duotone.click();
  await expectIconPreview(page, "duotone");
  await closeIconPreview(page);
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.locator('.architecture-node svg[data-icon-style="duotone"]')).toHaveCount(10);
  await expect.poll(() => cloud.rows[0].document.iconStyle).toBe("duotone");
});

test("settings preview stays local until Save and Close discards the draft", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await page.getByTitle('Add Step / action', { exact: true }).click();
  const workflow = page.locator('.architecture-node.workflow.step').first();
  await expect(workflow).toHaveCSS('background-color', 'rgb(237, 243, 251)');
  const shell = page.locator(".app-shell");
  const paletteIcon = page.getByTitle("Add Service", { exact: true }).locator(".component-tile-icon svg");
  await expect(paletteIcon).toHaveAttribute("width", "25.2");
  await expect(paletteIcon).toHaveCSS("color", "rgb(56, 130, 102)");
  await openProperties(page);
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  const slider = settings.getByRole("slider", { name: "Color intensity", exact: true });
  await slider.press("End");
  await settings.getByLabel("Board name", { exact: true }).fill("Unsaved settings");
  await expect(shell).toHaveAttribute("data-color-intensity", "0");
  expect(cloud.rows[0].title).toBe("Saved production system");
  expect(cloud.rows[0].document.colorIntensity ?? 0).toBe(0);
  await expect(settings.getByRole("img", { name: "Diagram preview at 100% color intensity" }).locator(".tone-green")).toHaveCSS("background-color", "rgb(222, 238, 228)");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await openProperties(page);
  await expect(slider).toHaveValue("0");
  await expect(settings.getByLabel("Board name", { exact: true })).toHaveValue("Saved production system");
  await slider.press("End");
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-color-intensity", "100");
  await expect(paletteIcon).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(paletteIcon.locator("..")).toHaveCSS("background-color", "rgb(29, 107, 80)");
  await expect(workflow).toHaveCSS("background-color", "rgb(49, 95, 145)");
  await expect(workflow.locator(".node-copy strong")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect.poll(() => cloud.rows[0].document.colorIntensity).toBe(100);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(shell).toHaveAttribute("data-color-intensity", "0");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(shell).toHaveAttribute("data-color-intensity", "100");
  await page.reload();
  await expect(shell).toHaveAttribute("data-color-intensity", "100");
});

test("selected animated connections follow intensity for their lines and arrowheads", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  const edge = page.locator('.react-flow__edge[data-id="api-queue"]');
  const path = edge.locator('.react-flow__edge-path');
  await edge.focus();
  await page.keyboard.press("Enter");
  await expect(edge).toHaveClass(/selected/);
  await expect(edge).toHaveClass(/animated/);
  await expect(path).toHaveCSS("stroke-dasharray", "6px, 4px");
  await openProperties(page);
  const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
  const slider = settings.getByRole("slider", { name: "Color intensity", exact: true });
  const arrowColor = () => path.evaluate(element => {
    const marker = element.getAttribute("marker-end")!.match(/#(.+)\)/)![1].replaceAll('"', '').replaceAll("'", '');
    return getComputedStyle(document.getElementById(marker)!.querySelector("polyline")!).fill;
  });
  for (const [depth, color, width] of [[0, "rgb(140, 155, 150)", "2.2px"], [50, "rgb(92, 122, 111)", "2.65px"], [100, "rgb(44, 88, 72)", "3.1px"]] as const) {
    await slider.press("Home");
    if (depth === 50) for (let step = 0; step < 5; step++) await slider.press("PageUp");
    if (depth === 100) await slider.press("End");
    await settings.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(edge).toHaveClass(/selected/);
    await expect(path).toHaveCSS("stroke", color);
    await expect(path).toHaveCSS("stroke-width", width);
    await expect.poll(arrowColor).toBe(color);
    await expect(path).toHaveCSS("animation-name", "dashdraw");
    await openProperties(page);
  }
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(cloud.rows[0].document.edges.find((item: { id: string }) => item.id === "api-queue").animated).toBe(true);
  await page.reload();
  await expect(path).toHaveCSS("stroke", "rgb(44, 88, 72)");
  await expect(edge).toHaveClass(/animated/);
});

test("selected boundaries let interior clicks through and move or resize from their frame", async ({ page }) => {
  const cloud = await mockCloud(page);
  const frame = { ...makeNode("boundary", { x: -40, y: -10 }), id: "frame", style: { width: 1150, height: 740 } };
  cloud.rows[0].document.nodes.push(frame);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  const wrapper = page.locator('.react-flow__node[data-id="frame"]');
  const boundary = wrapper.locator('.architecture-node.boundary');
  const label = boundary.locator('.boundary-label');
  const api = page.locator('.react-flow__node[data-id="api"]');
  const edge = page.locator('.react-flow__edge[data-id="api-queue"]');
  await label.click();
  await expect(wrapper).toHaveClass(/selected/);
  await expect(wrapper).toHaveCSS("z-index", "-1");
  await api.click();
  await expect(api).toHaveClass(/selected/);
  expect(await api.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(0);
  await expect(wrapper).not.toHaveClass(/selected/);
  await api.dblclick();
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  await expect(properties.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("API service");
  await page.keyboard.press("Escape");
  await label.click();
  const edgePoint = await edge.locator('.react-flow__edge-path').evaluate(element => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 4);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await expect(edge).toHaveClass(/selected/);
  await expect(wrapper).not.toHaveClass(/selected/);

  await boundary.locator('.boundary-hit-top').click();
  await expect(wrapper).toHaveClass(/selected/);
  const labelBounds = (await label.boundingBox())!;
  const dragStart = { x: labelBounds.x + labelBounds.width / 2, y: labelBounds.y + labelBounds.height / 2 };
  const beforeDrag = (await boundary.boundingBox())!;
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 40, dragStart.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await boundary.boundingBox())!.x - beforeDrag.x).toBeGreaterThan(25);
  await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === "frame").position.x).toBeGreaterThan(frame.position.x);
  expect(cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === "api").position).toEqual({ x: 530, y: 200 });

  const corner = boundary.locator('.react-flow__resize-control.handle.bottom.right');
  const handleBounds = (await corner.boundingBox())!;
  const beforeResize = (await boundary.boundingBox())!;
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBounds.x + handleBounds.width / 2 + 30, handleBounds.y + handleBounds.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await boundary.boundingBox())!.width).toBeGreaterThan(beforeResize.width + 20);
  await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === "frame").style.width).toBeGreaterThan(1150);
  await label.dblclick();
  await expect(properties.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Boundary");
  await page.keyboard.press("Escape");
  const bounds = (await boundary.boundingBox())!;
  await page.mouse.click(bounds.x + 40, bounds.y + bounds.height - 50);
  await expect(wrapper).not.toHaveClass(/selected/);
  await expect(api).not.toHaveClass(/selected/);
  await expect(edge).not.toHaveClass(/selected/);
  await expect(corner).toHaveCount(0);
  await label.click();
  await api.click();
  await expect(api).toHaveClass(/selected/);
  await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === "frame").style.pointerEvents).toBeUndefined();
  await page.reload();
  await label.click();
  await api.click();
  await expect(api).toHaveClass(/selected/);
});

test("boundary colors tint the background, border and label and persist with intensity", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await page.getByTitle("Add Boundary", { exact: true }).click();
  const boundaryId = (await page.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  const boundary = page.locator(`.react-flow__node[data-id="${boundaryId}"] .architecture-node.boundary`);
  await boundary.locator('.boundary-label').dblclick();
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  const fills: string[] = [], borders: string[] = [], labels: string[] = [];
  for (const tone of ["green", "blue", "purple", "orange", "rose", "slate"]) {
    await properties.getByRole("button", { name: `${tone} color`, exact: true }).click();
    await expect(boundary).toHaveClass(new RegExp(`tone-${tone}`));
    await boundary.evaluate(async element => {
      getComputedStyle(element).borderColor;
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    const colors = await boundary.evaluate(element => ({
      fill: getComputedStyle(element).backgroundColor,
      border: getComputedStyle(element).borderColor,
      label: getComputedStyle(element.querySelector('.boundary-label')!).color,
    }));
    fills.push(colors.fill); borders.push(colors.border); labels.push(colors.label);
    expect(colors.fill).toMatch(/^rgba\(.+, 0\.0/);
  }
  expect(new Set(fills).size).toBe(6);
  expect(new Set(borders).size).toBe(6);
  expect(new Set(labels).size).toBe(6);
  await page.keyboard.press("Escape");
  await openProperties(page);
  await page.getByRole("slider", { name: "Color intensity", exact: true }).press("End");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Board settings", exact: true })).toHaveCount(0);
  const deepFill = await boundary.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(deepFill).not.toBe(fills.at(-1));
  expect(Number(deepFill.match(/, ([\d.]+)\)$/)![1])).toBeLessThan(0.07);
  await expect(boundary).toHaveCSS("border-color", "rgb(70, 95, 91)");
  await expect(boundary.locator('.boundary-label')).toHaveCSS("color", "rgb(70, 95, 91)");
  expect(cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === boundaryId).data.tone).toBe("slate");
  await page.reload();
  await expect(boundary).toHaveCSS("background-color", deepFill);
  await expect(boundary).toHaveCSS("border-color", "rgb(70, 95, 91)");
});

test("new boards use duotone independently of another board's icon set", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await openProperties(page);
  await page.getByRole("button", { name: "Architecture symbols", exact: true }).click();
  await expectIconPreview(page, "architecture");
  await closeIconPreview(page);
  await page.getByRole("slider", { name: "Color intensity", exact: true }).press("End");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.iconStyle).toBe("architecture");
  await expect(page.getByRole("dialog", { name: "Board settings", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await page.getByRole("button", { name: "Create a board", exact: true }).click();
  await page.getByRole("button", { name: /A clean slate/ }).click();
  await expect(page.locator('.component-tile svg[data-icon-style="duotone"]')).toHaveCount(componentKinds.length);
  await expect(page.locator(".app-shell")).toHaveAttribute("data-color-intensity", "0");
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect(page.locator('.architecture-node svg[data-icon-style="duotone"]')).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await page.getByRole("button", { name: "Open Saved production system", exact: true }).click();
  await expect(page.locator('.component-tile svg[data-icon-style="architecture"]')).toHaveCount(componentKinds.length);
  await expect(page.locator('.architecture-node svg[data-icon-style="architecture"]')).toHaveCount(9);
  await expect(page.locator(".app-shell")).toHaveAttribute("data-color-intensity", "100");
});

for (const { id, label } of componentIconSets) {
  test(`${label} popups match component colors at Soft, intermediate and Deep intensity`, async ({ page }) => {
    await mockCloud(page);
    await signIn(page);
    await page.goto("./#/board/" + invite);
    await openProperties(page);
    const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
    const slider = settings.getByRole("slider", { name: "Color intensity", exact: true });
    for (const depth of [0, 50, 100]) {
      await slider.press("Home");
      if (depth === 50) for (let step = 0; step < 5; step++) await slider.press("PageUp");
      if (depth === 100) await slider.press("End");
      await expect(slider).toHaveValue(String(depth));
      await settings.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("region", { name: / icon preview$/ })).toHaveCount(0);
      await settings.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(settings).toHaveCount(0);
      await openProperties(page);
      await settings.getByRole("button", { name: label, exact: true }).click();
      await expectIconPreview(page, id);
      const popup = page.getByRole("region", { name: `${label} icon preview`, exact: true });
      await expect(popup).toContainText(`${depth}% intensity`);
      await expect.poll(() => page.evaluate(() => {
        const mismatches: string[] = [];
        for (const tile of document.querySelectorAll('.icon-set-preview-grid li')) {
          const badge = tile.querySelector('.node-icon')!;
          if (getComputedStyle(tile.querySelector('svg')!).color !== getComputedStyle(badge).color)
            mismatches.push(`${tile.textContent}: icon color`);
          const tone = [...tile.classList].find(name => name.startsWith('tone-'))!;
          const node = document.querySelector(`.architecture-node.${tone}:not(.note):not(.text):not(.boundary)`);
          if (!node) continue;
          const nodeBadge = node.querySelector('.node-icon')!;
          if (getComputedStyle(tile).backgroundColor !== getComputedStyle(node).backgroundColor)
            mismatches.push(`${tile.textContent}: fill`);
          if (getComputedStyle(tile).borderColor !== getComputedStyle(node).borderColor)
            mismatches.push(`${tile.textContent}: border`);
          if (getComputedStyle(badge).backgroundColor !== getComputedStyle(nodeBadge).backgroundColor)
            mismatches.push(`${tile.textContent}: badge`);
          if (getComputedStyle(tile.querySelector('svg')!).color !== getComputedStyle(nodeBadge.querySelector('svg')!).color)
            mismatches.push(`${tile.textContent}: diagram icon`);
        }
        return mismatches;
      })).toEqual([]);
      if (depth === 0) {
        await expect(popup.locator('.tone-blue svg').first()).toHaveCSS("color", "rgb(90, 128, 163)");
        await expect(popup.locator('.tone-purple svg').first()).toHaveCSS("color", "rgb(147, 118, 174)");
      } else if (depth === 100) {
        for (const icon of await popup.locator('li svg').all())
          await expect(icon).toHaveCSS("color", "rgb(255, 255, 255)");
      }
      await closeIconPreview(page);
    }
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator('.react-flow__node[data-id="api"]').dblclick();
    const properties = page.getByRole("dialog", { name: "Properties", exact: true });
    await expect(properties.locator('.selected-component .node-icon svg')).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(properties.locator('.selected-component .node-icon')).toHaveCSS("background-color", "rgb(29, 107, 80)");
  });
}

for (const { id, label } of componentIconSets.filter(({ id }) => id !== "duotone")) {
  test(`${label} covers every palette component and persists for existing and new nodes`, async ({ page }) => {
    const cloud = await mockCloud(page);
    await signIn(page);
    await page.goto("./#/board/" + invite);
    const serviceIcon = page.locator('.react-flow__node[data-id="api"] svg[data-icon-style]');
    await expect(serviceIcon).toBeVisible();
    const originalArtwork = await iconArtwork(serviceIcon);
    await openProperties(page);
    const settings = page.getByRole("dialog", { name: "Board settings", exact: true });
    const choice = settings.getByRole("button", { name: label, exact: true });
    await choice.click();
    await expectIconPreview(page, id);
    await closeIconPreview(page);
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await settings.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(page.locator(`.architecture-node svg[data-icon-style="${id}"]`)).toHaveCount(9);
    const palette = page.locator(`.component-tile svg[data-icon-style="${id}"]`);
    await expect(palette).toHaveCount(componentKinds.length);
    expect(await palette.evaluateAll(icons => icons.every(icon => icon.children.length > 0))).toBe(true);
    const selectedArtwork = await iconArtwork(page.getByTitle("Add Service", { exact: true }).locator("svg[data-icon-style]"));
    expect(await iconArtwork(serviceIcon)).toEqual(selectedArtwork);
    expect(selectedArtwork).not.toEqual(originalArtwork);
    if (id === "technical") {
      await expect(palette.first().locator('[fill-opacity]').first()).toHaveCSS("fill-opacity", "0");
    }
    await page.getByTitle("Add Service", { exact: true }).click();
    await expect(page.locator(`.architecture-node svg[data-icon-style="${id}"]`)).toHaveCount(10);
    await expect.poll(() => cloud.rows[0].document.iconStyle).toBe(id);
    await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
    await page.reload();
    await expect(page.locator(`.architecture-node svg[data-icon-style="${id}"]`)).toHaveCount(10);
    expect(await iconArtwork(serviceIcon)).toEqual(selectedArtwork);
    await openProperties(page);
    await expect(choice).toHaveAttribute("aria-pressed", "true");
  });
}

test("the board icon set choices fit and work in narrow Settings", async ({ page }) => {
  await mockCloud(page);
  await signIn(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("./#/board/" + invite);
  await openProperties(page);
  const popup = page.getByRole("dialog", { name: "Board settings", exact: true });
  for (const { id, label } of componentIconSets) {
    const choice = popup.getByRole("button", { name: label, exact: true });
    await choice.click();
    await expectIconPreview(page, id);
    const tiles = await page.getByRole("list", { name: "Selected icon set preview", exact: true }).getByRole("listitem").evaluateAll(items => items.map(item => {
      const bounds = item.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    }));
    expect(tiles.every(({ left, right }) => left >= 0 && right <= 320)).toBe(true);
    await closeIconPreview(page);
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('.architecture-node svg[data-icon-style="duotone"]')).toHaveCount(9);
    const bounds = await choice.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
  const colors = popup.getByRole("group", { name: "Color intensity", exact: true });
  await colors.getByRole("slider", { name: "Color intensity", exact: true }).press("End");
  const previewBounds = (await colors.getByRole("img").boundingBox())!;
  expect(previewBounds.x).toBeGreaterThanOrEqual(0);
  expect(previewBounds.x + previewBounds.width).toBeLessThanOrEqual(320);
  const colorBounds = await colors.boundingBox();
  expect(colorBounds!.x).toBeGreaterThanOrEqual(0);
  expect(colorBounds!.x + colorBounds!.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('centers the footer timestamp and divided bottom dock without overlapping controls', async ({ page }, testInfo) => {
  await mockCloud(page);
  await signIn(page);
  for (const width of [360, 684, 768, 1440, 1800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./#/board/' + invite);
    await expect(page.locator('.footer-sync')).toHaveText(/^Synced \d{2}:\d{2} [AP]M$/);
    const layout = await page.evaluate((width) => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const tools = rect('.canvas-toolbar'), zoom = rect('.zoom-controls'), dock = rect('.canvas-dock'), canvas = rect('#main-content');
      const sidebar = rect('.sidebar'), sync = rect('.footer-sync');
      const change = rect('.footer-board-change'), version = rect('.app-version');
      return { sidebarVisible: sidebar.width > 0, seamOffset: sync.right - sidebar.right, centerOffset: (dock.left + dock.width / 2) - (canvas.left + canvas.width / 2), divider: rect('.dock-divider').width > 0, gap: canvas.bottom - dock.bottom, footerTextTop: rect('.app-version').top + 10, dockBottom: dock.bottom,
        timestampCenterOffset: (change.left + change.width / 2) - (canvas.left + canvas.width / 2),
        timestampRowOffset: change.top + change.height / 2 - (sync.top + sync.height / 2),
        metadataOverlap: width > 640 ? sync.right > change.left || change.right > version.left : change.top < Math.max(sync.bottom, version.bottom),
        overlap: tools.left < zoom.right && tools.right > zoom.left && tools.top < zoom.bottom && tools.bottom > zoom.top,
        overflow: document.documentElement.scrollWidth > innerWidth };
    }, width);
    expect(layout.centerOffset).toBeCloseTo(0, 0);
    expect(layout.divider).toBe(true);
    if (width > 760 && layout.sidebarVisible) expect(layout.seamOffset).toBeCloseTo(0, 0);
    expect(layout.gap).toBeCloseTo(-8, 0);
    expect(layout.dockBottom).toBeLessThan(layout.footerTextTop);
    expect(layout.overlap).toBe(false);
    expect(layout.timestampCenterOffset).toBeCloseTo(0, 0);
    if (width > 640) expect(layout.timestampRowOffset).toBeCloseTo(0, 0);
    expect(layout.metadataOverlap).toBe(false);
    expect(layout.overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`footer-${width}.png`) });
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
  await expect(page.locator('.app-footer .footer-board-change')).toContainText('Last board change:');
  await expect(page.locator('.app-footer .footer-board-change time')).toHaveAttribute('datetime', cloud.rows[0].updated_at);
  await expect(page.locator('.react-flow__attribution')).toHaveCount(0);
  await page.getByTitle("Add Service", { exact: true }).click();
  await expect.poll(() => cloud.rows[0].document.nodes.length).toBe(10);
  await page.getByRole("button", { name: "Open your boards" }).click();
  await expect(page.locator('.footer-sync')).toHaveText(/^Synced \d{2}:\d{2} [AP]M$/);
  await expect(page.locator('.footer-board-change')).toHaveCount(0);
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

test("unlisted board invitations ask for Join before editing", async ({
  page,
}) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  await page.goto("./#/board/" + invite);
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
  await page.goto("./#/");
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
  await other.goto("http://127.0.0.1:5194/#/");
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
  await page.goto("./#/");
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

test("an invalid sync protocol shows setup guidance and never sends document writes", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  cloud.returnInvalidProtocol();
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.getByRole("main", { name: "All boards" })).toBeVisible();
  await expect(page.locator(".architecture-node")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("schema.sql");
  await page.waitForTimeout(1000);
  expect(cloud.writes).toEqual([]);
});

test("an invalid sync protocol discovered after loading cancels pending shared writes", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(
    page.locator(".connection").filter({ hasText: "Connected" }),
  ).toBeVisible();
  await page.getByTitle("Add Service", { exact: true }).click();
  cloud.returnInvalidProtocol();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTitle("Add Service", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Board settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("schema.sql");
  await page.waitForTimeout(900);
  expect(cloud.writes).toEqual([]);
  expect(cloud.rows[0].document.nodes.length).toBe(9);
});

test("unsupported routes fail without opening a board or rewriting the URL", async ({ page }) => {
  const cloud = await mockCloud(page, false);
  await signIn(page);
  for (const hash of ["#/board", "#/board/", "#/editor", "#/join/" + invite, "#board/" + invite]) {
    await page.goto("./" + hash);
    await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".react-flow")).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe(hash);
  }
  expect(cloud.joins).toBe(0);
  expect(cloud.writes).toEqual([]);
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

test("a committed save with a lost reply is acknowledged without another write", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  cloud.loseNextSaveReply();
  await page.getByTitle("Add Cache", { exact: true }).click();
  await expect.poll(() => cloud.rows[0].revision).toBe(2);
  await expect(page.locator(".connection")).toHaveText("Needs attention");
  // Visibility refresh uses the same path as the next automatic poll.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".connection")).toHaveText("Connected");
  expect(cloud.writes).toEqual(["PATCH"]);
  await page.reload();
  await expect(page.locator(".architecture-node")).toHaveCount(10);
  await expect(page.locator(".connection")).toHaveText("Connected");
  expect(cloud.writes).toEqual(["PATCH"]);
});

test("independent remote properties merge automatically while genuine conflicts stop repeated document downloads", async ({ page }) => {
  const cloud = await mockCloud(page);
  await signIn(page);
  await page.goto("./#/board/" + invite);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); window.dispatchEvent(new Event("offline")); });
  const note = cloud.rows[0].document.nodes.find((node: { data: { kind: string } }) => node.data.kind === "note");
  const editor = page.locator(`.react-flow__node[data-id="${note.id}"]`).getByRole("textbox", { name: "Note description", exact: true });
  await editor.fill("Our offline note");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("blueprint.workspace.v1") || "{}").boards?.[0]?.nodes.find((node: { data: { kind: string } }) => node.data.kind === "note")?.data.description)).toBe("Our offline note");
  note.data.label = "Their independent heading";
  cloud.rows[0].revision++;
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === note.id).data.description).toBe("Our offline note");
  expect(cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === note.id).data.label).toBe("Their independent heading");
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); window.dispatchEvent(new Event("offline")); });
  await editor.fill("Our conflicting note");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("blueprint.workspace.v1") || "{}").boards?.[0]?.nodes.find((node: { data: { kind: string } }) => node.data.kind === "note")?.data.description)).toBe("Our conflicting note");
  cloud.rows[0].document.nodes.find((node: { id: string }) => node.id === note.id).data.description = "Their conflicting note";
  cloud.rows[0].revision++;
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); window.dispatchEvent(new Event("online")); });
  await expect(page.locator(".connection")).toHaveText("Needs attention");
  await expect(editor).toHaveValue("Our conflicting note");
  const before = cloud.downloaded.length;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => cloud.polls.length).toBeGreaterThan(before);
  expect(cloud.downloaded.at(-1)).toEqual([]);
  expect(cloud.polls.at(-1)?.[cloud.rows[0].id]).toBe(cloud.rows[0].revision);
});

test("separate tabs serialize durable drafts without Web Locks and reject overlapping edits", async ({ page }) => {
  await mockCloud(page);
  await signIn(page);
  await page.goto("./");
  await expect(page.locator(".connection")).toHaveText("Connected");
  const other = await page.context().newPage();
  await mockCloud(other);
  await other.goto("http://127.0.0.1:5194/");
  await expect(other.locator(".connection")).toHaveText("Connected");
  const board = createBoard();
  const initial = { boards: [board], activeId: board.id };
  const key = "blueprint.workspace.v1.storage-concurrency";
  await page.evaluate(({ key, initial }) => localStorage.setItem(key, JSON.stringify(initial)), { key, initial });
  for (const tab of [page, other]) {
    await tab.evaluate(async () => {
      Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
      const modulePath = "/src/infrastructure/storage/workspace.ts";
      const { workspaceStorage } = await import(modulePath);
      const storage = workspaceStorage("storage-concurrency");
      const draft = structuredClone(storage.load());
      Object.assign(window, { concurrentWorkspace: { storage, draft } });
    });
  }
  const save = (tab: Page, field: string, value: string) => tab.evaluate(async ({ field, value }) => {
    const state = (window as unknown as { concurrentWorkspace: { storage: { save: (value: string) => Promise<unknown> }; draft: { boards: Record<string, unknown>[] } } }).concurrentWorkspace;
    state.draft.boards[0][field] = value;
    return state.storage.save(JSON.stringify(state.draft));
  }, { field, value });
  await Promise.all([save(page, "title", "First tab's title"), save(other, "description", "Second tab's description")]);
  const combined = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(combined.boards[0]).toMatchObject({ title: "First tab's title", description: "Second tab's description" });
  // Both adapters have their own stale snapshots; changing the same field must
  // not replace an edit that the other tab already acknowledged.
  await save(page, "title", "Acknowledged title");
  await expect(save(other, "title", "Overlapping title")).rejects.toThrow("another tab");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).boards[0].title, key)).toBe("Acknowledged title");
  const recovery = await other.evaluate(async () => {
    const modulePath = "/src/infrastructure/storage/workspace.ts";
    const { workspaceStorage } = await import(modulePath);
    const state = (window as any).concurrentWorkspace;
    state.storage.stage(JSON.stringify(state.draft));
    const reopened = workspaceStorage("storage-concurrency");
    const draft = reopened.load();
    const recoveredTitle = draft.boards[0].title;
    let refused = false;
    try { await reopened.save(JSON.stringify(draft)); } catch { refused = true; }
    const copy = { ...draft.boards[0], id: crypto.randomUUID(), revision: 0, inviteCode: undefined, cloudSavedContent: undefined };
    await reopened.save(JSON.stringify({ boards: [copy], activeId: copy.id }));
    return { recoveredTitle, refused, journal: sessionStorage.getItem("blueprint.workspace.v1.storage-concurrency.pending"), boards: JSON.parse(localStorage.getItem("blueprint.workspace.v1.storage-concurrency")!).boards };
  });
  expect(recovery.recoveredTitle).toBe("Overlapping title");
  expect(recovery.refused).toBe(true);
  expect(recovery.journal).toBeNull();
  expect(recovery.boards.map((item: { title: string }) => item.title).sort()).toEqual(["Acknowledged title", "Overlapping title"]);
});
