import { boardContent, parseBoard } from "./codec";
import type { Board } from "./types";

const conflict = Symbol("conflict");
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => same(item, right[index]));
  if (object(left) && object(right)) {
    const keys = Object.keys(left).filter(key => left[key] !== undefined);
    return keys.length === Object.keys(right).filter(key => right[key] !== undefined).length && keys.every(key => key in right && same(left[key], right[key]));
  }
  return false;
}
export { same as sameJson };

function withLocalInteraction(local: Board, remote: Board): Board {
  const nodes = new Map(local.nodes.map(node => [node.id, node]));
  const edges = new Map(local.edges.map(edge => [edge.id, edge]));
  return {
    ...remote,
    viewport: local.viewport,
    nodes: remote.nodes.map(node => {
      const previous = nodes.get(node.id);
      return previous ? { ...node, selected: previous.selected, dragging: previous.dragging,
        measured: previous.measured, resizing: previous.resizing } : node;
    }),
    edges: remote.edges.map(edge => ({ ...edge, selected: edges.get(edge.id)?.selected })),
  };
}

function object(value: unknown): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeValue(base: Json | undefined, local: Json | undefined, remote: Json | undefined, key = ""): Json | undefined | typeof conflict {
  if (same(local, remote) || same(base, remote)) return local;
  if (same(base, local)) return remote;
  if ((key === "nodes" || key === "edges") && Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const indexed = (items: Json[]) => new Map(items.map(item => [object(item) ? item.id : undefined, item]));
    const original = indexed(base), ours = indexed(local), theirs = indexed(remote);
    const merged: Json[] = [];
    for (const id of new Set([...theirs.keys(), ...ours.keys()])) {
      const item = mergeValue(original.get(id), ours.get(id), theirs.get(id));
      if (item === conflict) return conflict;
      if (item !== undefined) merged.push(item);
    }
    return merged;
  }
  // A competing move uses the accepted position, never a mix of two drags' axes.
  // Other fields still merge independently or keep the draft for explicit review.
  if (key === "position" && object(base) && object(local) && object(remote)) return remote;
  if (object(base) && object(local) && object(remote)) {
    const merged: Record<string, Json> = {};
    for (const property of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeValue(base[property], local[property], remote[property], property);
      if (value === conflict) return conflict;
      if (value !== undefined) merged[property] = value;
    }
    return merged;
  }
  return conflict;
}

/** Combine independent edits and accept shared moves; refuse text/deletion conflicts and invalid topology. */
export function mergeBoardContent(base: string, local: Board, remote: Board): Board | undefined {
  try {
    const content = mergeValue(JSON.parse(base), JSON.parse(boardContent(local)), JSON.parse(boardContent(remote)));
    if (!object(content)) return;
    // Validate topology and collection limits without dropping local selection/render state.
    parseBoard(JSON.stringify({ format: "blueprint-board", version: 1, board: content }));
    const merged = { ...local, ...content } as Board;
    if (merged.nodes.some(node => (node.data.kind !== "module" && node.data.showIcon !== undefined)
      || (node.data.kind !== "swimlane" && node.data.lanes !== undefined))
      || merged.edges.some(edge => edge.source === edge.target)) return;
    return withLocalInteraction(local, merged);
  } catch {
    return;
  }
}

export function sameBoardContent(left: Board, right: Board): boolean {
  return same(JSON.parse(boardContent(left)), JSON.parse(boardContent(right)));
}

/** The acknowledged cloud document, rather than a newer local draft. */
export function cloudBaseline(board: Board): Board {
  if (!board.cloudSavedContent) return board;
  try {
    return { ...board, ...JSON.parse(board.cloudSavedContent) };
  } catch {
    return board;
  }
}

/** Preserve drafts on overlap, except competing moves which use the accepted shared position. */
export function mergeCloudBoard(local: Board, remote: Board): Board {
  if (remote === local || remote.revision < local.revision) return local;
  const content = boardContent(remote);
  if (remote.revision === local.revision && local.cloudSavedContent === content)
    return local.inviteCode === remote.inviteCode ? local : { ...local, inviteCode: remote.inviteCode };
  const clean = local.cloudSavedContent === boardContent(local);
  const merged = sameBoardContent(local, remote)
    ? local
    : clean ? withLocalInteraction(local, remote)
    : local.cloudSavedContent ? mergeBoardContent(local.cloudSavedContent, local, remote) : undefined;
  if (!merged) return local.inviteCode === remote.inviteCode ? local : { ...local, inviteCode: remote.inviteCode };
  return {
    ...merged,
    revision: remote.revision,
    cloudSavedContent: content,
    inviteCode: remote.inviteCode,
    updatedAt: clean || sameBoardContent(merged, remote) ? remote.updatedAt : local.updatedAt,
  };
}
