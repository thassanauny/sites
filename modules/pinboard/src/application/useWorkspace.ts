import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, Card, Column, Operation } from '../domain/boards/types';
import { nextPosition } from '../domain/boards/board';
import {
  cloudConfigured,
  createBoard,
  joinBoard,
  mutateBoard,
  startNewSession,
} from '../infrastructure/cloud/boards';
import { DEVICE_BOARDS_PREFIX } from '../infrastructure/storage/deviceBoards';
import { message } from '../ui/message';
import { useBoardSync } from './useBoardSync';
import { useDeviceRemovals } from './useDeviceRemovals';
import { useRouteModal } from './useRouteModal';
import { routeCode } from './workspace';

/** Joins the sync, removal and route state with the actions people take on boards. */
export function useWorkspace() {
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState('');
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);
  // An error caused by background syncing disappears once a later refresh succeeds; one caused by
  // something the person did (a failed save or join) stays until they dismiss it or act again.
  const syncFailed = useRef(false);
  const setError = useCallback((text: string) => {
    syncFailed.current = false;
    setErrorText(text);
  }, []);
  const setSyncError = useCallback((text: string) => {
    syncFailed.current = text !== '';
    setErrorText(text);
  }, []);
  const clearSyncError = useCallback(() => {
    if (!syncFailed.current) return;
    syncFailed.current = false;
    setErrorText('');
  }, []);
  const { deviceBoards, removedCodes, removalsReady, removalsRef, syncRemovals, markRemoved } =
    useDeviceRemovals();
  const {
    selectedCode,
    setSelectedCode,
    modal,
    setModal,
    modalRef,
    joinRetry,
    navigations,
    failedLink,
    navigationVersion,
    navigate,
    closeModal,
    retryLink,
    leaveRemovedBoard,
  } = useRouteModal();
  const { boards, setBoards, loaded, refreshing, offline, lastSync, setLastSync, refresh, upsert } =
    useBoardSync({
      deviceBoards,
      syncRemovals,
      onError: setSyncError,
      onSynced: clearSyncError,
      onNotice: setNotice,
      onReconnect: retryLink,
    });
  const visibleBoards = boards.filter((item) => !removedCodes.has(item.invite_code));
  const board = visibleBoards.find((item) => item.invite_code === selectedCode);
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(DEVICE_BOARDS_PREFIX)) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
        const removed = syncRemovals();
        setBoards((current) => current.filter((item) => !removed.has(item.invite_code)));
        if (removed.has(routeCode())) {
          leaveRemovedBoard();
          // Keep the editor mounted: its draft is memory-only and must survive
          // another tab hiding this board. It can be copied or explicitly rejoined.
          setNotice('Board removed from this device. Any open draft is kept.');
        }
        void refresh();
      } catch (failure) {
        setSyncError(message(failure));
      }
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, [refresh, syncRemovals, setBoards, leaveRemovedBoard, setSyncError]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: joinRetry only re-runs the join when the user presses Retry.
  useEffect(() => {
    if (
      !cloudConfigured ||
      !loaded ||
      !removalsReady ||
      !selectedCode ||
      board ||
      offline ||
      failedLink.current === selectedCode
    )
      return;
    if (removalsRef.current.has(selectedCode)) {
      failedLink.current = selectedCode;
      setModal({ type: 'join', code: selectedCode });
      return;
    }
    let active = true;
    joinBoard(selectedCode)
      .then((incoming) => {
        if (active) {
          upsert(incoming);
          setError('');
        }
      })
      .catch((failure) => {
        if (active) {
          failedLink.current = selectedCode;
          setError(message(failure));
          setModal({ type: 'join', code: selectedCode });
        }
      });
    return () => {
      active = false;
    };
  }, [
    selectedCode,
    board,
    loaded,
    removalsReady,
    offline,
    upsert,
    setError,
    joinRetry,
    failedLink,
    removalsRef,
    setModal,
  ]);
  const action = useCallback(
    async (
      work: () => Promise<Board>,
      success: string,
      open = false,
      restore?: { code: string; marker: string | null },
    ) => {
      if (busyRef.current) {
        setNotice('Another change is still saving. Try again in a moment.');
        return false;
      }
      if (!navigator.onLine) {
        setError('Reconnect to save changes.');
        return false;
      }
      busyRef.current = true;
      const startedNavigation = navigationVersion.current;
      setBusy(true);
      setError('');
      try {
        const saved = await work();
        if (restore) {
          if (startedNavigation !== navigationVersion.current) return false;
          if (!deviceBoards.restore(restore.code, restore.marker)) {
            syncRemovals();
            throw new Error(
              'This board was removed from this device while joining. Join again to restore it.',
            );
          }
          syncRemovals();
        }
        if (!upsert(saved)) return false;
        if (startedNavigation !== navigationVersion.current) return false;
        setLastSync(new Date());
        setNotice(success);
        if (open) {
          modalRef.current = undefined;
          setModal(undefined);
          navigate(saved);
        }
        return true;
      } catch (failure) {
        if (startedNavigation === navigationVersion.current) setError(message(failure));
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [
      deviceBoards,
      syncRemovals,
      upsert,
      setLastSync,
      modalRef,
      setModal,
      navigate,
      navigationVersion,
      setError,
    ],
  );
  const create = useCallback(
    (id: string, title: string, description: string) =>
      action(() => createBoard(id, title, description), 'Your board is ready', true),
    [action],
  );
  const join = useCallback(
    (code: string) => {
      const marker = deviceBoards.removal(code);
      return action(() => joinBoard(code), 'Welcome to the board', true, {
        code,
        marker,
      });
    },
    [action, deviceBoards],
  );
  const recoverDraft = useCallback(
    async (code: string) => {
      const marker = deviceBoards.removal(code);
      const restored = await action(
        () => joinBoard(code),
        'Board rejoined. Your draft is kept.',
        false,
        {
          code,
          marker,
        },
      );
      if (restored) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}#board/${code}`,
        );
        setSelectedCode(code);
      }
      return restored;
    },
    [action, deviceBoards, setSelectedCode],
  );
  const removeDeviceBoard = useCallback(
    (item: Board) => {
      if (busyRef.current) return;
      markRemoved(item.invite_code);
      setBoards((current) => current.filter((value) => value.id !== item.id));
      setModal(undefined);
      setError('');
      navigate();
      setNotice('Board removed from this device');
    },
    [markRemoved, setBoards, setModal, setError, navigate],
  );
  const save = useCallback(
    (id: string, operation: Operation) =>
      action(() => mutateBoard(id, operation), 'Saved to your board'),
    [action],
  );
  /** Retry a board link that failed and reload the boards. */
  const retry = useCallback(() => {
    retryLink();
    void refresh(true);
  }, [retryLink, refresh]);
  /** Back up the damaged stored session, then reconnect with what is left. */
  const startSession = useCallback(async () => {
    try {
      await startNewSession();
      setError('');
      retry();
    } catch (failure) {
      setError(message(failure));
    }
  }, [retry, setError]);
  const disabled = busy || offline || !cloudConfigured;
  const refreshDisabled = disabled || refreshing || !loaded;
  // These actions read the board on screen at call time, so their identity never changes and a
  // refresh that changes nothing leaves the board and its cards free to skip rendering.
  const boardRef = useRef(board);
  boardRef.current = board;
  const openSettings = useCallback(() => {
    const current = boardRef.current;
    if (current) setModal({ type: 'board', board: current });
  }, [setModal]);
  const openInvite = useCallback(() => {
    const current = boardRef.current;
    if (current) setModal({ type: 'share', board: current });
  }, [setModal]);
  const openColumn = useCallback(
    (column: Column) => {
      const current = boardRef.current;
      if (current) setModal({ type: 'column', board: current, column, isNew: false });
    },
    [setModal],
  );
  const addColumn = useCallback(() => {
    const current = boardRef.current;
    if (current)
      setModal({
        type: 'column',
        board: current,
        isNew: true,
        column: { id: crypto.randomUUID(), title: '', color: 'blue' },
      });
  }, [setModal]);
  const openCard = useCallback(
    (card: Card) => {
      const current = boardRef.current;
      if (current) setModal({ type: 'card', board: current, card, isNew: false });
    },
    [setModal],
  );
  const addCard = useCallback(
    (column: Column) => {
      const current = boardRef.current;
      if (!current) return;
      setModal({
        type: 'card',
        board: current,
        isNew: true,
        card: {
          id: crypto.randomUUID(),
          title: '',
          description: '',
          columnId: column.id,
          position: nextPosition(current, column.id),
          priority: 'medium',
          assignee: '',
          dueDate: '',
          labels: [],
        },
      });
    },
    [setModal],
  );
  // A drop that arrives while another save runs, or offline, is answered by `action` with a message.
  const moveCard = useCallback(
    (card: Card, columnId: string) => {
      const current = boardRef.current;
      if (!current || card.columnId === columnId) return;
      void save(current.id, {
        type: 'move_card',
        id: card.id,
        columnId,
        position: nextPosition(current, columnId),
      });
    },
    [save],
  );
  /** A card dropped on a column; the drag carried only its ID. */
  const dropCard = useCallback(
    (cardId: string, columnId: string) => {
      const card = boardRef.current?.cards.find((item) => item.id === cardId);
      if (card) moveCard(card, columnId);
    },
    [moveCard],
  );
  const refreshNow = useCallback(() => void refresh(true), [refresh]);
  const dismissError = useCallback(() => setError(''), [setError]);
  const boardList = [...visibleBoards].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const workspaceCardCount = boardList.reduce((total, item) => total + item.cards.length, 0);
  // The open dialog edits a snapshot; these follow the live board and this device's removals.
  const modalBoard =
    modal && 'board' in modal ? boards.find((item) => item.id === modal.board.id) : undefined;
  const modalRemoved =
    modal && 'board' in modal ? removedCodes.has(modal.board.invite_code) : false;
  return {
    board,
    boardList,
    visibleCount: visibleBoards.length,
    workspaceCardCount,
    selectedCode,
    loaded,
    removalsReady,
    refreshing,
    busy,
    offline,
    error,
    notice,
    lastSync,
    navigations,
    modal,
    modalBoard,
    modalRemoved,
    disabled,
    refreshDisabled,
    setModal,
    closeModal,
    navigate,
    refresh,
    retry,
    startSession,
    refreshNow,
    dismissError,
    setNotice,
    create,
    join,
    recoverDraft,
    removeDeviceBoard,
    openSettings,
    openInvite,
    openColumn,
    addColumn,
    openCard,
    addCard,
    moveCard,
    dropCard,
    save,
  };
}
