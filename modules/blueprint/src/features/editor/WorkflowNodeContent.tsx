import type { ComponentData } from "../../domain/boards/types";
import { useLayoutEffect, useRef } from "react";
import { ComponentIcon } from "../../ui/ComponentIcon";
import "./workflowNodes.css";

export function WorkflowNodeContent({ data }: { data: ComponentData }) {
  const copy = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (data.kind !== "decision" || !copy.current) return;
    const container = copy.current.parentElement!;
    // Keep even a long label within the diamond's inner half.
    container.style.setProperty("--workflow-decision-height", `${Math.max(160, copy.current.scrollHeight * 2 + 36)}px`);
    return () => { container.style.removeProperty("--workflow-decision-height"); };
  }, [data.kind, data.label]);
  const shaped = data.kind === "decision" || data.kind === "input-output";
  return <>
    {shaped && <svg className="workflow-shape" viewBox="0 0 200 140" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={data.kind === "decision" ? "100,1 199,70 100,139 1,70" : "29,1 199,1 171,139 1,139"} vectorEffect="non-scaling-stroke" />
    </svg>}
    {data.kind === "module" && data.showIcon !== false && <span className="node-icon"><ComponentIcon kind="module" size={27.6} /></span>}
    {data.kind === "state" && <span className="workflow-state-dot" aria-hidden="true" />}
    <div className="node-copy" ref={copy}>
      <strong>{data.label}</strong>
      {!["decision", "terminal", "state"].includes(data.kind) && (data.technology || data.description) && <span>{data.technology || data.description}</span>}
    </div>
  </>;
}
