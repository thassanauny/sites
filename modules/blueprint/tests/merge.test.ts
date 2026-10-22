import { describe, expect, it } from "vitest";
import { boardContent } from "../src/domain/boards/codec";
import { makeNode } from "../src/domain/boards/components";
import { mergeBoardContent, mergeCloudBoard } from "../src/domain/boards/merge";
import { createBoard } from "../src/domain/boards/templates";
import { mergeDeviceWorkspace } from "../src/domain/boards/workspace";

function shared() {
  const board = { ...createBoard(), revision: 1, inviteCode: "a".repeat(32) };
  return { ...board, cloudSavedContent: boardContent(board) };
}

describe("independent diagram edits", () => {
  it("retains local selection on clean refresh while accepting remote persisted sizes and fields", () => {
    const local = shared();
    local.nodes[0].selected = true;
    local.nodes[0].measured = { width: 123, height: 90 };
    local.edges[0].selected = true;
    const remote = structuredClone(local);
    delete remote.nodes[0].selected;
    delete remote.edges[0].selected;
    remote.nodes[0].data.label = "Remote name";
    remote.nodes[0].style = { width: 600 };
    remote.revision = 2;
    const merged = mergeCloudBoard(local, remote);
    expect(merged.nodes[0]).toMatchObject({ selected: true, measured: { width: 123, height: 90 },
      style: { width: 600 }, data: { label: "Remote name" } });
    expect(merged.edges[0].selected).toBe(true);
    expect(merged.cloudSavedContent).toBe(boardContent(remote));
  });
  it("rebases separate node properties and board settings without losing selection or viewport", () => {
    const base = shared();
    const local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].data.description = "Our explanation";
    local.nodes[0].selected = true;
    local.viewport = { x: 30, y: 40, zoom: 0.5 };
    remote.nodes[0].data.label = "Their name";
    remote.description = "Shared board settings";
    remote.revision = 2;
    const merged = mergeCloudBoard(local, remote);
    expect(merged.nodes[0].data).toMatchObject({ label: "Their name", description: "Our explanation" });
    expect(merged.nodes[0].selected).toBe(true);
    expect(merged.viewport).toEqual(local.viewport);
    expect(merged.description).toBe(remote.description);
    expect(merged.revision).toBe(2);
    expect(merged.cloudSavedContent).toBe(boardContent(remote));
    expect(boardContent(merged)).not.toBe(merged.cloudSavedContent);
  });

  it("combines independent additions and connection properties", () => {
    const base = shared();
    const local = structuredClone(base), remote = structuredClone(base);
    const node = makeNode("cache", { x: 50, y: 60 });
    local.nodes.push(node);
    local.edges[0].label = "Our label";
    remote.nodes.push(makeNode("service", { x: 70, y: 80 }));
    remote.edges[0].animated = !base.edges[0].animated;
    const merged = mergeBoardContent(boardContent(base), local, remote)!;
    expect(merged.nodes).toHaveLength(base.nodes.length + 2);
    expect(merged.nodes).toContainEqual(node);
    expect(merged.edges[0]).toMatchObject({ label: "Our label", animated: remote.edges[0].animated });
  });

  it.each([
    [{ x: 50, y: 60 }, { x: 70, y: 80 }],
    [{ x: 50, y: 0 }, { x: 0, y: 80 }],
  ])("accepts a competing shared move as a whole position and retains independent edits (%j, %j)", (ours, theirs) => {
    const base = shared();
    base.nodes[0].position = { x: 0, y: 0 };
    base.cloudSavedContent = boardContent(base);
    const local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].position = ours;
    local.nodes[0].data.description = "Our explanation";
    local.nodes[0].selected = true;
    remote.nodes[0].position = theirs;
    remote.nodes[1].data.label = "Their name";
    remote.revision = 2;
    const merged = mergeCloudBoard(local, remote);
    expect(merged.nodes[0]).toMatchObject({ position: theirs, selected: true, data: { description: "Our explanation" } });
    expect(merged.nodes[1].data.label).toBe("Their name");
    expect(merged.revision).toBe(2);
    expect(merged.cloudSavedContent).toBe(boardContent(remote));
    expect(boardContent(merged)).not.toBe(merged.cloudSavedContent);
    expect(mergeCloudBoard(merged, base)).toBe(merged);
  });

  it("acknowledges competing moves without another upload when no independent edits remain", () => {
    const base = shared();
    const local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].position = { x: 50, y: 60 };
    remote.nodes[0].position = { x: 70, y: 80 };
    remote.revision = 2;
    const merged = mergeCloudBoard(local, remote);
    expect(merged.nodes[0].position).toEqual(remote.nodes[0].position);
    expect(boardContent(merged)).toBe(merged.cloudSavedContent);
    expect(merged.revision).toBe(2);
  });

  it("keeps same-property and delete-versus-edit conflicts untouched", () => {
    const base = shared();
    const local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].data.label = "Ours";
    remote.nodes[0].data.label = "Theirs";
    local.nodes[0].position = { x: 50, y: 60 };
    remote.nodes[0].position = { x: 70, y: 80 };
    remote.revision = 2;
    expect(mergeCloudBoard(local, remote)).toBe(local);
    remote.nodes = remote.nodes.filter(node => node.id !== local.nodes[0].id);
    remote.edges = remote.edges.filter(edge => edge.source !== local.nodes[0].id && edge.target !== local.nodes[0].id);
    expect(mergeCloudBoard(local, remote)).toBe(local);
  });

  it("refuses a merge that would leave an independently added connection dangling", () => {
    const base = shared();
    const local = structuredClone(base), remote = structuredClone(base);
    const id = local.nodes[0].id;
    local.nodes = local.nodes.filter(node => node.id !== id);
    local.edges = local.edges.filter(edge => edge.source !== id && edge.target !== id);
    remote.edges.push({ id: "new-edge", source: id, target: remote.nodes[1].id });
    expect(mergeBoardContent(boardContent(base), local, remote)).toBeUndefined();
  });

  it("acknowledges equal cloud contents after a lost save reply without another write", () => {
    const base = shared();
    const local = { ...base, title: "Saved before the response was lost" };
    const remote = { ...local, revision: 2, cloudSavedContent: undefined };
    const acknowledged = mergeCloudBoard(local, remote);
    expect(acknowledged.revision).toBe(2);
    expect(acknowledged.cloudSavedContent).toBe(boardContent(acknowledged));
    const newer = { ...local, description: "Typed during the request" };
    const merged = mergeCloudBoard(newer, remote);
    expect(merged.description).toBe(newer.description);
    expect(merged.revision).toBe(2);
    expect(merged.cloudSavedContent).toBe(boardContent(remote));
  });
});

