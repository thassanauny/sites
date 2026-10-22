import type { Board } from "../../domain/boards/types";
import {
  boardContent,
  parseBoard,
  serializeBoard,
} from "../../domain/boards/codec";
export const STORAGE_KEY = "blueprint.workspace.v1";
import { mergeDeviceWorkspace, type WorkspaceData } from "../../domain/boards/workspace";
import { withWorkspaceLock } from "./workspaceLock";
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

function parseWorkspace(value: string | null): WorkspaceData {
  const stored = JSON.parse(value || "null");
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
  if (stored !== null) throw new Error("Could not read saved drafts. Keep this board open and recover browser storage before saving.");
  return { boards: [], activeId: "" };
}

export function readWorkspace(storageKey: string): WorkspaceData {
  try { return parseWorkspace(localStorage.getItem(storageKey)); }
  catch { return { boards: [], activeId: "" }; }
}

function savedWorkspace(value: string | null): WorkspaceData {
  const stored = JSON.parse(value || "null");
  if (stored === null) return { boards: [], activeId: "" };
  if (!Array.isArray(stored?.boards) || typeof stored.activeId !== "string")
    throw new Error("Could not read saved drafts. Keep this board open and recover browser storage before saving.");
  return stored;
}

/** The only browser-storage adapter for workspace drafts and device removals. */
export function workspaceStorage(userId?: string) {
  const key = userId ? `${STORAGE_KEY}.${userId}` : STORAGE_KEY;
  const removedKey = `${key}.removed`;
  const pendingKey = `${key}.pending`;
  let base: WorkspaceData | undefined;
  let saving: { requested: WorkspaceData; promise: Promise<WorkspaceData> } | undefined;
  return {
    load: () => {
      const latest = readWorkspace(key);
      base = latest;
      try {
        const pending = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
        if (pending) {
          const previous = savedWorkspace(JSON.stringify(pending.base));
          const draft = savedWorkspace(JSON.stringify(pending.workspace));
          base = previous;
          return mergeDeviceWorkspace(previous, draft, latest) ?? draft;
        }
      } catch { /* Keep any unreadable recovery journal intact. */ }
      return latest;
    },
    hasSaved: () => {
      try { return hasWorkspace(key) || Boolean(sessionStorage.getItem(pendingKey)); }
      catch { return hasWorkspace(key); }
    },
    baseline: () => base ?? readWorkspace(key),
    // Navigation can end an asynchronous transaction. This tab-owned journal
    // survives reload without replacing another tab's acknowledged workspace.
    stage: (serialized: string) => sessionStorage.setItem(pendingKey, JSON.stringify({ base: base ?? savedWorkspace(localStorage.getItem(key)), workspace: savedWorkspace(serialized) })),
    save: (serialized: string): Promise<WorkspaceData> => {
      const requested = savedWorkspace(serialized);
      let pendingAtStart: string | null | undefined;
      try { pendingAtStart = sessionStorage.getItem(pendingKey); } catch { /* Saving the primary snapshot still works. */ }
      const previous = saving;
      const next = (previous ? previous.promise.then(() => previous.requested, () => base) : Promise.resolve(base)).then(expected => withWorkspaceLock(key, () => {
        const latest = savedWorkspace(localStorage.getItem(key));
        const merged = mergeDeviceWorkspace(expected ?? latest, requested, latest);
        if (!merged) throw new Error("This draft changed in another tab. Keep this board open and save your changes as a new board to preserve both versions.");
        localStorage.setItem(key, JSON.stringify(merged));
        base = merged;
        try {
          const pending = sessionStorage.getItem(pendingKey);
          if (pending !== null && pending === pendingAtStart) sessionStorage.removeItem(pendingKey);
        } catch { /* Retain recovery data when its cleanup cannot be verified. */ }
        return merged;
      }));
      saving = { requested, promise: next };
      return next;
    },
    watch(onChange: (workspace: WorkspaceData) => void) {
      const changed = (event: StorageEvent) => {
        if (event.key !== key) return;
        try { onChange(savedWorkspace(localStorage.getItem(key))); }
        catch { /* Never replace a draft with unreadable external data. */ }
      };
      window.addEventListener("storage", changed);
      return () => window.removeEventListener("storage", changed);
    },
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
