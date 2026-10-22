import type { Board, Operation } from '../../domain/boards/types';
import type { ModalState } from './modal';
import { BoardSettingsDialog } from './dialogs/BoardSettingsDialog';
import { CardDialog } from './dialogs/CardDialog';
import { ColumnDialog } from './dialogs/ColumnDialog';
import { CreateBoardDialog } from './dialogs/CreateBoardDialog';
import { HelpDialog } from './dialogs/HelpDialog';
import { JoinBoardDialog } from './dialogs/JoinBoardDialog';
import { ShareDialog } from './dialogs/ShareDialog';
import type { PendingBoardReview } from '../../infrastructure/cloud/offlineBoards';

export interface BoardDialogProps {
  modal: ModalState;
  busy: boolean;
  offline: boolean;
  /** Another tab removed this board from the device; its draft is kept in memory only. */
  removed: boolean;
  serverError: string;
  currentBoard?: Board;
  onClose: () => void;
  onSave: (boardId: string, operation: Operation, recovery?: Board) => Promise<boolean>;
  onCreate: (id: string, title: string, description: string) => Promise<boolean>;
  onCopy: (id: string, source: Board) => Promise<boolean>;
  onForce: (review: PendingBoardReview) => Promise<boolean>;
  onJoin: (code: string) => Promise<boolean>;
  onRecover: (code: string) => Promise<boolean>;
  onRemove: (board: Board) => void;
  onNotice: (text: string) => void;
  onReview: (id: string) => Promise<PendingBoardReview>;
  onResolve: (review: PendingBoardReview, action: 'retry' | 'discard') => Promise<boolean>;
}

/** Shows the dialog the workspace asked for. */
export function BoardDialog({
  modal,
  busy,
  offline,
  removed,
  serverError,
  currentBoard,
  onClose,
  onSave,
  onCreate,
  onCopy,
  onForce,
  onJoin,
  onRecover,
  onRemove,
  onNotice,
  onReview,
  onResolve,
}: BoardDialogProps) {
  const shared = { busy, offline, serverError, onClose };
  switch (modal.type) {
    case 'help':
      return <HelpDialog busy={busy} onClose={onClose} />;
    case 'share':
      return <ShareDialog board={modal.board} busy={busy} onClose={onClose} onNotice={onNotice} />;
    case 'create':
      return <CreateBoardDialog {...shared} onCreate={onCreate} />;
    case 'join':
      return <JoinBoardDialog {...shared} initialCode={modal.code ?? ''} onJoin={onJoin} />;
    case 'board':
      return (
        <BoardSettingsDialog
          {...shared}
          board={modal.board}
          currentBoard={currentBoard}
          removed={removed}
          onSave={onSave}
          onRecover={onRecover}
          onRemove={onRemove}
          onNotice={onNotice}
          onReview={onReview}
          onResolve={onResolve}
          onCopy={onCopy}
          onForce={onForce}
        />
      );
    case 'card':
      return (
        <CardDialog
          {...shared}
          board={modal.board}
          initial={modal.card}
          isNew={modal.isNew}
          currentBoard={currentBoard}
          removed={removed}
          onSave={onSave}
          onRecover={onRecover}
          onNotice={onNotice}
        />
      );
    case 'column':
      return (
        <ColumnDialog
          {...shared}
          board={modal.board}
          initial={modal.column}
          isNew={modal.isNew}
          currentBoard={currentBoard}
          removed={removed}
          onSave={onSave}
          onRecover={onRecover}
          onNotice={onNotice}
        />
      );
  }
}
