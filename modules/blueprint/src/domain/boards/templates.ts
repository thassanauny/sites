import { makeNode } from "./components";
import { defaultEdgeOptions } from "./connectionStyle";
import type { Board, ComponentKind, DiagramEdge } from "./types";

export type TemplateId = "web-app" | "event-driven" | "workflow" | "blank";
export const templates = [
  {
    id: "web-app" as const,
    title: "Scalable web application",
    description: "From the first request to the data layer.",
    tag: "A great starting point",
    count: 8,
  },
  {
    id: "event-driven" as const,
    title: "Event-driven system",
    description: "Decouple services with events and workers.",
    tag: "Async by design",
    count: 7,
  },
  {
    id: "workflow" as const,
    title: "Approval workflow",
    description: "Map a request from submission to review and completion.",
    tag: "From start to finish",
    count: 7,
  },
  {
    id: "blank" as const,
    title: "A clean slate",
    description: "Your next big idea starts right here.",
    tag: "Make it your own",
    count: 0,
  },
];

export function createBoard(template: TemplateId = "web-app"): Board {
  const board: Board = {
    id: crypto.randomUUID(),
    title:
      template === "web-app"
        ? "Untitled architecture"
        : template === "event-driven"
          ? "Event-driven architecture"
          : template === "workflow"
            ? "Approval workflow"
            : "Untitled board",
    description:
      template === "web-app"
        ? "A scalable foundation for your next big idea. Map the flow, explore the trade-offs, and make it yours."
        : "",
    nodes: [],
    edges: [],
    updatedAt: new Date().toISOString(),
    revision: 0,
  };
  if (template === "blank") return board;
  const add = (
    id: string,
    kind: ComponentKind,
    x: number,
    y: number,
    label: string,
    technology?: string,
    description?: string,
  ) => {
    const node = makeNode(
      kind,
      { x, y },
      {
        label,
        ...(technology ? { technology } : {}),
        ...(description ? { description } : {}),
      },
    );
    node.id = id;
    board.nodes.push(node);
  };
  const connect = (
    source: string,
    target: string,
    label: string,
    sourceHandle = "right",
    targetHandle = "left",
    async = false,
  ) => {
    board.edges.push({
      ...defaultEdgeOptions,
      id: `${source}-${target}`,
      source,
      target,
      sourceHandle,
      targetHandle,
      label,
      ...(async
        ? {
            animated: true,
            style: { ...defaultEdgeOptions.style, strokeDasharray: "5 5" },
          }
        : {}),
    } as DiagramEdge);
  };
  if (template === "web-app") {
    add("client", "client", 0, 200, "Web client", "React / Next.js");
    add("cdn", "cdn", 250, 30, "CDN", "CloudFront");
    add("gateway", "balancer", 250, 200, "Load balancer", "NGINX");
    add("api", "service", 530, 200, "API service", "Node.js / Go");
    add("database", "database", 830, 60, "Primary database", "PostgreSQL");
    add("cache", "cache", 830, 200, "Cache", "Redis");
    add("queue", "queue", 530, 400, "Message queue", "Kafka");
    add(
      "worker",
      "function",
      830,
      400,
      "Background worker",
      "Async processing",
    );
    add(
      "note",
      "note",
      0,
      400,
      "A few things to think about…",
      "",
      "What happens when traffic grows 10×?\nWhere could a single point of failure hide?\nWhat can we cache?",
    );
    connect("client", "cdn", "Static assets");
    connect("client", "gateway", "HTTPS");
    connect("gateway", "api", "Route requests");
    connect("api", "database", "Read / write");
    connect("api", "cache", "Cache aside");
    connect("api", "queue", "Publish event", "bottom", "top", true);
    connect("queue", "worker", "Consume", "right", "left", true);
    connect("worker", "database", "Persist", "right", "right");
  } else if (template === "workflow") {
    add("start", "terminal", 0, 180, "Start");
    add("submit", "input-output", 260, 180, "Submit request", "Request details");
    add("review", "step", 520, 180, "Review request", "Check details and eligibility");
    add("decision", "decision", 800, 180, "Approved?");
    add("complete", "step", 1080, 180, "Fulfill request", "Record the outcome");
    add("end", "terminal", 1340, 180, "Complete");
    add("revise", "step", 520, 420, "Revise request", "Address reviewer feedback");
    connect("start", "submit", "Begin");
    connect("submit", "review", "Submitted");
    connect("review", "decision", "Reviewed");
    connect("decision", "complete", "Yes");
    connect("complete", "end", "Done");
    connect("decision", "revise", "Needs changes", "bottom", "right");
    connect("revise", "submit", "Resubmit", "left", "bottom");
  } else {
    add("client", "client", 0, 160, "Client application");
    add("gateway", "gateway", 260, 160, "API gateway");
    add("events", "queue", 530, 160, "Event bus", "Kafka");
    add("orders", "service", 810, 20, "Order service");
    add("notifications", "service", 810, 160, "Notification service");
    add("analytics", "function", 810, 300, "Analytics worker");
    add("database", "database", 1080, 20, "Orders database");
    add(
      "note",
      "note",
      260,
      370,
      "Design for failure",
      "",
      "Plan for retries, idempotent consumers, and a dead-letter queue.",
    );
    connect("client", "gateway", "HTTPS");
    connect("gateway", "events", "Publish", "right", "left", true);
    connect("events", "orders", "OrderCreated", "right", "left", true);
    connect("events", "notifications", "OrderCreated", "right", "left", true);
    connect("events", "analytics", "All events", "right", "left", true);
    connect("orders", "database", "Write");
  }
  return board;
}
