import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Board } from "../domain/boards/types";
import { boardContent } from "../domain/boards/codec";
import { cloudBaseline, mergeCloudBoard, sameBoardContent } from "../domain/boards/merge";
import type { useWorkspace } from "./useWorkspace";
import { supabase } from "../infrastructure/cloud/client";
import { watchBoardChanges } from "../infrastructure/cloud/live";
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
  | "offline"
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
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const connected = () => {
      setOnline(true);
      failures.current.clear();
      setRetry(value => value + 1);
    };
    const disconnected = () => { setOnline(false); setStatus('offline'); };
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);
  const active = useRef(true);
  const initialized = useRef(false);
  const inFlight = useRef(false);
  const immediateSave = useRef(false);
  const syncGeneration = useRef(0);
  const refreshRequested = useRef(false);
  const refreshCloud = useRef<() => void>(() => {});
  const retryCloud = useRef<() => void>(() => {});
  const conflicts = useRef(new Map<string, string>());
  const failures = useRef(
    new Map<string, { content: string; message: string }>(),
  );
  const { board, mergeCloudBoards, markCloudSaved, openCloudBoard } = workspace;
  const knownBoards = useRef(workspace.boards);
  // Keep observed remote documents separate from dirty local baselines. A genuine
  // conflict should not download the same remote revision on every poll.
  const remoteBoards = useRef(new Map<string, Board>());
  knownBoards.current = workspace.boards;
  const contents = useMemo(() => new Map(workspace.boards.map(item => [item.id, boardContent(item)])), [workspace.boards]);
  const pendingBoards = workspace.boards.filter(
    (item) => item.cloudSavedContent !== contents.get(item.id),
  );
  const candidates = [
    ...workspace.boards.filter((item) => item.id === board.id),
    ...workspace.boards.filter((item) => item.id !== board.id),
  ];
  const pendingBoard = candidates.find(
    (item) =>
      item.cloudSavedContent !== contents.get(item.id) &&
      !conflicts.current.has(item.id) &&
      failures.current.get(item.id)?.content !== contents.get(item.id),
  );
  const signature = pendingBoard ? contents.get(pendingBoard.id)! : "";

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
    let liveHealthy = false;
    let readFailed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const clearRetry = () => { clearTimeout(retryTimer); retryTimer = undefined; };
    const retrySoon = () => {
      if (cancelled || !liveHealthy || document.hidden || !navigator.onLine || retryTimer !== undefined) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        // An active read covers this retry. A save cannot repair a failed
        // collection read, so hand that catch-up to its serialized completion.
        if (inFlight.current && readFailed) refreshRequested.current = true;
        else if (!reading && !inFlight.current) void refresh();
      }, 10_000);
    };
    async function refresh() {
      if (cancelled || document.hidden) return;
      if (reading || inFlight.current) { refreshRequested.current = true; return; }
      refreshRequested.current = false;
      if (!navigator.onLine) { setReady(knownBoards.current.some(board => board.revision > 0)); setStatus('offline'); return; }
      reading = true;
      const generation = syncGeneration.current;
      if (!initialized.current) {
        setStatus("loading");
        setReady(false);
      }
      try {
        const known = knownBoards.current.map(board => {
          const remote = remoteBoards.current.get(board.id);
          return remote && remote.revision >= board.revision ? remote : cloudBaseline(board);
        });
        const boards = await listCloudBoards(client, known);
        if (cancelled || generation !== syncGeneration.current) return;
        remoteBoards.current = new Map(boards.map(board => [board.id, board]));
        const locals = new Map(knownBoards.current.map(board => [board.id, board]));
        for (const remote of boards) {
          const local = locals.get(remote.id);
          if (!local || (remote.revision <= local.revision && !sameBoardContent(local, remote))) continue;
          const merged = mergeCloudBoard(local, remote);
          if (merged.revision === remote.revision && merged.cloudSavedContent === boardContent(remote)) {
            conflicts.current.delete(remote.id);
          } else {
            conflicts.current.set(remote.id, `“${local.title}”: ${messageFor(new CloudConflictError())}`);
          }
        }
        mergeCloudBoards(boards);
        readFailed = false;
        clearRetry();
        setLastSync(new Date());
        initialized.current = true;
        setReady(true);
        failures.current.clear();
        setSaveTick(value => value + 1);
      } catch (fetchError) {
        if (!cancelled && generation === syncGeneration.current) {
          if (fetchError instanceof SharingUpdateError) {
            initialized.current = false;
            setReady(false);
          } else if (knownBoards.current.some(board => board.revision > 0)) {
            setReady(true);
          }
          setError(messageFor(fetchError));
          setStatus("error");
          readFailed = true;
          retrySoon();
        }
      } finally {
        reading = false;
        if (!cancelled && refreshRequested.current && !inFlight.current && !document.hidden)
          queueMicrotask(() => { void refresh(); });
      }
    }
    void refresh();
    const onFocus = () => {
      if (document.hidden) clearRetry();
      else void refresh();
    };
    refreshCloud.current = onFocus;
    retryCloud.current = retrySoon;
    const stopLive = watchBoardChanges(client, user.id, onFocus, id =>
      Math.max(remoteBoards.current.get(id)?.revision ?? 0, knownBoards.current.find(board => board.id === id)?.revision ?? 0),
      healthy => {
        liveHealthy = healthy;
        if (!healthy) clearRetry();
        else if (readFailed || failures.current.size) retrySoon();
      });
    window.addEventListener("focus", onFocus);
    window.addEventListener("offline", clearRetry);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      stopLive();
      if (refreshCloud.current === onFocus) refreshCloud.current = () => {};
      if (retryCloud.current === retrySoon) retryCloud.current = () => {};
      clearRetry();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", clearRetry);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [user?.id, retry, mergeCloudBoards]);

  useEffect(() => {
    if (!supabase || !user || !ready) return;
    if (!online) { setStatus('offline'); return; }
    if (!workspace.cloudDurable) return;
    if (inFlight.current) return;
    if (!pendingBoard) {
      immediateSave.current = false;
      const conflict = conflicts.current.values().next().value;
      const failure = failures.current.values().next().value;
      setStatus(conflict ? "conflict" : failure ? "error" : "saved");
      setError(conflict || failure?.message || "");
      return;
    }
    setStatus("saving");
    const client = supabase;
    const timer = setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      immediateSave.current = false;
      try {
        const saved = await saveCloudBoard(client, pendingBoard);
        if (active.current) {
          setLastSync(new Date());
          failures.current.delete(pendingBoard.id);
          markCloudSaved(pendingBoard.id, saved.revision, signature, {
            inviteCode: saved.inviteCode,
          });
          remoteBoards.current.set(pendingBoard.id, { ...pendingBoard, ...saved, cloudSavedContent: signature });
        }
      } catch (saveError) {
        if (active.current) {
          const message = `“${pendingBoard.title}”: ${messageFor(saveError)}`;
          if (saveError instanceof CloudConflictError) {
            conflicts.current.set(pendingBoard.id, message);
            setRetry(value => value + 1);
          } else
            failures.current.set(pendingBoard.id, {
              content: signature,
              message,
            });
          retryCloud.current();
        }
      } finally {
        inFlight.current = false;
        if (refreshRequested.current) refreshCloud.current();
        if (active.current) setSaveTick((v) => v + 1);
      }
    }, immediateSave.current ? 0 : 700);
    return () => clearTimeout(timer);
  }, [
    user?.id,
    ready,
    signature,
    pendingBoard?.revision,
    pendingBoard?.id,
    markCloudSaved,
    saveTick,
    online,
    workspace.cloudDurable,
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
    const source = board;
    const copy: Board = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      title: `${source.title.slice(0, 108)} (copy)`,
      revision: 0,
      cloudSavedContent: undefined,
      inviteCode: undefined,
      updatedAt: new Date().toISOString(),
    };
    if (conflicts.current.has(source.id) || workspace.localError.includes("another tab")) workspace.deleteBoard(source.id);
    workspace.addBoard(copy);
    conflicts.current.delete(source.id);
    setError("");
    setRetry((v) => v + 1);
  };
  const forceSync = async () => {
    if (!supabase || !user || !ready || !navigator.onLine)
      throw new Error("Reconnect before force syncing. Your local changes are safe.");
    if (!board.revision)
      throw new Error("Save this board online before force syncing.");
    if (inFlight.current) throw new Error("Wait for saving to finish, then try again.");
    if (!workspace.cloudDurable)
      throw new Error("Wait for your local recovery copy to save, then try again.");
    const snapshot = board;
    const content = boardContent(snapshot);
    inFlight.current = true;
    syncGeneration.current++;
    setStatus("saving");
    try {
      const saved = await saveCloudBoard(supabase, snapshot, { force: true });
      if (active.current) {
        markCloudSaved(snapshot.id, saved.revision, content, { inviteCode: saved.inviteCode });
        conflicts.current.delete(snapshot.id);
        failures.current.delete(snapshot.id);
        setLastSync(new Date());
        setError("");
      }
    } catch (failure) {
      if (active.current) conflicts.current.set(snapshot.id, `“${snapshot.title}”: ${messageFor(failure)}`);
      if (active.current) retryCloud.current();
      throw failure;
    } finally {
      inFlight.current = false;
      if (refreshRequested.current) refreshCloud.current();
      if (active.current) setSaveTick(value => value + 1);
    }
  };
  return {
    status,
    flushNow: () => { immediateSave.current = true; setSaveTick(value => value + 1); },
    lastSync,
    error,
    ready,
    saveAsCopy,
    forceSync,
    boardConflict: board.revision > 0 && conflicts.current.has(board.id),
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
