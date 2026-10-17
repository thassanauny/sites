import { describe, expect, it } from "vitest";
import { boardContent } from "../src/domain/boards/codec";
import {
  duplicateSelection,
  removeSelection,
} from "../src/domain/boards/editing";
import { createBoard } from "../src/domain/boards/templates";
import {
  mergeWorkspace,
  openWorkspaceBoard,
} from "../src/domain/boards/workspace";

describe("board editing and refresh rules", () => {
  it("keeps the workspace identity on an unchanged incremental poll, including selected nodes", () => {
    const board = createBoard();
    board.nodes[0].selected = true;
    const previous = { boards: [board], activeId: board.id };
    expect(mergeWorkspace(previous, [board], false)).toBe(previous);
    expect(board.nodes[0].selected).toBe(true);
  });
  it("copies connected selections with fresh IDs and no dangling edges", () => {
    const board = createBoard();
    const edge = board.edges[0];
    board.nodes.forEach((node) => {
      node.selected = node.id === edge.source || node.id === edge.target;
    });
    const copy = duplicateSelection(board);
    const selected = copy.nodes.filter((node) => node.selected);
    expect(selected).toHaveLength(2);
    expect(
      selected.every((node) => !board.nodes.some((old) => old.id === node.id)),
    ).toBe(true);
    const copiedEdges = copy.edges.filter(
      (item) => !board.edges.some((old) => old.id === item.id),
    );
    expect(copiedEdges.length).toBeGreaterThan(0);
    expect(
      copiedEdges.every(
        (item) =>
          selected.some((node) => node.id === item.source) &&
          selected.some((node) => node.id === item.target),
      ),
    ).toBe(true);
    expect(board.nodes).toHaveLength(copy.nodes.length - 2);
  });
  it("removes selected nodes and every incident connection", () => {
    const board = createBoard();
    const id = board.edges[0].source;
    board.nodes.find((node) => node.id === id)!.selected = true;
    const result = removeSelection(board);
    expect(result.nodes.some((node) => node.id === id)).toBe(false);
    expect(
      result.edges.some((edge) => edge.source === id || edge.target === id),
    ).toBe(false);
    expect(board.nodes.some((node) => node.id === id)).toBe(true);
  });
  it("refreshes clean boards while preserving local views and dirty drafts", () => {
    const local = {
      ...createBoard(),
      revision: 2,
      viewport: { x: 30, y: 40, zoom: 0.5 },
    };
    local.cloudSavedContent = boardContent(local);
    const remote = {
      ...local,
      title: "Updated elsewhere",
      revision: 3,
      inviteCode: "a".repeat(32),
    };
    const previous = { boards: [local], activeId: local.id };
    const clean = mergeWorkspace(previous, [remote], false).boards[0];
    expect(clean.title).toBe(remote.title);
    expect(clean.viewport).toEqual(local.viewport);
    const dirty = { ...local, title: "Unsaved draft" };
    const merged = mergeWorkspace(
      { ...previous, boards: [dirty] },
      [remote],
      false,
    ).boards[0];
    expect(merged.title).toBe(dirty.title);
    expect(merged.revision).toBe(2);
    expect(merged.inviteCode).toBe(remote.inviteCode);
    expect(
      openWorkspaceBoard({ ...previous, boards: [dirty] }, remote, false)
        .boards[0],
    ).toEqual(merged);
  });
  it("replaces only an untouched starter when first loading shared boards", () => {
    const starter = createBoard();
    const remote = { ...createBoard(), revision: 1 };
    const previous = { boards: [starter], activeId: starter.id };
    expect(mergeWorkspace(previous, [remote], true)).toEqual({
      boards: [remote],
      activeId: remote.id,
    });
    expect(mergeWorkspace(previous, [remote], false).boards).toHaveLength(2);
  });
});