describe("durable changes from another tab", () => {
  it("keeps the durable position when tabs move the same component, without losing other changes", () => {
    const board = shared();
    const base = { boards: [board], activeId: board.id };
    const local = structuredClone(base), latest = structuredClone(base);
    local.boards[0].nodes[0].position = { x: 50, y: 60 };
    local.boards[0].description = "Our draft";
    latest.boards[0].nodes[0].position = { x: 70, y: 80 };
    const merged = mergeDeviceWorkspace(base, local, latest)!;
    expect(merged.boards[0].nodes[0].position).toEqual({ x: 70, y: 80 });
    expect(merged.boards[0].description).toBe("Our draft");
  });

  it("retains independent board drafts and newer cloud acknowledgements", () => {
    const board = shared(), second = shared();
    const base = { boards: [board], activeId: board.id };
    const local = { boards: [{ ...board, description: "Local draft" }], activeId: board.id };
    const accepted = { ...board, title: "Other tab", revision: 2 };
    accepted.cloudSavedContent = boardContent(accepted);
    const latest = { boards: [accepted, second], activeId: second.id };
    const merged = mergeDeviceWorkspace(base, local, latest)!;
    expect(merged.activeId).toBe(board.id);
    expect(merged.boards[0]).toMatchObject({ title: "Other tab", description: "Local draft", revision: 2, cloudSavedContent: accepted.cloudSavedContent });
    expect(merged.boards[1]).toEqual(second);
  });

  it("rejects overlapping drafts instead of acknowledging an overwritten edit", () => {
    const board = shared();
    const base = { boards: [board], activeId: board.id };
    const local = { ...base, boards: [{ ...board, title: "Ours" }] };
    const latest = { ...base, boards: [{ ...board, title: "Theirs" }] };
    expect(mergeDeviceWorkspace(base, local, latest)).toBeUndefined();
    expect(latest.boards[0].title).toBe("Theirs");
    expect(local.boards[0].title).toBe("Ours");
  });

  it("honors an explicit removal of an unchanged local draft and retains a newer competing draft", () => {
    const board = shared();
    const base = { boards: [board], activeId: board.id };
    const removed = { boards: [], activeId: "" };
    expect(mergeDeviceWorkspace(base, removed, base)?.boards).toEqual([]);
    const changed = { ...base, boards: [{ ...board, description: "Other tab's new draft" }] };
    expect(mergeDeviceWorkspace(base, removed, changed)?.boards).toEqual(changed.boards);
    expect(mergeDeviceWorkspace(base, base, removed)?.boards).toEqual([]);
  });
});
