import type { ComponentKind, ComponentData, DiagramNode, Tone } from "./types";
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
    category: "Compute & networking",
  },
  gateway: {
    label: "API gateway",
    description: "The front door to your APIs",
    technology: "REST / gRPC",
    tone: "green",
    category: "Compute & networking",
  },
  service: {
    label: "Service",
    description: "Application business logic",
    technology: "Microservice",
    tone: "green",
    category: "Compute & networking",
  },
  balancer: {
    label: "Load balancer",
    description: "Distribute incoming traffic",
    technology: "Round robin",
    tone: "blue",
    category: "Compute & networking",
  },
  function: {
    label: "Function",
    description: "Event-driven compute",
    technology: "Serverless",
    tone: "orange",
    category: "Compute & networking",
  },
  cdn: {
    label: "CDN",
    description: "Deliver content at the edge",
    technology: "Edge network",
    tone: "blue",
    category: "Compute & networking",
  },
  database: {
    label: "Database",
    description: "Persistent relational storage",
    technology: "PostgreSQL",
    tone: "purple",
    category: "Data & messaging",
  },
  cache: {
    label: "Cache",
    description: "Fast, in-memory access",
    technology: "Redis",
    tone: "orange",
    category: "Data & messaging",
  },
  queue: {
    label: "Message queue",
    description: "Asynchronous event stream",
    technology: "Kafka",
    tone: "rose",
    category: "Data & messaging",
  },
  storage: {
    label: "Object storage",
    description: "Files and unstructured data",
    technology: "S3",
    tone: "purple",
    category: "Data & messaging",
  },
  external: {
    label: "External API",
    description: "A third-party integration",
    technology: "HTTPS",
    tone: "slate",
    category: "Data & messaging",
  },
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
  return {
    id: crypto.randomUUID(),
    type: "architecture",
    position,
    data: { kind, label, description, technology, tone, ...overrides },
    ...(kind === "boundary"
      ? { style: { width: 500, height: 340 }, zIndex: -1 }
      : {}),
  };
}
