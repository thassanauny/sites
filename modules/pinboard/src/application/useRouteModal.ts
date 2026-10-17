import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board } from '../domain/boards/types';
import type { ModalState } from '../features/boards/modal';
import { routeCode, invalidRoute } from './workspace';

/** The selected board and open dialog, driven by the address hash (`#board/<code>`). */
export function useRouteModal() {
  const [routeInvalid, setRouteInvalid] = useState(invalidRoute);
  const [selectedCode, setSelectedCode] = useState(routeCode);
  const [modal, setModal] = useState<ModalState | undefined>();
  const modalRef = useRef(modal);
  modalRef.current = modal;
  const [joinRetry, setJoinRetry] = useState(0);
  /** Counts address changes so views can reset their filters. */
  const [navigations, setNavigations] = useState(0);
  const failedLink = useRef('');
  const navigationVersion = useRef(0);
  const navigate = useCallback((incoming?: Pick<Board, 'invite_code'>) => {
    navigationVersion.current += 1;
    failedLink.current = '';
    window.location.hash = incoming ? `board/${incoming.invite_code}` : '';
    setRouteInvalid(false);
    setSelectedCode(incoming?.invite_code ?? '');
    setNavigations((value) => value + 1);
  }, []);
  const closeModal = useCallback(
    (expected: ModalState) => {
      if (modalRef.current !== expected) return;
      setModal(undefined);
      if (expected.type === 'join' && routeCode()) navigate();
    },
    [navigate],
  );
  /** Let the board link try joining again, for example after reconnecting. */
  const retryLink = useCallback(() => {
    failedLink.current = '';
    setJoinRetry((value) => value + 1);
  }, []);
  /** Leave a board that another tab removed, keeping any open dialog and its draft. */
  const leaveRemovedBoard = useCallback(() => {
    navigationVersion.current += 1;
    failedLink.current = '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#`);
    setSelectedCode('');
  }, []);
  useEffect(() => {
    const hash = () => {
      navigationVersion.current += 1;
      failedLink.current = '';
      setRouteInvalid(invalidRoute());
      setSelectedCode(routeCode());
      setModal(undefined);
      setNavigations((value) => value + 1);
    };
    window.addEventListener('hashchange', hash);
    return () => window.removeEventListener('hashchange', hash);
  }, []);
  return {
    selectedCode,
    routeInvalid,
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
  };
}
