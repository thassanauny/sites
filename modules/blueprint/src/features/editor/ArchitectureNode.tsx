import { createContext, memo, useContext } from "react";
import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { DiagramNode } from "../../domain/boards/types";
import { ComponentIcon } from "../../ui/ComponentIcon";

export const EditingContext = createContext(true);

export const ArchitectureNode = memo(function ArchitectureNode({
  data,
  selected,
}: NodeProps<DiagramNode>) {
  const editable = useContext(EditingContext);
  const isAnnotation =
    data.kind === "note" || data.kind === "text" || data.kind === "boundary";
  return (
    <div
      className={`architecture-node ${isAnnotation ? data.kind : ""} tone-${data.tone} ${selected ? "is-selected" : ""} ${editable ? "" : "node-disconnected"}`}
    >
      {data.kind === "boundary" && (
        <NodeResizer
          isVisible={selected && editable}
          minWidth={200}
          minHeight={150}
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
          <Handle type="source" position={Position.Right} id="right" />
          <Handle type="target" position={Position.Top} id="top" />
          <Handle type="source" position={Position.Bottom} id="bottom" />
        </>
      )}
      {data.kind === "note" ? (
        <>
          <div className="note-heading">
            <ComponentIcon kind="note" size={14} />
            <span>{data.label}</span>
          </div>
          <p>{data.description}</p>
        </>
      ) : data.kind === "text" ? (
        <div className="text-annotation">{data.label}</div>
      ) : data.kind === "boundary" ? (
        <span className="boundary-label">{data.label}</span>
      ) : (
        <>
          <span className="node-icon">
            <ComponentIcon kind={data.kind} size={23} />
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
