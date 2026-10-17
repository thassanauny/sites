import type { MarkerType } from "@xyflow/react";
import type { DiagramEdge } from "./types";
export const defaultEdgeOptions: Partial<DiagramEdge> = {
  type: "smoothstep",
  markerEnd: {
    type: "arrowclosed" as MarkerType,
    width: 15,
    height: 15,
    color: "#8c9b96",
  },
  style: { stroke: "#8c9b96", strokeWidth: 1.6 },
  labelStyle: { fill: "#6d7a75", fontSize: 11, fontWeight: 500 },
  labelBgStyle: { fill: "#f8faf9" },
  labelBgPadding: [7, 4],
  labelBgBorderRadius: 4,
};
