import { duplicateSelection, removeSelection } from "../domain/boards/editing";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  useViewport,
  getViewportForBounds,
} from "@xyflow/react";
import type { Connection, NodeChange, EdgeChange } from "@xyflow/react";
import { toPng } from "html-to-image";
import { boardCodeFromHash, invitationFromHash } from "../domain/sharing/invitations";
import { useAuth } from "../infrastructure/auth/useAuth";
import { useCloudBoards } from "./useCloudBoards";
import { messageFor } from "../infrastructure/cloud/boards";
import { makeNode } from "../domain/boards/components";
import { defaultEdgeOptions } from "../domain/boards/connectionStyle";
import { boardContent, fileName } from "../domain/boards/codec";
import type {
  ComponentData,
  ComponentKind,
  DiagramNode,
} from "../domain/boards/types";
import { createBoard } from "../domain/boards/templates";
import type { TemplateId } from "../domain/boards/templates";
import { useWorkspace } from "./useWorkspace";
import { download } from "../ui/download";
type ModalName = "templates" | "cloud" | "shortcuts" | "join" | "share" | "help" | null;
type Tool = "select" | "hand" | "connect";

export function useWorkspaceController(auth: ReturnType<typeof useAuth>) {
  const workspace = useWorkspace();
  const cloud = useCloudBoards(auth.user, workspace);
  const { board, update } = workspace;
  const readOnly = !auth.user || !cloud.ready || !board.revision;
  const [invitationInput, setInvitationInput] = useState("");
  const flow = useReactFlow<DiagramNode>();
  const { zoom } = useViewport();
  const [modal, setModal] = useState<ModalName>(null);
  const [sidebarTab, setSidebarTab] = useState<"components" | "templates">(
    "components",
  );
  const [search, setSearch] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [spacePressed, setSpacePressed] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showSidebar, setShowSidebar] = useState(
    () => window.innerWidth >= 760,
  );
  const [showInspector, setShowInspector] = useState(
    () => window.innerWidth >= 1050,
  );
  const [toast, setToast] = useState("");
  const [routeHash, setRouteHash] = useState(() => location.hash);
  const routeCode = boardCodeFromHash(routeHash.replace(/^#\/join\//, "#/board/"));
  const [openedCode, setOpenedCode] = useState("");
  const [routeError, setRouteError] = useState("");
  const [routeRetry, setRouteRetry] = useState(0);
  const home = !routeCode || openedCode !== routeCode || board.inviteCode !== routeCode;
  const activeRemoved = useRef(workspace.activeRemoved);
  activeRemoved.current = workspace.activeRemoved;
  const [isExporting, setIsExporting] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const connectFrom = useRef<string | null>(null);
  const resizing = useRef(false);
  const selectedNodes = board.nodes.filter((node) => node.selected);
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedEdge = board.edges.find((edge) => edge.selected);
  const isPanning = tool === "hand" || spacePressed;

  const showHome = () => {
    setModal(null);
    setSpacePressed(false);
    location.hash = "";
    setRouteHash("");
    setOpenedCode("");
  };
  const showEditor = (code = board.inviteCode) => {
    if (!code) return;
    location.hash = `/board/${code}`;
    setRouteHash(location.hash);
    setOpenedCode(code);
  };

  useEffect(() => {
    const route = () => {
      setRouteHash(location.hash);
      setOpenedCode("");
      setRouteError("");
      try {
        const code = invitationFromHash(location.hash);
        if (code) setInvitationInput(code);
      } catch (error) {
        setToast(
          error instanceof Error ? error.message : "Invalid invitation link.",
        );
      }
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  const routeActions = useRef({ workspace, cloud });
  routeActions.current = { workspace, cloud };
  const boardRoutes = workspace.visibleBoards.map((item) => item.inviteCode).join(",");
  useEffect(() => {
    if (!routeCode || openedCode === routeCode) return;
    const { workspace, cloud } = routeActions.current;
    const target = workspace.visibleBoards.find((item) => item.inviteCode === routeCode);
    if (target) {
      workspace.switchBoard(target.id);
      setOpenedCode(routeCode);
      return;
    }
    if (!cloud.ready || !auth.user) return;
    setInvitationInput(routeCode);
    setModal("join");
  }, [routeCode, openedCode, cloud.ready, auth.user, boardRoutes, routeRetry]);

  useEffect(() => {
    setTool("select");
  }, [board.id, readOnly]);
  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => setToast(""), 4200);
      return () => clearTimeout(timeout);
    }
  }, [toast]);
  useEffect(() => {
    connectFrom.current = null;
    if (home) return;
    const timer = setTimeout(() => {
      if (board.viewport) flow.setViewport(board.viewport);
      else flow.fitView({ padding: 0.2, maxZoom: 1, duration: 400 });
    }, 80);
    return () => clearTimeout(timer);
    // Restore the canvas when opening a board or returning from home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, home]);
  useEffect(() => {
    if (tool !== "connect") connectFrom.current = null;
  }, [tool]);

  const addComponent = useCallback(
    (kind: ComponentKind, point?: { x: number; y: number }) => {
      if (readOnly) return;
      const bounds = canvasRef.current?.getBoundingClientRect();
      const center =
        point ??
        flow.screenToFlowPosition({
          x: (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2 - 90,
          y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2 - 45,
        });
      const node = makeNode(kind, center);
      node.selected = true;
      update((current) => ({
        ...current,
        nodes: [
          ...current.nodes.map((item) => ({ ...item, selected: false })),
          node,
        ],
        edges: current.edges.map((edge) => ({ ...edge, selected: false })),
      }));
      setTool("select");
      setShowInspector(true);
    },
    [flow, update, readOnly],
  );

  const duplicate = useCallback(() => {
    if (readOnly) return;
    const selected = board.nodes.filter((node) => node.selected);
    if (!selected.length) return;
    update(duplicateSelection);
  }, [board.nodes, update, readOnly]);

  const deleteSelection = useCallback(() => {
    if (readOnly) return;
    if (
      !board.nodes.some((node) => node.selected) &&
      !board.edges.some((edge) => edge.selected)
    )
      return;
    update(removeSelection);
  }, [board.nodes, board.edges, update, readOnly]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('input, textarea, select, [contenteditable="true"]') ||
        modal ||
        home
      )
        return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && ["z", "d", "a"].includes(key)) event.preventDefault();
      if (command && key === "z") {
        if (!readOnly) event.shiftKey ? workspace.redo() : workspace.undo();
        return;
      }
      if (command && key === "d") {
        duplicate();
        return;
      }
      if (command && key === "a") {
        update(
          (current) => ({
            ...current,
            nodes: current.nodes.map((node) => ({ ...node, selected: true })),
          }),
          false,
          false,
        );
        return;
      }
      if (command) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) setSpacePressed(true);
      }
      if (event.repeat) return;
      if (key === "v") setTool("select");
      if (key === "h") setTool("hand");
      if (key === "c" && !readOnly) setTool("connect");
      if (key === "n") addComponent("note");
      if (key === "t") addComponent("text");
      if (key === "/") {
        event.preventDefault();
        setSidebarTab("components");
        setShowSidebar(true);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>(".search-field input")
            ?.focus(),
        );
      }
      if (event.shiftKey && event.code === "Digit1")
        flow.fitView({ padding: 0.2, duration: 300 });
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        deleteSelection();
      }
      if (key === "?") setModal("shortcuts");
      if (key === "escape") {
        setTool("select");
        connectFrom.current = null;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    const blur = () => setSpacePressed(false);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  });

  const onNodesChange = useCallback(
    (changes: NodeChange<DiagramNode>[]) => {
      const resizeChange = changes.find(
        (change) =>
          change.type === "dimensions" && typeof change.resizing === "boolean",
      );
      if (resizeChange?.type === "dimensions") {
        if (resizeChange.resizing && !resizing.current) workspace.checkpoint();
        resizing.current = Boolean(resizeChange.resizing);
      }
      const touch =
        resizing.current ||
        changes.some(
          (change) => change.type !== "select" && change.type !== "dimensions",
        );
      update(
        (current) => ({
          ...current,
          nodes: applyNodeChanges(changes, current.nodes),
        }),
        false,
        touch,
      );
    },
    [update, workspace.checkpoint],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      update(
        (current) => ({
          ...current,
          edges: applyEdgeChanges(changes, current.edges),
        }),
        false,
        changes.some((change) => change.type !== "select"),
      );
    },
    [update],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || connection.source === connection.target) return;
      update((current) => ({
        ...current,
        edges: addEdge(
          { ...defaultEdgeOptions, ...connection, id: crypto.randomUUID() },
          current.edges,
        ),
      }));
    },
    [update, readOnly],
  );

  const updateNode = (changes: Partial<ComponentData>) => {
    if (readOnly || !selectedNode) return;
    update((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, ...changes } }
          : node,
      ),
    }));
  };

  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const pendingCreation = useRef<ReturnType<typeof createBoard> | null>(null);
  const createSharedBoard = async (draft: ReturnType<typeof createBoard>) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    if (!pendingCreation.current || boardContent(pendingCreation.current) !== boardContent(draft)) pendingCreation.current = draft;
    draft = pendingCreation.current;
    const startingHash = location.hash;
    setCreating(true);
    try {
      const saved = await cloud.createBoard(draft);
      workspace.addBoard(saved);
      pendingCreation.current = null;
      if (location.hash === startingHash) {
        showEditor(saved.inviteCode);
        setModal(null);
      }
      setTool("select");
      setToast("Your shared board is ready.");
    } catch (error) {
      setToast(messageFor(error));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };
  const newBoard = (template: TemplateId) => createSharedBoard(createBoard(template));
  const openBoard = (id: string) => {
    const selected = workspace.boards.find((item) => item.id === id);
    if (!selected) return;
    if (!selected.inviteCode) { void createSharedBoard(selected); return; }
    workspace.switchBoard(id);
    showEditor(selected.inviteCode);
  };

  const exportPng = async () => {
    if (!board.nodes.length) {
      setToast("Add a component before exporting an image.");
      return;
    }
    const viewport = document.querySelector<HTMLElement>(
      ".react-flow__viewport",
    );
    if (!viewport) return;
    setIsExporting(true);
    try {
      const bounds = flow.getNodesBounds(board.nodes);
      const width = Math.min(4096, Math.max(1200, bounds.width + 160));
      const height = Math.min(4096, Math.max(700, bounds.height + 160));
      const transform = getViewportForBounds(
        bounds,
        width,
        height,
        0.1,
        2,
        0.14,
      );
      const dataUrl = await toPng(viewport, {
        backgroundColor: "#f8faf9",
        width,
        height,
        pixelRatio: 2,
        skipFonts: true,
        filter: (element) =>
          !element.classList?.contains("react-flow__handle") &&
          !element.classList?.contains("react-flow__resize-control"),
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
        },
      });
      download(dataUrl, `${fileName(board.title)}.png`);
      setToast("Your architecture is ready to share.");
    } catch {
      setToast("Image export failed. Keep this board open and try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return {
    auth,
    workspace,
    cloud,
    board,
    update,
    readOnly,
    invitationInput,
    setInvitationInput,
    flow,
    zoom,
    modal,
    setModal,
    sidebarTab,
    setSidebarTab,
    search,
    setSearch,
    tool,
    setTool,
    spacePressed,
    setSpacePressed,
    showGrid,
    setShowGrid,
    showMiniMap,
    setShowMiniMap,
    showSidebar,
    setShowSidebar,
    showInspector,
    setShowInspector,
    toast,
    setToast,
    home,
    routeError,
    retryBoardLink: () => { setRouteError(""); cloud.retry(); setRouteRetry((value) => value + 1); },
    activeRemoved,
    isExporting,
    canvasRef,
    connectFrom,
    resizing,
    selectedNodes,
    selectedNode,
    selectedEdge,
    isPanning,
    showHome,
    showEditor,
    addComponent,
    duplicate,
    deleteSelection,
    onNodesChange,
    onEdgesChange,
    onConnect,
    updateNode,
    creating,
    openBoard,
    newBoard,
    exportPng,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
