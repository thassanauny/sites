import { expect, test, type Browser, type Page } from "@playwright/test";
import { makeNode } from "../src/domain/boards/components";
import { createBoard } from "../src/domain/boards/templates";
import { collaborationUsers, collaborativeCloud, invite } from "./support/cloud";

function sharedBoard() {
  const board = createBoard("blank");
  board.title = "Team architecture";
  board.nodes = [
    { ...makeNode("service", { x: 0, y: 0 }, { label: "API", description: "Original service" }), id: "team-api" },
    { ...makeNode("database", { x: 340, y: 0 }, { label: "Database" }), id: "team-database" },
    { ...makeNode("note", { x: 170, y: 220 }, { label: "Team note", description: "Original shared note" }), id: "team-note" },
  ];
  board.edges = [{ id: "team-link", source: "team-api", target: "team-database", sourceHandle: "right", targetHandle: "left", label: "Original connection" }];
  return board;
}

async function openTeam(browser: Browser, baseURL: string) {
  const cloud = collaborativeCloud(sharedBoard());
  const contexts = await Promise.all([browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } }), browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } })]);
  await Promise.all([cloud.attach(contexts[0], collaborationUsers.creator), cloud.attach(contexts[1], collaborationUsers.collaborator)]);
  const [alice, bob] = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all([alice.goto("./#/board/" + invite), bob.goto("./#/board/" + invite)]);
  await expect(alice.locator(".header-board-title")).toHaveText("Team architecture");
  const join = bob.getByRole("dialog");
  await expect(join.getByLabel("Invitation code or link")).toHaveValue(invite);
  expect(cloud.members()).toEqual([collaborationUsers.creator]);
  await join.getByRole("button", { name: "Join board", exact: true }).click();
  for (const page of [alice, bob]) {
    await expect(page.locator(".header-board-title")).toHaveText("Team architecture");
    await expect(page.locator(".connection")).toHaveText("Connected");
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
  }
  await expect.poll(() => cloud.subscriptions().sort()).toEqual([collaborationUsers.creator, collaborationUsers.collaborator].sort());
  const identities = await Promise.all([alice, bob].map(page => page.evaluate(() => JSON.parse(localStorage.getItem("blueprint-auth")!).user.id)));
  expect(identities).toEqual([collaborationUsers.creator, collaborationUsers.collaborator]);
  return { alice, bob, contexts, cloud, close: () => Promise.all(contexts.map(context => context.close())) };
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const note = (page: Page) => node(page, "team-note").getByRole("textbox", { name: "Note description", exact: true });
async function nameNode(page: Page, id: string, name: string) {
  await node(page, id).dblclick();
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  await properties.getByLabel("Name", { exact: true }).fill(name);
  await properties.getByRole("button", { name: "Close properties", exact: true }).click();
}
async function moveNode(page: Page, id: string, dx = 75, dy = 55) {
  const drag = node(page, id).locator(".node-copy strong");
  const bounds = (await drag.boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}
async function expectPosition(page: Page, id: string, position: { x: number; y: number }) {
  await expect.poll(() => node(page, id).evaluate(element => element.style.transform)).toBe(`translate(${position.x}px, ${position.y}px)`);
}
async function openConnection(page: Page) {
  // A horizontal SVG path has zero layout height, so locator clicks cannot
  // find its target. Use the actual curve midpoint in screen coordinates.
  const curve = page.locator('.react-flow__edge[data-id="team-link"] .react-flow__edge-interaction');
  await expect(async () => {
    const point = await curve.evaluate(element => {
      const path = element as SVGPathElement;
      const midpoint = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = midpoint.matrixTransform(path.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.getByRole("dialog", { name: "Properties", exact: true })).toBeVisible({ timeout: 500 });
  }).toPass();
}

test("an invited collaborator can add, move and edit, with live updates in both independent profiles", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud } = team;
  try {
    await alice.getByTitle("Add Cache", { exact: true }).click();
    await expect(bob.locator(".react-flow__node")).toHaveCount(4);
    await nameNode(bob, "team-api", "API edited by collaborator");
    await expect(node(alice, "team-api").locator("strong")).toHaveText("API edited by collaborator");
    const before = cloud.board().document.nodes.find(item => item.id === "team-database")!.position;
    await moveNode(bob, "team-database");
    await expect.poll(() => cloud.board().document.nodes.find(item => item.id === "team-database")!.position).not.toEqual(before);
    const position = cloud.board().document.nodes.find(item => item.id === "team-database")!.position;
    await expectPosition(alice, "team-database", position);
    expect(cloud.members().sort()).toEqual([collaborationUsers.creator, collaborationUsers.collaborator].sort());
    expect(cloud.writes.filter(write => write.accepted && write.userId === collaborationUsers.collaborator)).toHaveLength(2);
    expect(cloud.writes.every(write => write.expectedRevision !== undefined)).toBe(true);
  } finally { await team.close(); }
});

test("simultaneous independent additions and moves converge after a real revision rejection", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud } = team;
  const gate = cloud.holdNextSaves();
  try {
    const before = cloud.board().document.nodes.find(item => item.id === "team-database")!.position;
    await Promise.all([alice.getByTitle("Add Cache", { exact: true }).click(), moveNode(bob, "team-database")]);
    await expect.poll(() => gate.arrived).toBe(2);
    gate.release();
    await expect.poll(() => cloud.writes.filter(write => write.accepted).length).toBe(2);
    expect(cloud.writes.some(write => !write.accepted)).toBe(true);
    const merged = cloud.board();
    expect(merged.document.nodes).toHaveLength(4);
    expect(new Set(merged.document.nodes.map(item => item.id)).size).toBe(4);
    const position = merged.document.nodes.find(item => item.id === "team-database")!.position;
    expect(position).not.toEqual(before);
    for (const page of [alice, bob]) {
      await expect(page.locator(".react-flow__node")).toHaveCount(4);
      await expectPosition(page, "team-database", position);
      await expect(page.locator(".connection")).toHaveText("Connected");
    }
    expect(cloud.writes.every(write => write.expectedRevision !== undefined)).toBe(true);
  } finally { gate.release(); await team.close(); }
});

