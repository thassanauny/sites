import { mergeDeviceWorkspace, mergeWorkspace, openWorkspaceBoard, type WorkspaceData } from "../domain/boards/workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board } from "../domain/boards/types";
import { cleanDiagram } from "../domain/boards/codec";
import { createBoard } from "../domain/boards/templates";
import { workspaceStorage } from "../infrastructure/storage/workspace";
import { sameBoardContent, sameJson } from "../domain/boards/merge";
import { historyEntry, rebaseHistory, type HistoryEntry } from "../domain/boards/history";

export function useWorkspace(userId?: string) {
  const storage = useMemo(() => workspaceStorage(userId), [userId]);
  const [removedIds, setRemovedIds] = useState(() => storage.removed());
  const removalVersion = useRef(0);
  const updateRemoved = useCallback(
    async (id: string, remove: boolean) => {
      const ids = await storage.updateRemoved(id, remove);
      removalVersion.current++;
      setRemovedIds(ids);
    },
    [storage],
  );
  useEffect(() => storage.watchRemoved((ids) => { removalVersion.current++; setRemovedIds(ids); }), [storage]);
  const hadLocalWorkspace = useRef(storage.hasSaved());
  const [workspace, setWorkspace] = useState(() => storage.load());
  const currentWorkspace = useRef(workspace);
  currentWorkspace.current = workspace;
  const durableWorkspace = useRef(storage.baseline());
  const [savedSnapshot, setSavedSnapshot] = useState<WorkspaceData>();
  const [localError, setLocalError] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const past = useRef<HistoryEntry[]>([]);
  const future = useRef<HistoryEntry[]>([]);
  const [emptyBoard] = useState(() => createBoard("blank"));
  const board = workspace.boards.find(
    (item) => item.id === workspace.activeId,
  ) || emptyBoard;
  const removedRef = useRef(removedIds);
  removedRef.current = removedIds;
  const boardRef = useRef(board);
  boardRef.current = board;
  // Apply each transition once outside React's replayable state updater.
  const changeWorkspace = useCallback((recipe: (current: WorkspaceData) => WorkspaceData, external = false) => {
    const previous = currentWorkspace.current;
    const next = recipe(previous);
    if (external) {
      const before = previous.boards.find(item => item.id === previous.activeId);
      const after = next.boards.find(item => item.id === next.activeId);
      if (before && after) {
        const rebased = rebaseHistory(before, after, past.current, future.current);
        if (rebased.past !== past.current || rebased.future !== future.current) {
          past.current = rebased.past;
          future.current = rebased.future;
          setHistoryVersion(value => value + 1);
        }
      } else {
        past.current = [];
        future.current = [];
        setHistoryVersion(value => value + 1);
      }
    }
    currentWorkspace.current = next;
    setWorkspace(next);
  }, []);
  const serialized = JSON.stringify({
    ...workspace,
    boards: workspace.boards.map((item) => ({
      ...item,
      ...cleanDiagram(item),
    })),
  });

  const snapshot = useMemo(() => JSON.parse(serialized) as WorkspaceData, [serialized]);
  const localStatus: "saved" | "saving" | "error" = localError ? "error"
    : savedSnapshot && sameJson(snapshot, savedSnapshot) ? "saved" : "saving";
  const durableBoards = new Map(savedSnapshot?.boards.map(item => [item.id, item]));
  const cloudDurable = !localError && savedSnapshot?.boards.length === snapshot.boards.length
    && snapshot.boards.every(item => {
      const saved = durableBoards.get(item.id);
      return saved && item.revision === saved.revision && item.cloudSavedContent === saved.cloudSavedContent
        && item.inviteCode === saved.inviteCode && sameBoardContent(item, saved);
    });
  const persist = useCallback(async (snapshot: string) => {
    const requested = JSON.parse(snapshot) as WorkspaceData;
    try {
      const saved = await storage.save(snapshot);
      durableWorkspace.current = saved;
      setSavedSnapshot(saved);
      changeWorkspace(current => sameJson(requested, saved) ? current : mergeDeviceWorkspace(requested, current, saved) ?? current, true);
      setLocalError("");
    } catch (error) {
      const message = error instanceof Error && error.message.includes("another tab")
        ? error.message : "Could not save on this device. Keep this board open and try again.";
      setLocalError(message);
      throw new Error(message);
    }
  }, [storage, changeWorkspace]);
  const saveNow = useCallback(() => persist(serialized), [persist, serialized]);

  useEffect(() => storage.watch(external => {
    const merged = mergeDeviceWorkspace(durableWorkspace.current, currentWorkspace.current, external);
    if (merged) changeWorkspace(() => merged, true);
    else {
      setLocalError("This draft changed in another tab. Keep this board open and save your changes as a new board to preserve both versions.");
    }
  }), [storage, changeWorkspace]);

  useEffect(() => {
    if (savedSnapshot && sameJson(snapshot, savedSnapshot)) return;
    const timer = setTimeout(() => {
      void persist(serialized).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [serialized, snapshot, savedSnapshot, persist]);

  useEffect(() => {
    const flush = () => {
      try { storage.stage(serialized); } catch { /* Existing durable drafts remain untouched. */ }
      void persist(serialized).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [serialized, persist, storage]);

  useEffect(() => {
    if (localStatus === "saved") return;
    const pending = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", pending);
    return () => window.removeEventListener("beforeunload", pending);
  }, [localStatus]);

  const checkpoint = useCallback(() => {
    past.current = [
      ...past.current.slice(-59),
      structuredClone(historyEntry(currentWorkspace.current.boards.find(item => item.id === currentWorkspace.current.activeId) || boardRef.current)),
    ];
    future.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const update = useCallback(
    (recipe: (board: Board) => Board, remember = true, touch = true) => {
      if (touch) hadLocalWorkspace.current = true;
      if (remember) checkpoint();
      changeWorkspace((previous) => ({
        ...previous,
        boards: previous.boards.map((item) =>
          item.id === previous.activeId
            ? {
                ...recipe(item),
                ...(touch ? { updatedAt: new Date().toISOString() } : {}),
              }
            : item,
        ),
      }));
    },
    [checkpoint, changeWorkspace],
  );

  const travel = useCallback(
    (direction: "undo" | "redo") => {
      const source = direction === "undo" ? past : future;
      const destination = direction === "undo" ? future : past;
      const diagram = source.current.pop();
      if (!diagram) return;
      destination.current.push(structuredClone(historyEntry(boardRef.current)));
      setHistoryVersion((v) => v + 1);
      update((current) => ({ ...current, ...diagram }), false);
    },
    [update],
  );

  const switchBoard = useCallback((id: string) => {
    past.current = [];
    future.current = [];
    setHistoryVersion((v) => v + 1);
    changeWorkspace((previous) => ({ ...previous, activeId: id }));
  }, [changeWorkspace]);

  const addBoard = useCallback((newBoard: Board) => {
    hadLocalWorkspace.current = true;
    past.current = [];
    future.current = [];
    setHistoryVersion((v) => v + 1);
    changeWorkspace((previous) => ({
      boards: [newBoard, ...previous.boards.filter((item) => item.id !== newBoard.id)],
      activeId: newBoard.id,
    }));
  }, [changeWorkspace]);

  const deleteBoard = useCallback((id: string) => {
    past.current = [];
    future.current = [];
    setHistoryVersion((v) => v + 1);
    changeWorkspace((previous) => {
      const remaining = previous.boards.filter((item) => item.id !== id);
      return {
        boards: remaining,
        activeId:
          previous.activeId === id ? remaining[0]?.id || "" : previous.activeId,
      };
    });
  }, [changeWorkspace]);

  const removeFromDevice = useCallback(
    async (id: string) => {
      const item = workspace.boards.find((board) => board.id === id);
      if (!item) return;
      if (!item.revision) {
        deleteBoard(id);
        return;
      }
      await updateRemoved(id, true);
    },
    [workspace.boards, deleteBoard, updateRemoved],
  );

  const mergeCloudBoards = useCallback((remoteBoards: Board[]) => {
    const replaceStarter =
      !hadLocalWorkspace.current && remoteBoards.length > 0;
    if (replaceStarter) hadLocalWorkspace.current = true;
    changeWorkspace((previous) =>
      mergeWorkspace(previous, remoteBoards, replaceStarter),
      true,
    );
  }, [changeWorkspace]);

  const markCloudSaved = useCallback(
    (
      id: string,
      revision: number,
      content: string,
      metadata: Partial<Pick<Board, "inviteCode">> = {},
    ) => {
      changeWorkspace((previous) => ({
        ...previous,
        boards: previous.boards.map((item) =>
          item.id === id && item.revision <= revision
            ? { ...item, ...metadata, revision, cloudSavedContent: content }
            : item,
        ),
      }));
    },
    [changeWorkspace],
  );

  const openCloudBoard = useCallback(
    async (remote: Board, restore = true) => {
      if (restore) await updateRemoved(remote.id, false);
      else if (removedRef.current.has(remote.id)) return false;
      past.current = [];
      future.current = [];
      setHistoryVersion((v) => v + 1);
      const replaceStarter = !hadLocalWorkspace.current;
      hadLocalWorkspace.current = true;
      changeWorkspace((previous) =>
        openWorkspaceBoard(previous, remote, replaceStarter),
      );
    },
    [updateRemoved, changeWorkspace],
  );

  return {
    board,
    boards: workspace.boards,
    visibleBoards: workspace.boards.filter(
      (board) => !removedIds.has(board.id),
    ),
    activeRemoved: removedIds.has(workspace.activeId),
    removalVersion: () => removalVersion.current,
    isRemoved: (id: string) => removedRef.current.has(id),
    removeFromDevice,
    update,
    addBoard,
    deleteBoard,
    switchBoard,
    checkpoint,
    undo: () => travel("undo"),
    redo: () => travel("redo"),
    canUndo: historyVersion >= 0 && past.current.length > 0,
    canRedo: historyVersion >= 0 && future.current.length > 0,
    localStatus,
    cloudDurable,
    localError,
    saveNow,
    mergeCloudBoards,
    markCloudSaved,
    openCloudBoard,
  };
}
