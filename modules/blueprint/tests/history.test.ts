import { describe, expect, it } from "vitest";
import { historyEntry, rebaseHistory } from "../src/domain/boards/history";
import { makeNode } from "../src/domain/boards/components";
import { createBoard } from "../src/domain/boards/templates";

describe("collaborative undo history", () => {
  it("undoes our addition and move while retaining another person's addition and property", () => {
    const original = createBoard();
    const moved = structuredClone(original);
    moved.nodes[0].position.x += 70;
    const current = structuredClone(moved);
    const ours = makeNode("cache", { x: 500, y: 500 });
    current.nodes.push(ours);
    const remote = structuredClone(current);
    const theirs = makeNode("queue", { x: 800, y: 500 });
    remote.nodes.push(theirs);
    remote.nodes[1].data.label = "Collaborator's component";
    const result = rebaseHistory(current, remote, [historyEntry(original), historyEntry(moved)], []);
    expect(result.past).toHaveLength(2);
    for (const entry of result.past) {
      expect(entry.nodes.some(node => node.id === theirs.id)).toBe(true);
      expect(entry.nodes.some(node => node.id === ours.id)).toBe(false);
      expect(entry.nodes[1].data.label).toBe("Collaborator's component");
    }
    expect(result.past[0].nodes[0].position).toEqual(original.nodes[0].position);
    expect(result.past[1].nodes[0].position).toEqual(moved.nodes[0].position);
  });

  it("rebases redo and invalidates overlapping history instead of reverting another person's work", () => {
    const original = createBoard();
    const current = structuredClone(original);
    current.nodes[0].data.label = "Our saved name";
    const remote = structuredClone(current);
    remote.nodes[0].data.label = "Their later name";
    expect(rebaseHistory(current, remote, [historyEntry(original)], [historyEntry(current)]))
      .toEqual({ past: [], future: [] });
    const disjoint = structuredClone(current);
    disjoint.nodes.push(makeNode("queue", { x: 800, y: 500 }));
    const result = rebaseHistory(current, disjoint, [], [historyEntry(original)]);
    expect(result.future[0].nodes).toHaveLength(original.nodes.length + 1);
    expect(result.future[0].nodes[0].data.label).toBe(original.nodes[0].data.label);
  });

  it("keeps metadata and selection-only refreshes out of history work", () => {
    const original = createBoard();
    const past = [historyEntry(original)], future = [historyEntry(original)];
    const remote = { ...original, revision: 9, viewport: { x: 1, y: 2, zoom: 1 },
      nodes: original.nodes.map(node => ({ ...node, selected: true })) };
    const result = rebaseHistory(original, remote, past, future);
    expect(result.past).toBe(past);
    expect(result.future).toBe(future);
  });
});
