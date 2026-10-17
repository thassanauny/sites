import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, BoardSummary } from '../domain/boards/types';
import { acceptBoard } from '../domain/boards/board';
import { acceptSummary, summarizeBoard } from '../domain/boards/summary';
import { cloudConfigured, loadBoardList, loadBoard } from '../infrastructure/cloud/boards';
import type { DeviceBoards } from '../infrastructure/storage/deviceBoards';
import { message } from '../ui/message';

const POLL_MS = 5000;
const MAX_POLL_MS = 60_000;

/**
 * Loads the joined boards, keeps them fresh every few seconds and merges saves with refreshes.
 * After a failed refresh, background polls wait longer (10 s, 20 s ... up to a minute) until one succeeds.
 */
export function useBoardSync({
  selectedCode,
  deviceBoards,
  syncRemovals,
  onError,
  onSynced,
  onNotice,
  onReconnect,
}: {
  selectedCode: string;
  deviceBoards: DeviceBoards;
  syncRemovals: () => Set<string>;
  /** A refresh failed; an empty text clears the error. */
  onError: (text: string) => void;
  /** A background refresh succeeded, so an error it caused earlier is stale. */
  onSynced: () => void;
  onNotice: (text: string) => void;
  onReconnect: () => void;
}) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [summaries, setSummaries] = useState<BoardSummary[]>([]);
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;
  const [detailError, setDetailError] = useState('');
  const [loadingBoard, setLoadingBoard] = useState(false);
  const detailRequests = useRef(new Map<string, Promise<Board>>());
  const detailFailures = useRef(
    new Map<string, { revision: number; attempts: number; notBefore: number; message: string }>(),
  );
  const poll = useRef({ failures: 0, notBefore: 0 });
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [lastSync, setLastSync] = useState<Date>();
  const refreshingRef = useRef(false);
  const writeVersion = useRef(0);
  const boardWrites = useRef(new Map<string, number>());
  /** Add or update a board from a save or join response; false when this device removed it meanwhile. */
  const upsert = useCallback(
    (incoming: Board) => {
      if (deviceBoards.removal(incoming.invite_code) !== null) return false;
      boardWrites.current.set(incoming.id, ++writeVersion.current);
      setSummaries((current) => {
        const found = current.find((item) => item.id === incoming.id);
        const next = acceptSummary(found, summarizeBoard(incoming));
        return found
          ? current.map((item) => (item.id === incoming.id ? next : item))
          : [...current, next];
      });
      setBoards((current) => {
        const found = current.find((item) => item.id === incoming.id);
        return found
          ? current.map((item) => (item.id === incoming.id ? acceptBoard(item, incoming) : item))
          : [...current, incoming];
      });
      return true;
    },
    [deviceBoards],
  );
  const refresh = useCallback(
    async (manual = false) => {
      if (manual) detailFailures.current.clear();
      try {
        syncRemovals();
      } catch (failure) {
        onError(message(failure));
        setLoaded(true);
        return;
      }
      if (!cloudConfigured) {
        setLoaded(true);
        return;
      }
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      const refreshVersion = writeVersion.current;
      setRefreshing(true);
      try {
        const incoming = await loadBoardList(summariesRef.current);
        const removed = syncRemovals();
        setSummaries((current) => {
          const existing = new Map(current.map((item) => [item.id, item]));
          const merged = new Map(
            incoming
              .filter((item) => !removed.has(item.invite_code))
              .map((item) => [item.id, acceptSummary(existing.get(item.id), item)]),
          );
          for (const item of current)
            if (
              !merged.has(item.id) &&
              !removed.has(item.invite_code) &&
              (boardWrites.current.get(item.id) ?? 0) > refreshVersion
            )
              merged.set(item.id, item);
          const next = [...merged.values()];
          return next.length === current.length &&
            next.every((item, index) => item === current[index])
            ? current
            : next;
        });
        setBoards((current) => {
          const accessible = new Set(incoming.map((item) => item.id));
          // Keep only cached details still accessible, plus saves/joins newer than this refresh.
          const next = current.filter(
            (item) =>
              !removed.has(item.invite_code) &&
              (accessible.has(item.id) || (boardWrites.current.get(item.id) ?? 0) > refreshVersion),
          );
          return next.length === current.length ? current : next;
        });
        poll.current = { failures: 0, notBefore: 0 };
        if (navigator.onLine && !incoming.some((board) => board.localPending || board.localCached))
          setLastSync(new Date());
        const cachedError = incoming.find((board) => board.localError)?.localError;
        if (cachedError) onError(cachedError);
        else if (manual) {
          onError('');
          onNotice('Boards are up to date');
        } else onSynced();
      } catch (failure) {
        const failures = poll.current.failures + 1;
        poll.current = {
          failures,
          notBefore: Date.now() + Math.min(POLL_MS * 2 ** failures, MAX_POLL_MS),
        };
        onError(message(failure));
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setLoaded(true);
      }
    },
    [syncRemovals, onError, onSynced, onNotice],
  );
  const selected = summaries.find((item) => item.invite_code === selectedCode);
  const held = boards.find((item) => item.invite_code === selectedCode);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a successful poll retries a previously failed detail load even when its revision stayed unchanged.
  useEffect(() => {
    if (
      !selected ||
      (held &&
        held.revision >= selected.revision &&
        Boolean(held.localPending) === Boolean(selected.localPending))
    ) {
      if (!selected || (held && held.revision >= selected.revision)) setDetailError('');
      setLoadingBoard(false);
      return;
    }
    const failed = detailFailures.current.get(selected.id);
    if (failed?.revision === selected.revision && Date.now() < failed.notBefore) {
      setDetailError(failed.message);
      setLoadingBoard(false);
      return;
    }
    setDetailError('');
    let active = true;
    setLoadingBoard(true);
    let request = detailRequests.current.get(selected.id);
    if (!request) {
      request = loadBoard(selected.id);
      detailRequests.current.set(selected.id, request);
      void request.finally(() => detailRequests.current.delete(selected.id)).catch(() => {});
    }
    void request
      .then((incoming) => {
        if (!active) return;
        if (incoming.revision < selected.revision && !incoming.localCached)
          throw new Error('The board changed while loading. Refresh and try again.');
        detailFailures.current.delete(selected.id);
        upsert(incoming);
      })
      .catch((failure) => {
        if (active) {
          const text = message(failure);
          const attempts = (detailFailures.current.get(selected.id)?.attempts ?? 0) + 1;
          detailFailures.current.set(selected.id, {
            revision: selected.revision,
            attempts,
            notBefore: Date.now() + Math.min(POLL_MS * 2 ** attempts, MAX_POLL_MS),
            message: text,
          });
          setDetailError(text);
        }
      })
      .finally(() => {
        if (active) setLoadingBoard(false);
      });
    return () => {
      active = false;
    };
  }, [selected, held, lastSync, upsert]);
  useEffect(() => {
    void refresh();
    const tick = window.setInterval(() => {
      if (!document.hidden && Date.now() >= poll.current.notBefore) void refresh();
    }, POLL_MS);
    const focus = () => void refresh();
    const online = () => {
      setOffline(false);
      poll.current = { failures: 0, notBefore: 0 };
      onReconnect();
      void refresh(true);
    };
    const disconnected = () => setOffline(true);
    window.addEventListener('focus', focus);
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    return () => {
      clearInterval(tick);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', disconnected);
    };
  }, [refresh, onReconnect]);
  return {
    boards,
    summaries,
    loadingBoard,
    detailError,
    setDetailError,
    setBoards,
    loaded,
    refreshing,
    offline,
    lastSync,
    setLastSync,
    refresh,
    upsert,
  };
}
