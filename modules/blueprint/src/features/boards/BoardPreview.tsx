import { Plus } from "lucide-react";
import type { Board } from "../../domain/boards/types";
const colors = {
  green: "#e5f1e9",
  blue: "#e8f0f7",
  purple: "#eee9f5",
  orange: "#faf0df",
  rose: "#f7e8ec",
  slate: "#eaf0ee",
};

export function BoardPreview({ board }: { board: Board }) {
  if (!board.nodes.length)
    return (
      <div className="board-preview blank-preview">
        <Plus size={25} />
        <span>Room for your next idea</span>
      </div>
    );
  const nodes = board.nodes.map((node) => ({
    ...node,
    width: node.width || 180,
    height: node.height || 76,
  }));
  const left = Math.min(...nodes.map((node) => node.position.x)) - 30;
  const top = Math.min(...nodes.map((node) => node.position.y)) - 30;
  const width =
    Math.max(...nodes.map((node) => node.position.x + node.width)) - left + 30;
  const height =
    Math.max(...nodes.map((node) => node.position.y + node.height)) - top + 30;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <div className="board-preview" aria-hidden="true">
      <svg viewBox={`${left} ${top} ${width} ${height}`}>
        {board.edges.map((edge) => {
          const from = byId.get(edge.source),
            to = byId.get(edge.target);
          if (!from || !to) return null;
          const x1 = from.position.x + from.width,
            y1 = from.position.y + from.height / 2;
          const x2 = to.position.x,
            y2 = to.position.y + to.height / 2;
          const middle = (x1 + x2) / 2;
          return (
            <path
              key={edge.id}
              d={`M${x1},${y1} H${middle} V${y2} H${x2}`}
              fill="none"
              stroke="#a4b7ac"
              strokeWidth="2"
            />
          );
        })}
        {nodes.map((node) => (
          <g
            key={node.id}
            transform={`translate(${node.position.x},${node.position.y})`}
          >
            <rect
              width={node.width}
              height={node.height}
              rx="9"
              fill={colors[node.data.tone]}
              stroke="#cddbd1"
            />
            <text
              x="12"
              y="27"
              fill="#3d5a4b"
              fontSize="12"
              fontFamily="sans-serif"
            >
              {node.data.label.slice(0, 24)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
