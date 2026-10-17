import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Board } from "../domain/boards/types";
import { boardContent } from "../domain/boards/codec";
import type { useWorkspace } from "./useWorkspace";
import { supabase } from "../infrastructure/cloud/client";
import {
  listCloudBoards,
  joinCloudBoard,
  saveCloudBoard,
  messageFor,
  SharingUpdateError,
  CloudConflictError,
} from "../infrastructure/cloud/boards";
type CloudStatus =
  | "local"
  | "loading"
  | "saving"
  | "saved"
  | "error"
  | "conflict";
export function useCloudBoards(
  user: User | null,
  workspace: ReturnType<typeof useWorkspace>,
) {
  const [status, setStatus] = useState<CloudStatus>(user ? "loading" : "local");
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [ready, setReady] = useState(!user);
  const [retry, setRetry] = useState(0);
  const [saveTick, setSaveTick] = useState(0);
  const active = useRef(true);
  const initialized = useRef(false);
  const inFlight = useRef(false);
  const conflicts = useRef(new Map<string, string>());
  const failures = useRef(
    new Map<string, { content: string; message: string }>(),
  );
  const { board, mergeCloudBoards, markCloudSaved, openCloudBoard } = workspace;
  const knownBoards = useRef(workspace.boards);
  knownBoards.current = workspace.boards;
  const pendingBoards = workspace.boards.filter(
    (item) => item.cloudSavedContent !== boardContent(item),
  );
  const candidates = [
    ...workspace.boards.filter((item) => item.id === board.id),
    ...workspace.boards.filter((item) => item.id !== board.id),
  ];
  const pendingBoard = candidates.find(
    (item) =>
      !(location.hash.startsWith("#/join/") && !item.revision) &&
      item.cloudSavedContent !== boardContent(item) &&
      !conflicts.current.has(item.id) &&
      failures.current.get(item.id)?.content !== boardContent(item),
  );
  const signature = pendingBoard ? boardContent(pendingBoard) : "";

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!supabase || !user) return;
    const client = supabase;
    let cancelled = false;
    let reading = false;
    async function refresh() {
      if (reading || inFlight.current) return;
      reading = true;
      if (!initialized.current) {
        setStatus("loading");
        setReady(false);
      }
      try {
        const boards = await listCloudBoards(client, knownBoards.current);
        if (cancelled) return;
        mergeCloudBoards(boards);
        setLastSync(new Date());
        initialized.current = true;
        setReady(true);
      } catch (fetchError) {
        if (!cancelled) {
          if (fetchError instanceof SharingUpdateError) {
            initialized.current = false;
            setReady(false);
          }
          setError(messageFor(fetchError));
          setStatus("error");
        }
      } finally {
        reading = false;
      }
    }
    void refresh();
    const onFocus = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(onFocus, 10000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [user?.id, retry, mergeCloudBoards]);

  useEffect(() => {
    if (!supabase || !user || !ready) return;
    if (!pendingBoard) {
      const conflict = conflicts.current.values().next().value;
      const failure = failures.current.values().next().value;
      setStatus(conflict ? "conflict" : failure ? "error" : "saved");
      setError(conflict || failure?.message || "");
      return;
    }
    if (inFlight.current) return;
    setStatus("saving");
    const client = supabase;
    const timer = setTimeout(async () => {
      inFlight.current = true;
      try {
        const saved = await saveCloudBoard(client, pendingBoard);
        if (active.current) {
          setLastSync(new Date());
          failures.current.delete(pendingBoard.id);
          markCloudSaved(pendingBoard.id, saved.revision, signature, {
            inviteCode: saved.inviteCode,
          });
        }
      } catch (saveError) {
        if (active.current) {
          const message = `“${pendingBoard.title}”: ${messageFor(saveError)}`;
          if (saveError instanceof CloudConflictError)
            conflicts.current.set(pendingBoard.id, message);
          else
            failures.current.set(pendingBoard.id, {
              content: signature,
              message,
            });
        }
      } finally {
        inFlight.current = false;
        if (active.current) setSaveTick((v) => v + 1);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [
    user?.id,
    ready,
    signature,
    pendingBoard?.revision,
    pendingBoard?.id,
    markCloudSaved,
    saveTick,
  ]);

  const joinBoard = async (input: string, restore = true, current = () => true) => {
    if (!supabase || !user)
      throw new Error(
        "A Supabase device session is required. Check Settings and retry.",
      );
    const version = workspace.removalVersion();
    const joined = await joinCloudBoard(supabase, input);
    conflicts.current.delete(joined.id);
    failures.current.delete(joined.id);
    if (!current()) return null;
    if (version !== workspace.removalVersion()) throw new Error("Device removals changed while opening. Open this link again to retry.");
    if (!restore && workspace.isRemoved(joined.id)) return null;
    const wasRemoved = workspace.isRemoved(joined.id);
    await openCloudBoard(joined, restore);
    setLastSync(new Date());
    return { ...joined, wasRemoved };
  };
  const saveAsCopy = () => {
    const source =
      workspace.boards.find((item) => conflicts.current.has(item.id)) || board;
    const copy: Board = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      title: `${source.title.slice(0, 108)} (copy)`,
      revision: 0,
      cloudSavedContent: undefined,
      inviteCode: undefined,
      updatedAt: new Date().toISOString(),
    };
    workspace.deleteBoard(source.id);
    workspace.addBoard(copy);
    conflicts.current.delete(source.id);
    setError("");
    setRetry((v) => v + 1);
  };
  return {
    status,
    lastSync,
    error,
    ready,
    saveAsCopy,
    joinBoard,
    createBoard: async (draft: Board) => {
      if (!supabase || !user || !ready)
        throw new Error("Connect to Blueprint sharing before creating a board. Check Settings and retry.");
      const saved = await saveCloudBoard(supabase, draft);
      if (active.current) setLastSync(new Date());
      return { ...draft, ...saved, cloudSavedContent: boardContent(draft) };
    },
    pending: Boolean(user && pendingBoards.length),
    retry: () => {
      conflicts.current.clear();
      failures.current.clear();
      setRetry((v) => v + 1);
    },
  };
}
