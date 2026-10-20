import type { Board, Diagram, DiagramNode, DiagramEdge } from "./types";
import { componentIconSets, componentKinds } from "./types";
import { defaultEdgeOptions } from "./connectionStyle";
import { colorDepth } from "./appearance";
import { frameMinimum, isFrameKind, swimlaneLabels } from "./components";
export function cleanDiagram(diagram: Diagram): Diagram {
  return {
    nodes: diagram.nodes.map(
      ({
        selected: _selected,
        dragging: _dragging,
        measured: _measured,
        resizing: _resizing,
        ...node
      }) =>
        isFrameKind(node.data.kind)
          ? {
              ...node,
              style: {
                ...node.style,
                width: node.width ?? node.style?.width ?? 500,
                height: node.height ?? node.style?.height ?? 340,
              },
            }
          : node,
    ),
    edges: diagram.edges.map(({ selected: _selected, ...edge }) => edge),
  };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify(
    {
      format: "blueprint-board",
      version: 1,
      board: {
        id: board.id,
        title: board.title,
        description: board.description,
        ...(board.iconStyle ? { iconStyle: board.iconStyle } : {}),
        ...(board.colorIntensity !== undefined ? { colorIntensity: board.colorIntensity } : {}),
        updatedAt: board.updatedAt,
        viewport: board.viewport,
        ...cleanDiagram(board),
      },
    },
    null,
    2,
  );
}

export function boardContent(board: Board): string {
  return JSON.stringify({
    title: board.title,
    description: board.description,
    ...(board.iconStyle ? { iconStyle: board.iconStyle } : {}),
    ...(board.colorIntensity !== undefined ? { colorIntensity: board.colorIntensity } : {}),
    ...cleanDiagram(board),
  });
}

export function parseBoard(value: string): Board {
  const parsed = JSON.parse(value);
  const board =
    parsed?.format === "blueprint-board" && parsed.version === 1
      ? parsed.board
      : null;
  if (
    !board ||
    typeof board.title !== "string" ||
    !Array.isArray(board.nodes) ||
    !Array.isArray(board.edges)
  ) {
    throw new Error("Choose a valid Blueprint board JSON file.");
  }
  if (board.nodes.length > 1500 || board.edges.length > 3000)
    throw new Error(
      "This board is too large (maximum 1,500 components and 3,000 connections).",
    );
  const ids = new Set<string>();
  const tones = new Set(["green", "blue", "purple", "orange", "rose", "slate"]);
  const nodes: DiagramNode[] = board.nodes.map((node: DiagramNode) => {
    if (
      !node ||
      typeof node.id !== "string" ||
      ids.has(node.id) ||
      !Number.isFinite(node.position?.x) ||
      !Number.isFinite(node.position?.y) ||
      !componentKinds.includes(node.data?.kind) ||
      typeof node.data.label !== "string"
    ) {
      throw new Error("The board contains an invalid component.");
    }
    ids.add(node.id);
    return {
      id: node.id,
      type: "architecture",
      position: { x: node.position.x, y: node.position.y },
      data: {
        kind: node.data.kind,
        label: node.data.label.slice(0, 120),
        description: String(node.data.description ?? "").slice(0, 4000),
        technology: String(node.data.technology ?? "").slice(0, 120),
        tone: tones.has(node.data.tone) ? node.data.tone : "green",
        ...(node.data.kind === "module" && typeof node.data.showIcon === "boolean" ? { showIcon: node.data.showIcon } : {}),
        ...(node.data.kind === "swimlane" ? { lanes: swimlaneLabels(node.data.lanes) } : {}),
      },
      ...(isFrameKind(node.data.kind)
        ? {
            style: {
              width: Math.max(
                frameMinimum(node.data).width,
                Math.min(Number(node.style?.width) || 500, 3000),
              ),
              height: Math.max(
                frameMinimum(node.data).height,
                Math.min(Number(node.style?.height) || 340, 3000),
              ),
            },
            zIndex: -1,
          }
        : {}),
    };
  });
  const edgeIds = new Set<string>();
  const edges: DiagramEdge[] = board.edges.map((edge: DiagramEdge) => {
    if (
      !edge ||
      typeof edge.id !== "string" ||
      edgeIds.has(edge.id) ||
      !ids.has(edge.source) ||
      !ids.has(edge.target)
    )
      throw new Error("The board contains an invalid connection.");
    edgeIds.add(edge.id);
    return {
      ...defaultEdgeOptions,
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle:
        typeof edge.sourceHandle === "string" ? edge.sourceHandle : "right",
      targetHandle:
        typeof edge.targetHandle === "string" ? edge.targetHandle : "left",
      label: typeof edge.label === "string" ? edge.label.slice(0, 120) : "",
      animated: Boolean(edge.animated),
      style: {
        ...defaultEdgeOptions.style,
        ...(edge.style?.strokeDasharray ? { strokeDasharray: "6 4" } : {}),
      },
    };
  });
  return {
    id: crypto.randomUUID(),
    title: board.title.trim().slice(0, 120) || "Untitled board",
    description: String(board.description ?? "").slice(0, 4000),
    ...(componentIconSets.some(({ id }) => id === board.iconStyle)
      ? { iconStyle: board.iconStyle }
      : {}),
    ...(["soft", "deep"].includes(board.colorIntensity)
      ? { colorIntensity: board.colorIntensity }
      : typeof board.colorIntensity === "number" && Number.isFinite(board.colorIntensity)
        ? { colorIntensity: colorDepth(board.colorIntensity) }
        : {}),
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
    revision: 0,
  };
}

export function fileName(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled-board"
  );
}
