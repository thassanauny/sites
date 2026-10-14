import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board } from '../domain/boards/types';
import { acceptBoard } from '../domain/boards/board';
import { cloudConfigured, loadBoards } from '../infrastructure/cloud/boards';
import type { DeviceBoards } from '../infrastructure/storage/deviceBoards';
import { message } from '../ui/message';

const POLL_MS = 5000;
const MAX_POLL_MS = 60_000;

/**
 * Loads the joined boards, keeps them fresh every few seconds and merges saves with refreshes.
 * After a failed refresh, background polls wait longer (10 s, 20 s ... up to a minute) until one succeeds.
 */
export function useBoardSync({
  deviceBoards,
  syncRemovals,
  onError,
  onSynced,
  onNotice,
  onReconnect,
}: {
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
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
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
      try {
        syncRemovals();
      } catch (failure) {
        onError(message(failure));
        setLoaded(true);
        return;
      }
      if (!cloudConfigured || !navigator.onLine) {
        setLoaded(true);
        return;
      }
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      const refreshVersion = writeVersion.current;
      setRefreshing(true);
      try {
        // A person's refresh downloads every board; background polls download only what changed.
        const incoming = await loadBoards(manual ? undefined : boardsRef.current);
        const removed = syncRemovals();
        setBoards((current) => {
          const existing = new Map(current.map((item) => [item.id, item]));
          const merged = new Map(
            incoming
              .filter((item) => !removed.has(item.invite_code))
              .map((item) => [item.id, acceptBoard(existing.get(item.id), item)]),
          );
          // A complete list removes inaccessible boards, while overlapping saves/joins stay visible.
          current.forEach((item) => {
            if (
              !merged.has(item.id) &&
              !removed.has(item.invite_code) &&
              (boardWrites.current.get(item.id) ?? 0) > refreshVersion
            ) {
              merged.set(item.id, item);
            }
          });
          const next = [...merged.values()];
          // Nothing changed: keep the array so React skips the render.
          return next.length === current.length &&
            next.every((item, index) => item === current[index])
            ? current
            : next;
        });
        poll.current = { failures: 0, notBefore: 0 };
        setLastSync(new Date());
        if (manual) {
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