test("offline and online independent edits converge on reconnect without losing either user's additions", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud, contexts } = team;
  try {
    await contexts[0].setOffline(true);
    await expect(alice.locator(".connection")).toHaveText("Offline");
    await alice.getByTitle("Add Cache", { exact: true }).click();
    await nameNode(alice, "team-api", "Offline API edit");
    await expect(alice.locator(".react-flow__node")).toHaveCount(4);
    expect(cloud.writes).toEqual([]);
    await note(bob).fill("Online collaborator's note");
    await bob.getByTitle("Add Message queue", { exact: true }).click();
    await expect.poll(() => cloud.board().document.nodes.length).toBe(4);
    await expect.poll(() => cloud.board().document.nodes.find(item => item.id === "team-note")!.data.description).toBe("Online collaborator's note");
    await contexts[0].setOffline(false);
    await expect.poll(() => cloud.board().document.nodes.length).toBe(5);
    for (const page of [alice, bob]) {
      await expect(page.locator(".react-flow__node")).toHaveCount(5);
      await expect(node(page, "team-api").locator("strong")).toHaveText("Offline API edit");
      await expect(note(page)).toHaveValue("Online collaborator's note");
      await expect(page.locator(".connection")).toHaveText("Connected");
    }
    expect(cloud.writes.every(write => write.expectedRevision !== undefined)).toBe(true);
  } finally { await team.close(); }
});

