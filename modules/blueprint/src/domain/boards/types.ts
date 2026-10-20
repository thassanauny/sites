import type { Edge, Node, Viewport } from "@xyflow/react";
export const flowComponentKinds = ["module", "step", "decision", "terminal", "state", "input-output", "subflow", "swimlane"] as const;
export type FlowComponentKind = (typeof flowComponentKinds)[number];
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
  ...flowComponentKinds,
  "note",
  "text",
  "boundary",
] as const;
export type ComponentKind = (typeof componentKinds)[number];
export type Tone = "green" | "blue" | "purple" | "orange" | "rose" | "slate";
export const componentIconSets = [
  { id: "duotone", label: "Soft duotone" },
  { id: "classic", label: "Classic infrastructure" },
  { id: "architecture", label: "Architecture symbols" },
  { id: "technical", label: "Technical outline" },
] as const;
export type ComponentIconStyle = (typeof componentIconSets)[number]["id"];
// Keep the original presets readable without rewriting already-saved boards.
export type ColorIntensity = number | "soft" | "deep";
export type ComponentData = {
  kind: ComponentKind;
  label: string;
  description: string;
  technology: string;
  tone: Tone;
  showIcon?: boolean;
  lanes?: string[];
};
export type DiagramNode = Node<ComponentData, "architecture">;
export type DiagramEdge = Edge;
export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[] };
export type Board = Diagram & {
  id: string;
  title: string;
  description: string;
  iconStyle?: ComponentIconStyle;
  colorIntensity?: ColorIntensity;
  viewport?: Viewport;
  updatedAt: string;
  revision: number;
  cloudSavedContent?: string;
  inviteCode?: string;
};
