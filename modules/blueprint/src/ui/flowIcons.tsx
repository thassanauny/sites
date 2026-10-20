import type { ReactNode } from "react";
import type { FlowComponentKind } from "../domain/boards/types";

// Workflow notation stays recognizable in every board icon set.
export const flowIcons: Record<FlowComponentKind, ReactNode> = {
  module: <><rect x="3" y="3" width="10" height="10" rx="2" /><rect x="19" y="3" width="10" height="10" rx="2" /><rect x="3" y="19" width="10" height="10" rx="2" /><rect x="19" y="19" width="10" height="10" rx="2" /></>,
  step: <rect x="3" y="7" width="26" height="18" rx="1" />,
  decision: <path d="m16 2 14 14-14 14L2 16Z" />,
  terminal: <rect x="2" y="8" width="28" height="16" rx="8" />,
  state: <><rect x="2" y="8" width="28" height="16" rx="4" /><circle cx="9" cy="16" r="2" fill="currentColor" stroke="none" /><path d="M15 16h9" /></>,
  "input-output": <path d="M8 7h22l-6 18H2Z" />,
  subflow: <><rect x="2" y="7" width="28" height="18" rx="1" /><path d="M7 7v18M25 7v18" /></>,
  swimlane: <><rect x="2" y="4" width="28" height="24" rx="1" /><path d="M10 4v24M2 16h28M15 10h9m-9 12h9" /></>,
};