test("same-field concurrent edits keep the losing draft through reload and recover it as a separate board", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud } = team;
  const gate = cloud.holdNextSaves();
  try {
    const edits = new Map([[collaborationUsers.creator, "Alice's conflicting note"], [collaborationUsers.collaborator, "Bob's conflicting note"]]);
    await Promise.all([note(alice).fill(edits.get(collaborationUsers.creator)!), note(bob).fill(edits.get(collaborationUsers.collaborator)!)]);
    await expect.poll(() => gate.arrived).toBe(2);
    gate.release();
    await expect.poll(() => cloud.writes.length).toBe(2);
    const accepted = cloud.writes.find(write => write.accepted)!;
    expect(cloud.writes.filter(write => write.accepted)).toHaveLength(1);
    const loserId = accepted.userId === collaborationUsers.creator ? collaborationUsers.collaborator : collaborationUsers.creator;
    const loser = loserId === collaborationUsers.creator ? alice : bob;
    const winner = loser === alice ? bob : alice;
    await expect(loser.locator(".connection")).toHaveText("Needs attention");
    await expect(note(loser)).toHaveValue(edits.get(loserId)!);
    await expect(note(winner)).toHaveValue(edits.get(accepted.userId)!);
    expect(cloud.board().document.nodes.find(item => item.id === "team-note")!.data.description).toBe(edits.get(accepted.userId));
    await loser.reload();
    await expect(note(loser)).toHaveValue(edits.get(loserId)!);
    await expect(loser.locator(".connection")).toHaveText("Needs attention");
    await loser.getByRole("button", { name: "Board settings", exact: true }).click();
    await loser.getByRole("button", { name: "Save my changes as a new board", exact: true }).click();
    await expect.poll(() => cloud.boards().length).toBe(2);
    const copy = cloud.boards().find(row => row.id !== cloud.originalId)!;
    expect(copy.document.nodes.find(item => item.id === "team-note")!.data.description).toBe(edits.get(loserId));
    expect(copy.invite_code).not.toBe(invite);
    expect(cloud.board().document.nodes.find(item => item.id === "team-note")!.data.description).toBe(edits.get(accepted.userId));
    expect(cloud.writes.every(write => write.expectedRevision !== undefined)).toBe(true);
  } finally { gate.release(); await team.close(); }
});

test("remote changes preserve Properties and survive local undo and redo", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud } = team;
  try {
    await node(alice, "team-api").dblclick();
    const properties = alice.getByRole("dialog", { name: "Properties", exact: true });
    const name = properties.getByLabel("Name", { exact: true });
    await expect(name).toBeFocused();
    await nameNode(bob, "team-database", "Collaborator's database");
    await expect(node(alice, "team-database").locator("strong")).toHaveText("Collaborator's database");
    await expect(node(alice, "team-api")).toHaveClass(/selected/);
    await expect(properties).toBeVisible();
    await expect(name).toHaveValue("API");
    await expect(name).toBeFocused();
    await properties.getByRole("button", { name: "Close properties", exact: true }).click();
    await alice.getByTitle("Add Cache", { exact: true }).click();
    await expect(bob.locator(".react-flow__node")).toHaveCount(4);
    const ownCache = cloud.board().document.nodes.find(item => item.data.kind === "cache")!;
    await bob.getByTitle("Add Message queue", { exact: true }).click();
    await expect(alice.locator(".react-flow__node")).toHaveCount(5);
    const remoteQueue = cloud.board().document.nodes.find(item => item.data.kind === "queue")!;
    const undo = alice.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(node(alice, ownCache.id)).toHaveCount(0);
    await expect.poll(() => cloud.board().document.nodes.some(item => item.id === ownCache.id)).toBe(false);
    await expect(node(bob, ownCache.id)).toHaveCount(0);
    await expect(node(alice, remoteQueue.id)).toBeVisible();
    await expect(node(bob, remoteQueue.id)).toBeVisible();
    expect(cloud.board().document.nodes.some(item => item.id === remoteQueue.id)).toBe(true);
    const redo = alice.getByRole("button", { name: "Redo", exact: true });
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(node(alice, ownCache.id)).toBeVisible();
    await expect(node(bob, ownCache.id)).toBeVisible();
    await expect(node(alice, remoteQueue.id)).toBeVisible();
    await expect(node(bob, remoteQueue.id)).toBeVisible();
    expect(cloud.board().document.nodes).toHaveLength(5);
    expect(cloud.writes.every(write => write.expectedRevision !== undefined)).toBe(true);
  } finally { await team.close(); }
});

