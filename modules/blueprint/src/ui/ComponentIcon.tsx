import {
  AppWindow,
  ArrowLeftRight,
  Boxes,
  Braces,
  Cloud,
  Database,
  FolderOpen,
  Globe2,
  Layers3,
  Network,
  Server,
  StickyNote,
  Type,
  Workflow,
  Zap,
} from "lucide-react";
import type { ComponentKind } from "../domain/boards/types";

const icons = {
  client: AppWindow,
  gateway: Network,
  service: Server,
  database: Database,
  cache: Zap,
  queue: Layers3,
  balancer: ArrowLeftRight,
  storage: FolderOpen,
  cdn: Globe2,
  function: Braces,
  external: Cloud,
  note: StickyNote,
  text: Type,
  boundary: Boxes,
};
export function ComponentIcon({
  kind,
  size = 20,
  ...props
}: {
  kind: ComponentKind;
  size?: number;
  className?: string;
}) {
  const Icon = icons[kind] || Workflow;
  return <Icon size={size} strokeWidth={1.7} {...props} />;
}
