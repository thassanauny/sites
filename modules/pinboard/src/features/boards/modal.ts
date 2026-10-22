import type { Board, Card, Column } from '../../domain/boards/types';
export type ModalState =
  | { type: 'create' }
  | { type: 'join'; code?: string }
  | { type: 'share'; board: Board }
  | { type: 'pending'; board: Board }
  | { type: 'board'; board: Board }
  | { type: 'card'; board: Board; card: Card; isNew: boolean }
  | { type: 'column'; board: Board; column: Column; isNew: boolean }
  | { type: 'help' };