test("a Properties name being typed survives a conflicting collaborator edit before blur", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud } = team;
  const gate = cloud.holdNextSaves();
  try {
    await node(alice, "team-api").dblclick();
    const properties = alice.getByRole("dialog", { name: "Properties", exact: true });
    const name = properties.getByLabel("Name", { exact: true });
    await name.fill("Alice is still typing");
    await expect(name).toBeFocused();
    await nameNode(bob, "team-api", "Bob's simultaneous name");
    await expect.poll(() => gate.arrived).toBe(2);
    gate.release();
    await expect.poll(() => cloud.writes.length).toBe(2);
    const accepted = cloud.writes.find(write => write.accepted)!;
    const loser = accepted.userId === collaborationUsers.creator ? bob : alice;
    await expect(loser.locator(".connection")).toHaveText("Needs attention");
    await expect(properties).toBeVisible();
    await expect(name).toHaveValue("Alice is still typing");
    await expect(name).toBeFocused();
    expect(cloud.writes.filter(write => write.accepted)).toHaveLength(1);
    expect(cloud.writes.every(write => write.expectedRevision !== undefined)).toBe(true);
  } finally { gate.release(); await team.close(); }
});

test("blurring an unchanged connection editor after a remote rename cannot write its old label back", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud } = team;
  const edge = (page: Page) => page.locator('.react-flow__edge[data-id="team-link"]');
  try {
    await openConnection(alice);
    const firstProperties = alice.getByRole("dialog", { name: "Properties", exact: true });
    const label = firstProperties.getByLabel("Label", { exact: true });
    await expect(label).toHaveValue("Original connection");
    await expect(label).toBeFocused();
    await openConnection(bob);
    const secondProperties = bob.getByRole("dialog", { name: "Properties", exact: true });
    await secondProperties.getByLabel("Label", { exact: true }).fill("Collaborator's connection");
    await secondProperties.getByRole("button", { name: "Close properties", exact: true }).click();
    await expect(edge(alice).locator(".react-flow__edge-text")).toHaveText("Collaborator's connection");
    await expect(firstProperties).toBeVisible();
    await firstProperties.getByRole("button", { name: "Close properties", exact: true }).click();
    await expect(alice.locator(".connection")).toHaveText("Connected");
    // Reopen after the former input blurred: the old value must not become an edit.
    await openConnection(alice);
    await expect(alice.getByRole("dialog", { name: "Properties", exact: true }).getByLabel("Label", { exact: true })).toHaveValue("Collaborator's connection");
    expect(cloud.board().document.edges.find(item => item.id === "team-link")!.label).toBe("Collaborator's connection");
    expect(cloud.writes.filter(write => write.accepted && write.userId === collaborationUsers.creator)).toEqual([]);
  } finally { await team.close(); }
});

test("ending a device session removes its private channel and cancels pending collaboration writes", async ({ browser, baseURL }) => {
  const team = await openTeam(browser, baseURL!);
  const { alice, bob, cloud } = team;
  try {
    await alice.getByTitle("Add Cache", { exact: true }).click();
    await expect(alice.locator(".react-flow__node")).toHaveCount(4);
    const writesBefore = cloud.writes.length;
    const signOut = await alice.evaluate(async () => {
      const modulePath = "/src/infrastructure/cloud/client.ts";
      const { supabase } = await import(modulePath);
      const { error } = await supabase.auth.signOut({ scope: "local" });
      return error?.message;
    });
    expect(signOut).toBeUndefined();
    await expect.poll(() => cloud.subscriptions().includes(collaborationUsers.creator)).toBe(false);
    await expect(alice.getByTitle("Add Cache", { exact: true })).toBeDisabled();
    await alice.getByRole("button", { name: "Open Settings", exact: true }).click();
    await expect(alice.getByText("Your device session ended. Retry to reconnect, or rejoin using your invitation.", { exact: true })).toBeVisible();
    // The other member stays connected and can still publish an edit. It must
    // not wake the ended identity or flush its formerly scheduled draft.
    await note(bob).fill("The remaining collaborator is still connected");
    await expect.poll(() => cloud.board().document.nodes.find(item => item.id === "team-note")!.data.description).toBe("The remaining collaborator is still connected");
    await expect(bob.locator(".connection")).toHaveText("Connected");
    expect(cloud.writes.slice(writesBefore).every(write => write.userId === collaborationUsers.collaborator)).toBe(true);
    expect(cloud.board().document.nodes).toHaveLength(3);
    expect(cloud.subscriptions()).toEqual([collaborationUsers.collaborator]);
  } finally { await team.close(); }
});
