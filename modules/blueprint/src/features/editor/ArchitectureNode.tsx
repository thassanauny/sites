import { memo, useContext, useLayoutEffect, useRef } from "react";
import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { DiagramNode } from "../../domain/boards/types";
import { ComponentIcon } from "../../ui/ComponentIcon";
import { EditingContext } from "./EditingContext";
import { frameMinimum, isFlowKind, isFrameKind, swimlaneLabels } from "../../domain/boards/components";
import { WorkflowNodeContent } from "./WorkflowNodeContent";

export const ArchitectureNode = memo(function ArchitectureNode({
  id,
  data,
  selected,
}: NodeProps<DiagramNode>) {
  const { editable, updateAnnotation } = useContext(EditingContext);
  const annotationEditor = useRef<HTMLTextAreaElement>(null);
  const edited = useRef(false);
  const content = data.kind === "note" ? data.description : data.label;
  useLayoutEffect(() => {
    const editor = annotationEditor.current;
    if (!editor) return;
    editor.style.height = "0px";
    editor.style.height = `${editor.scrollHeight}px`;
  }, [content]);
  const inlineEditor = <textarea
    ref={annotationEditor}
    className={`${data.kind === "note" ? "note-description" : "text-annotation"} nodrag nopan nowheel`}
    aria-label={data.kind === "note" ? "Note description" : "Text annotation"}
    placeholder={data.kind === "note" ? "Write a note…" : "Write text…"}
    value={content}
    readOnly={!editable}
    maxLength={data.kind === "note" ? 4000 : 120}
    rows={data.kind === "note" ? 3 : 1}
    onFocus={() => { edited.current = false; }}
    onBlur={() => { edited.current = false; }}
    onChange={event => {
      if (!editable || !updateAnnotation) return;
      updateAnnotation(id, event.target.value, !edited.current);
      edited.current = true;
    }}
  />;
  const isAnnotation =
    data.kind === "note" || data.kind === "text" || isFrameKind(data.kind);
  const minimum = frameMinimum(data);
  return (
    <div
      className={`architecture-node ${isFlowKind(data.kind) ? `workflow ${data.kind}` : isAnnotation ? data.kind : ""} tone-${data.tone} ${selected ? "is-selected" : ""} ${editable ? "" : "node-disconnected"}`}
    >
      {isFrameKind(data.kind) && (
        <NodeResizer
          isVisible={selected && editable}
          minWidth={minimum.width}
          minHeight={minimum.height}
          color="#34846a"
        />
      )}
      {!isAnnotation && (
        <>
          <Handle
            isConnectable={editable}
            type="target"
            position={Position.Left}
            id="left"
          />
          <Handle isConnectable={editable} type="source" position={Position.Right} id="right" />
          <Handle isConnectable={editable} type="target" position={Position.Top} id="top" />
          <Handle isConnectable={editable} type="source" position={Position.Bottom} id="bottom" />
        </>
      )}
      {data.kind === "note" ? (
        <>
          {data.label.trim() && <div className="note-heading">
            <ComponentIcon kind="note" size={14} />
            <span>{data.label}</span>
          </div>}
          {inlineEditor}
        </>
      ) : data.kind === "text" ? (
        inlineEditor
      ) : isFrameKind(data.kind) ? (
        <>
          {["top", "right", "bottom", "left"].map(side => (
            <span key={side} className={`boundary-hit-area boundary-hit-${side}`} aria-hidden="true" />
          ))}
          <span className="boundary-label" title="Drag to move; double-click for Properties">{data.label}</span>
          {data.kind === "swimlane" && <div className="swimlane-rows">
            {swimlaneLabels(data.lanes).map((label, index) => <div className="swimlane-row" key={index}>
              <span className="swimlane-row-label" title="Drag to move; double-click for Properties">{label}</span>
            </div>)}
          </div>}
        </>
      ) : isFlowKind(data.kind) ? (
        <WorkflowNodeContent data={data} />
      ) : (
        <>
          <span className="node-icon">
            <ComponentIcon kind={data.kind} size={27.6} />
          </span>
          <div className="node-copy">
            <strong>{data.label}</strong>
            <span>{data.technology || data.description}</span>
          </div>
        </>
      )}
    </div>
  );
});
