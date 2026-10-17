export type ColumnColor = 'slate' | 'blue' | 'amber' | 'emerald' | 'rose' | 'violet';
export type CardPriority = 'low' | 'medium' | 'high';
export interface CardFilters {
  query: string;
  priority: string;
  assignee: string;
}
export type OptionalCardField = 'description' | 'priority' | 'assignee' | 'dueDate' | 'labels';

export interface CustomCardField {
  id: string;
  title: string;
  hidden: boolean;
}

export interface CardFieldSettings {
  hidden: OptionalCardField[];
  custom: CustomCardField[];
  assignees?: string[];
}

export interface Column {
  id: string;
  title: string;
  color: ColumnColor;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  columnId: string;
  position: number;
  priority: CardPriority;
  assignee: string;
  /** Empty when no deadline is set; otherwise a calendar date in YYYY-MM-DD. */
  dueDate: string;
  labels: string[];
  customFields?: Record<string, string>;
  archived?: boolean;
}

export interface Board {
  localPending?: boolean;
  localCached?: boolean;
  localError?: string;
  id: string;
  invite_code: string;
  title: string;
  description: string;
  columns: Column[];
  cards: Card[];
  revision: number;
  created_at: string;
  updated_at: string;
  /** Absent on boards that have never customized their fields. */
  card_fields?: CardFieldSettings;
}

/** A board's identity and version, read cheaply to find out which boards changed. */
export interface BoardHead {
  id: string;
  revision: number;
}

/** Collection navigation never needs card text or field settings. */
export type BoardSummary = Omit<Board, 'cards' | 'card_fields'> & { active_card_count: number };

export type CardPatch = Partial<Omit<Card, 'id'>>;

/** A drop places the moving card immediately before or after this card. */
export interface CardDropTarget {
  id: string;
  edge: 'before' | 'after';
}

/** Operations touch only their own fields; the server serializes edits to a board. */
export type Operation =
  | { type: 'add_assignee' | 'delete_assignee'; name: string }
  | {
      type: 'update_board';
      patch: Partial<Pick<Board, 'title' | 'description' | 'card_fields'>>;
    }
  | { type: 'add_column'; column: Column }
  | {
      type: 'update_column';
      id: string;
      patch: Partial<Pick<Column, 'title' | 'color'>>;
    }
  | { type: 'reorder_columns'; columnIds: string[] }
  | { type: 'delete_column'; id: string; targetColumnId: string }
  | { type: 'create_card'; card: Card }
  | { type: 'update_card'; id: string; patch: CardPatch }
  | { type: 'move_card'; id: string; columnId: string; position: number }
  | { type: 'delete_card'; id: string };
