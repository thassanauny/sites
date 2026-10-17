import type { Board } from "../../domain/boards/types";
import {
  boardContent,
  parseBoard,
  serializeBoard,
} from "../../domain/boards/codec";
export const STORAGE_KEY = "blueprint.workspace.v1";
import type { WorkspaceData } from "../../domain/boards/workspace";
export function readRemoved(value: string | null): Set<string> | undefined {
  try {
    const ids = JSON.parse(value || "[]");
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
    )
      return;
    return new Set(ids);
  } catch {
    return;
  }
}
export function hasWorkspace(key: string) {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

export function readWorkspace(storageKey: string): WorkspaceData {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (Array.isArray(stored?.boards)) {
      const boards = stored.boards.map((board: Board) => {
        const sanitized = {
          ...parseBoard(serializeBoard(board)),
          id: board.id,
          updatedAt: board.updatedAt,
          revision: board.revision || 0,
          viewport: board.viewport,
          inviteCode: board.inviteCode,
        };
        return {
          ...sanitized,
          cloudSavedContent:
            board.cloudSavedContent === boardContent(board)
              ? boardContent(sanitized)
              : board.cloudSavedContent,
        };
      });
      return {
        boards,
        activeId: boards.some((board: Board) => board.id === stored.activeId)
          ? stored.activeId
          : boards[0]?.id || "",
      };
    }
  } catch {
    /* A corrupt local draft must not prevent opening the app. */
  }
  return { boards: [], activeId: "" };
}

/** The only browser-storage adapter for workspace drafts and device removals. */
export function workspaceStorage(userId?: string) {
  const key = userId ? `${STORAGE_KEY}.${userId}` : STORAGE_KEY;
  const removedKey = `${key}.removed`;
  return {
    load: () => readWorkspace(key),
    hasSaved: () => hasWorkspace(key),
    save: (serialized: string) => localStorage.setItem(key, serialized),
    removed: () => {
      try {
        return (
          readRemoved(localStorage.getItem(removedKey)) || new Set<string>()
        );
      } catch {
        return new Set<string>();
      }
    },
    async updateRemoved(id: string, remove: boolean): Promise<Set<string>> {
      const change = () => {
        const ids = readRemoved(localStorage.getItem(removedKey));
        if (!ids)
          throw new Error(
            "Could not read removed boards. Keep this page open and restore browser storage access before clearing any data.",
          );
        const wasRemoved = ids.has(id);
        if (remove) ids.add(id);
        else ids.delete(id);
        // Persist before updating the UI, serializing tabs against the existing storage lock.
        if (wasRemoved !== remove)
          localStorage.setItem(removedKey, JSON.stringify([...ids]));
        return ids;
      };
      return navigator.locks
        ? navigator.locks.request(removedKey, change)
        : change();
    },
    watchRemoved(onChange: (ids: Set<string>) => void) {
      const changed = (event: StorageEvent) => {
        if (event.key !== removedKey) return;
        const ids = readRemoved(event.newValue);
        if (ids) onChange(ids);
      };
      window.addEventListener("storage", changed);
      return () => window.removeEventListener("storage", changed);
    },
  };
}
