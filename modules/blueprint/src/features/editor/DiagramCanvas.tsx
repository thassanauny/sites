import { useCallback, useMemo, useState } from "react";
import type { WorkspaceController } from "../../application/useWorkspaceController";
import { diagramAppearance } from "../../ui/diagramAppearance";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ConnectionMode,
} from "@xyflow/react";
import {
  ArrowRight,
  Expand,
  Grid2X2,
  Hand,
  Layers3,
  LayoutTemplate,
  Minus,
  MousePointer2,
  MoveUpRight,
  Plus,
  Redo2,
  StickyNote,
  Undo2,
} from "lucide-react";
import { ArchitectureNode } from "./ArchitectureNode";
import { EditingContext } from "./EditingContext";
import { componentKinds } from "../../domain/boards/types";
import { componentMeta, isFrameKind } from "../../domain/boards/components";
import { defaultEdgeOptions } from "../../domain/boards/connectionStyle";
import type {
  ComponentData,
  ComponentKind,
  DiagramNode,
} from "../../domain/boards/types";
const nodeTypes = { architecture: ArchitectureNode };
export function DiagramCanvas({
  controller,
}: {
  controller: Pick<
    WorkspaceController,
    | "workspace"
    | "board"
    | "update"
    | "readOnly"
    | "flow"
    | "zoom"
    | "setModal"
    | "tool"
    | "setTool"
    | "spacePressed"
    | "showGrid"
    | "setShowGrid"
    | "showMiniMap"
    | "setShowMiniMap"
    | "setShowInspector"
    | "setToast"
    | "canvasRef"
    | "connectFrom"
    | "isPanning"
    | "addComponent"
    | "onNodesChange"
    | "onEdgesChange"
    | "onConnect"
  >;
}) {
  const {
    workspace,
    board,
    update,
    readOnly,
    flow,
    zoom,
    setModal,
    tool,
    setTool,
    spacePressed,
    showGrid,
    setShowGrid,
    showMiniMap,
    setShowMiniMap,
    setShowInspector,
    setToast,
    canvasRef,
    connectFrom,
    isPanning,
    addComponent,
    onNodesChange,
    onEdgesChange,
    onConnect,
  } = controller;
  const appearance = useMemo(() => diagramAppearance(board.colorIntensity), [board.colorIntensity]);
  const connection = appearance.connection;
  const [componentOrders, setComponentOrders] = useState<Record<string, string[]>>({});
  const componentLayers = useMemo(() => {
    const ids = new Set(board.nodes.filter(node => !isFrameKind(node.data.kind)).map(node => node.id));
    const previous = (componentOrders[board.id] ?? []).filter(id => ids.has(id));
    const known = new Set(previous);
    const order = [...previous, ...[...ids].filter(id => !known.has(id))];
    return new Map(order.map((id, index) => [id, index + 1]));
  }, [board.id, board.nodes, componentOrders]);
  const bringComponentForward = useCallback((id: string) => {
    if (!componentLayers.has(id) || componentLayers.get(id) === componentLayers.size) return;
    setComponentOrders(current => ({
      ...current,
      [board.id]: [...componentLayers.keys()].filter(other => other !== id).concat(id),
    }));
  }, [board.id, componentLayers]);
  // Keep the last interaction in front after deselection; frames stay behind.
  const nodes = useMemo<DiagramNode[]>(() => board.nodes.map(node => isFrameKind(node.data.kind) ? {
    ...node,
    zIndex: -1,
    dragHandle: ".boundary-hit-area, .boundary-label, .swimlane-row-label",
    style: { ...node.style, pointerEvents: "none" },
  } : {
    ...node,
    zIndex: componentLayers.get(node.id) ?? node.zIndex ?? 0,
  }), [board.nodes, componentLayers]);
  const edgeDefaults = useMemo(() => ({
    ...defaultEdgeOptions,
    style: { ...defaultEdgeOptions.style, stroke: connection.color, strokeWidth: connection.width },
    markerEnd: typeof defaultEdgeOptions.markerEnd === "object"
      ? { ...defaultEdgeOptions.markerEnd, color: connection.color }
      : defaultEdgeOptions.markerEnd,
    labelStyle: { ...defaultEdgeOptions.labelStyle, fill: connection.labelColor },
  }), [connection]);
  const edges = useMemo(() => board.edges.map(edge => ({
    ...edge,
    style: { ...edge.style, stroke: connection.color, strokeWidth: connection.width },
    markerEnd: typeof edge.markerEnd === "object" ? { ...edge.markerEnd, color: connection.color } : edge.markerEnd,
    markerStart: typeof edge.markerStart === "object" ? { ...edge.markerStart, color: connection.color } : edge.markerStart,
    labelStyle: { ...edge.labelStyle, fill: connection.labelColor },
  })), [board.edges, connection]);
  const editing = useMemo(() => ({
    editable: !readOnly,
    updateAnnotation: (id: string, text: string, remember: boolean) => {
      if (readOnly) return;
      update(current => ({
        ...current,
        nodes: current.nodes.map(node => node.id === id && ["note", "text"].includes(node.data.kind)
          ? { ...node, data: { ...node.data, ...(node.data.kind === "note"
            ? { description: text.slice(0, 4000) }
            : { label: text.slice(0, 120) }) } }
          : node),
      }), remember);
    },
  }), [readOnly, update]);
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={`canvas-area tool-${isPanning ? "hand" : tool}`}
      ref={canvasRef}
    >
      <EditingContext.Provider value={editing}>
        <ReactFlow<DiagramNode>
          key={board.id}
          nodes={nodes}
          elevateNodesOnSelect={false}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={changes => {
            for (const change of changes) {
              if (change.type === "select" && change.selected) bringComponentForward(change.id);
            }
            onNodesChange(changes);
          }}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={(_, node) => {
            bringComponentForward(node.id);
            workspace.checkpoint();
          }}
          onNodeClick={(_, node) => {
            bringComponentForward(node.id);
            if (
              tool === "connect" &&
              !["note", "text"].includes(node.data.kind) && !isFrameKind(node.data.kind)
            ) {
              if (!connectFrom.current) {
                connectFrom.current = node.id;
                setToast("Now click the component you want to connect to.");
              } else {
                onConnect({
                  source: connectFrom.current,
                  target: node.id,
                  sourceHandle: "right",
                  targetHandle: "left",
                });
                connectFrom.current = null;
                setToast("Connection added.");
              }
            }
          }}
          onNodeDoubleClick={event => {
            if (event.target instanceof Element && event.target.closest('.note-description, .text-annotation')) return;
            setShowInspector(true);
          }}
          onEdgeDoubleClick={() => setShowInspector(true)}
          onPaneClick={() => {
            connectFrom.current = null;
          }}
          onMoveEnd={(_, viewport) =>
            update((current) => ({ ...current, viewport }), false, false)
          }
          onDrop={(event) => {
            event.preventDefault();
            const kind = event.dataTransfer.getData(
              "application/blueprint",
            ) as ComponentKind;
            if (componentKinds.includes(kind))
              addComponent(
                kind,
                flow.screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
              );
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={edgeDefaults}
          connectionLineStyle={{ stroke: connection.color, strokeWidth: connection.width }}
          nodesDraggable={!readOnly && !isPanning && tool !== "connect"}
          nodesConnectable={!readOnly && !isPanning}
          selectionOnDrag={!isPanning}
          panOnDrag={isPanning ? true : [1, 2]}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={2}
          deleteKeyCode={null}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Meta", "Control"]}
          proOptions={{ hideAttribution: true }}
        >
          {showGrid && (
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1.2}
              color="#d8e0dc"
            />
          )}
          {showMiniMap && (
            <MiniMap
              position="bottom-right"
              nodeColor={(node) =>
                componentMeta[(node.data as ComponentData).kind]?.tone ===
                "green"
                  ? "#b5d8c6"
                  : "#d4d9e5"
              }
              maskColor="rgba(248,250,249,.7)"
              pannable
              zoomable
            />
          )}
        </ReactFlow>
      </EditingContext.Provider>
      {!board.nodes.length && (
        <div className="empty-canvas">
          <span className="empty-canvas-icon">
            <Layers3 size={31} strokeWidth={1.3} />
          </span>
          <p className="eyebrow">A LITTLE SPACE FOR BIG SYSTEMS</p>
          <h1>It all starts with an idea.</h1>
          <p>
            Bring your architecture to life, one component at a time.
            <br />
            Drag something in, or start with a little inspiration.
          </p>
          <button
            className="button primary"
            onClick={() => setModal("templates")}
          >
            <LayoutTemplate size={16} />
            Explore templates
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      <div className="canvas-dock">
        <div className="canvas-toolbar" aria-label="Canvas tools">
          <button
            className={tool === "select" && !spacePressed ? "active" : ""}
            title="Select (V)"
            aria-label="Select tool"
            onClick={() => setTool("select")}
          >
            <MousePointer2 size={19} />
          </button>
          <button
            className={isPanning ? "active" : ""}
            title="Pan (H)"
            aria-label="Pan tool"
            onClick={() => setTool("hand")}
          >
            <Hand size={19} />
          </button>
          <div className="toolbar-divider" />
          <button
            className={tool === "connect" ? "active" : ""}
            title="Connect (C)"
            disabled={readOnly}
            aria-label="Connect tool"
            onClick={() => {
              setTool("connect");
              setToast("Click a source component, then a destination.");
            }}
          >
            <MoveUpRight size={19} />
          </button>
          <button
            title="Sticky note (N)"
            disabled={readOnly}
            aria-label="Add sticky note"
            onClick={() => addComponent("note")}
          >
            <StickyNote size={19} />
          </button>
          <div className="toolbar-divider" />
          <button
            title="Undo"
            aria-label="Undo"
            disabled={readOnly || !workspace.canUndo}
            onClick={workspace.undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            disabled={readOnly || !workspace.canRedo}
            onClick={workspace.redo}
          >
            <Redo2 size={18} />
          </button>
        </div>
        <div className="dock-divider" aria-hidden="true" />
        <div className="canvas-bottom">
          <div className="zoom-controls">
            <button
              title="Toggle grid"
              aria-label="Toggle grid"
              className={showGrid ? "enabled" : ""}
              onClick={() => setShowGrid(!showGrid)}
            >
              <Grid2X2 size={15} />
            </button>
            <div />
            <button
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => flow.zoomOut({ duration: 200 })}
            >
              <Minus size={15} />
            </button>
            <button
              className="zoom-value"
              title="Reset zoom to 100%"
              onClick={() => flow.zoomTo(1, { duration: 200 })}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => flow.zoomIn({ duration: 200 })}
            >
              <Plus size={15} />
            </button>
            <div />
            <button
              title="Fit to screen (Shift 1)"
              aria-label="Fit to screen"
              onClick={() => flow.fitView({ padding: 0.2, duration: 300 })}
            >
              <Expand size={16} />
            </button>
            <button
              title="Toggle minimap"
              aria-label="Toggle minimap"
              className={showMiniMap ? "enabled" : ""}
              onClick={() => setShowMiniMap(!showMiniMap)}
            >
              <Layers3 size={15} />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
