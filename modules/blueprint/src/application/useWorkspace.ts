import { mergeWorkspace, openWorkspaceBoard } from "../domain/boards/workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, Diagram } from "../domain/boards/types";
import { cleanDiagram } from "../domain/boards/codec";
import { createBoard } from "../domain/boards/templates";
import { workspaceStorage } from "../infrastructure/storage/workspace";

type HistoryEntry = Diagram & Pick<Board, "iconStyle" | "colorIntensity">;
function historyEntry(board: Board): HistoryEntry {
  return { ...cleanDiagram(board), iconStyle: board.iconStyle, colorIntensity: board.colorIntensity };
}

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
  const [localStatus, setLocalStatus] = useState<"saved" | "saving" | "error">(
    "saved",
  );
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
  const serialized = JSON.stringify({
    ...workspace,
    boards: workspace.boards.map((item) => ({
      ...item,
      ...cleanDiagram(item),
    })),
  });

  const saveNow = useCallback(() => {
    try {
      storage.save(serialized);
      setLocalStatus("saved");
    } catch {
      setLocalStatus("error");
      throw new Error("Could not save on this device. Keep this board open and try again.");
    }
  }, [serialized, storage]);

  useEffect(() => {
    setLocalStatus("saving");
    const timer = setTimeout(() => {
      try {
        storage.save(serialized);
        setLocalStatus("saved");
      } catch {
        setLocalStatus("error");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [serialized, storage]);

  useEffect(() => {
    const flush = () => {
      try {
        storage.save(serialized);
      } catch {
        /* Status is surfaced by autosave. */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [serialized, storage]);

  const checkpoint = useCallback(() => {
    past.current = [
      ...past.current.slice(-59),
      structuredClone(historyEntry(boardRef.current)),
    ];
    future.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const update = useCallback(
    (recipe: (board: Board) => Board, remember = true, touch = true) => {
      if (touch) hadLocalWorkspace.current = true;
      if (remember) checkpoint();
      setWorkspace((previous) => ({
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
    [checkpoint],
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
    setWorkspace((previous) => ({ ...previous, activeId: id }));
  }, []);

  const addBoard = useCallback((newBoard: Board) => {
    hadLocalWorkspace.current = true;
    past.current = [];
    future.current = [];
    setHistoryVersion((v) => v + 1);
    setWorkspace((previous) => ({
      boards: [newBoard, ...previous.boards.filter((item) => item.id !== newBoard.id)],
      activeId: newBoard.id,
    }));
  }, []);

  const deleteBoard = useCallback((id: string) => {
    past.current = [];
    future.current = [];
    setHistoryVersion((v) => v + 1);
    setWorkspace((previous) => {
      const remaining = previous.boards.filter((item) => item.id !== id);
      return {
        boards: remaining,
        activeId:
          previous.activeId === id ? remaining[0]?.id || "" : previous.activeId,
      };
    });
  }, []);

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
    setWorkspace((previous) =>
      mergeWorkspace(previous, remoteBoards, replaceStarter),
    );
  }, []);

  const markCloudSaved = useCallback(
    (
      id: string,
      revision: number,
      content: string,
      metadata: Partial<Pick<Board, "inviteCode">> = {},
    ) => {
      setWorkspace((previous) => ({
        ...previous,
        boards: previous.boards.map((item) =>
          item.id === id
            ? { ...item, ...metadata, revision, cloudSavedContent: content }
            : item,
        ),
      }));
    },
    [],
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
      setWorkspace((previous) =>
        openWorkspaceBoard(previous, remote, replaceStarter),
      );
    },
    [updateRemoved],
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
    saveNow,
    mergeCloudBoards,
    markCloudSaved,
    openCloudBoard,
  };
}
