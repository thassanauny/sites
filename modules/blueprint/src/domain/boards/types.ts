import type { Edge, Node, Viewport } from "@xyflow/react";
export const componentKinds = [
  "client",
  "gateway",
  "service",
  "database",
  "cache",
  "queue",
  "balancer",
  "storage",
  "cdn",
  "function",
  "external",
  "note",
  "text",
  "boundary",
] as const;
export type ComponentKind = (typeof componentKinds)[number];
export type Tone = "green" | "blue" | "purple" | "orange" | "rose" | "slate";
export type ComponentData = {
  kind: ComponentKind;
  label: string;
  description: string;
  technology: string;
  tone: Tone;
};
export type DiagramNode = Node<ComponentData, "architecture">;
export type DiagramEdge = Edge;
export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[] };
export type Board = Diagram & {
  id: string;
  title: string;
  description: string;
  viewport?: Viewport;
  updatedAt: string;
  revision: number;
  cloudSavedContent?: string;
  inviteCode?: string;
};
