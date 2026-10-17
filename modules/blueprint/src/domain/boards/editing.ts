import type { Board } from "./types";

/** Copy only connections whose two endpoints are in the selection. */
export function duplicateSelection(board: Board): Board {
  const selected = board.nodes.filter((node) => node.selected);
  const ids = new Map(selected.map((node) => [node.id, crypto.randomUUID()]));
  return {
    ...board,
    nodes: [
      ...board.nodes.map((node) => ({ ...node, selected: false })),
      ...selected.map((node) => ({
        ...structuredClone(node),
        id: ids.get(node.id)!,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        selected: true,
      })),
    ],
    edges: [
      ...board.edges,
      ...board.edges
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => ({
          ...edge,
          id: crypto.randomUUID(),
          source: ids.get(edge.source)!,
          target: ids.get(edge.target)!,
          selected: false,
        })),
    ],
  };
}

export function removeSelection(board: Board): Board {
  const ids = new Set(
    board.nodes.filter((node) => node.selected).map((node) => node.id),
  );
  return {
    ...board,
    nodes: board.nodes.filter((node) => !ids.has(node.id)),
    edges: board.edges.filter(
      (edge) =>
        !edge.selected && !ids.has(edge.source) && !ids.has(edge.target),
    ),
  };
}
