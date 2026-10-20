import type { ComponentKind, ComponentData, DiagramNode, Tone } from "./types";
import { flowComponentKinds, type FlowComponentKind } from "./types";

export function isFlowKind(kind: ComponentKind): kind is FlowComponentKind {
  return (flowComponentKinds as readonly string[]).includes(kind);
}
export function isFrameKind(kind: ComponentKind) {
  return kind === "boundary" || kind === "swimlane";
}
export function swimlaneLabels(value: unknown): string[] {
  const labels = Array.isArray(value) ? value.filter((label): label is string => typeof label === "string")
    .map(label => label.trim().slice(0, 60)).filter(Boolean).slice(0, 8) : [];
  return labels.length ? labels : ["Customer", "System"];
}
export function frameMinimum(data: Pick<ComponentData, "kind" | "lanes">) {
  return data.kind === "swimlane"
    ? { width: 360, height: swimlaneLabels(data.lanes).length * 90 + 36 }
    : { width: 200, height: 150 };
}
export const componentMeta: Record<
  ComponentKind,
  {
    label: string;
    description: string;
    technology: string;
    tone: Tone;
    category: string;
  }
> = {
  client: {
    label: "Client",
    description: "Web or mobile application",
    technology: "HTTPS",
    tone: "blue",
    category: "System components",
  },
  gateway: {
    label: "API gateway",
    description: "The front door to your APIs",
    technology: "REST / gRPC",
    tone: "green",
    category: "System components",
  },
  service: {
    label: "Service",
    description: "Application business logic",
    technology: "Microservice",
    tone: "green",
    category: "System components",
  },
  balancer: {
    label: "Load balancer",
    description: "Distribute incoming traffic",
    technology: "Round robin",
    tone: "blue",
    category: "System components",
  },
  function: {
    label: "Function",
    description: "Event-driven compute",
    technology: "Serverless",
    tone: "orange",
    category: "System components",
  },
  cdn: {
    label: "CDN",
    description: "Deliver content at the edge",
    technology: "Edge network",
    tone: "blue",
    category: "System components",
  },
  database: {
    label: "Database",
    description: "Persistent relational storage",
    technology: "PostgreSQL",
    tone: "purple",
    category: "System components",
  },
  cache: {
    label: "Cache",
    description: "Fast, in-memory access",
    technology: "Redis",
    tone: "orange",
    category: "System components",
  },
  queue: {
    label: "Message queue",
    description: "Asynchronous event stream",
    technology: "Kafka",
    tone: "rose",
    category: "System components",
  },
  storage: {
    label: "Object storage",
    description: "Files and unstructured data",
    technology: "S3",
    tone: "purple",
    category: "System components",
  },
  external: {
    label: "External API",
    description: "A third-party integration",
    technology: "HTTPS",
    tone: "slate",
    category: "System components",
  },
  module: { label: "Module", description: "", technology: "", tone: "green", category: "Workflows" },
  step: { label: "Step / action", description: "", technology: "", tone: "blue", category: "Workflows" },
  decision: { label: "Decision", description: "", technology: "", tone: "orange", category: "Workflows" },
  terminal: { label: "Start / end", description: "", technology: "", tone: "green", category: "Workflows" },
  state: { label: "State", description: "", technology: "", tone: "purple", category: "Workflows" },
  "input-output": { label: "Input / output", description: "", technology: "", tone: "green", category: "Workflows" },
  subflow: { label: "Subflow", description: "", technology: "", tone: "slate", category: "Workflows" },
  swimlane: { label: "Swimlane", description: "", technology: "", tone: "slate", category: "Workflows" },
  note: {
    label: "Sticky note",
    description: "Capture a decision, constraint, or question.",
    technology: "",
    tone: "orange",
    category: "Annotations",
  },
  text: {
    label: "Text",
    description: "",
    technology: "",
    tone: "slate",
    category: "Annotations",
  },
  boundary: {
    label: "Boundary",
    description: "A logical system boundary",
    technology: "",
    tone: "slate",
    category: "Annotations",
  },
};

export function makeNode(
  kind: ComponentKind,
  position: { x: number; y: number },
  overrides: Partial<ComponentData> = {},
): DiagramNode {
  const { label, description, technology, tone } = componentMeta[kind];
  const data: ComponentData = { kind, label: kind === "note" ? "" : label, description: kind === "note" ? "" : description, technology, tone, ...overrides };
  if (kind === "swimlane") data.lanes = swimlaneLabels(overrides.lanes);
  return {
    id: crypto.randomUUID(),
    type: "architecture",
    position,
    data,
    ...(isFrameKind(kind)
      ? { style: { width: kind === "swimlane" ? 680 : 500, height: kind === "swimlane" ? Math.max(360, frameMinimum(data).height) : 340 }, zIndex: -1 }
      : {}),
  };
}
