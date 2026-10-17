import type { WorkspaceController } from "../../application/useWorkspaceController";
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
  Menu,
  Minus,
  MousePointer2,
  MoveUpRight,
  PanelLeftClose,
  Plus,
  Redo2,
  Settings2,
  StickyNote,
  Undo2,
} from "lucide-react";
import { ArchitectureNode, EditingContext } from "./ArchitectureNode";
import { componentKinds } from "../../domain/boards/types";
import { componentMeta } from "../../domain/boards/components";
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
    | "showSidebar"
    | "setShowSidebar"
    | "showInspector"
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
    showSidebar,
    setShowSidebar,
    showInspector,
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
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={`canvas-area tool-${isPanning ? "hand" : tool}`}
      ref={canvasRef}
    >
      <div className="canvas-topline">
        <button
          className="icon-button sidebar-toggle"
          aria-label={showSidebar ? "Hide components" : "Show components"}
          title="Toggle components"
          onClick={() => setShowSidebar(!showSidebar)}
        >
          {showSidebar ? <PanelLeftClose size={18} /> : <Menu size={18} />}
        </button>
        <span className="canvas-breadcrumb">
          <span className="live-dot" />
          SYSTEM DESIGN<span className="breadcrumb-slash">/</span>
          Architecture overview
        </span>
        <button
          className="icon-button inspector-toggle"
          aria-label="Toggle properties panel"
          title="Toggle properties panel"
          onClick={() => setShowInspector(!showInspector)}
        >
          <Settings2 size={17} />
        </button>
      </div>
      <EditingContext.Provider value={!readOnly}>
        <ReactFlow<DiagramNode>
          key={board.id}
          nodes={board.nodes}
          edges={board.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={() => workspace.checkpoint()}
          onNodeClick={(_, node) => {
            if (
              tool === "connect" &&
              !["note", "text", "boundary"].includes(node.data.kind)
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
          onNodeDoubleClick={() => setShowInspector(true)}
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
          defaultEdgeOptions={defaultEdgeOptions}
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
          attributionPosition="bottom-right"
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
      <div className="canvas-bottom">
        <div className="canvas-hint">
          <MousePointer2 size={13} />
          <span>
            {tool === "connect"
              ? "Click two components to connect"
              : isPanning
                ? "Drag to explore your canvas"
                : "Drag to select · Space to pan"}
          </span>
        </div>
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
    </main>
  );
}
