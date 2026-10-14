import { MoreHorizontal, Plus } from 'lucide-react';
import type { Card, Column } from '../../domain/boards/types';
import { CardTile } from './CardTile';

export function ColumnView({
  column,
  columns,
  cards,
  hasCards,
  dropActive,
  disabled,
  canAddCard,
  today,
  onSettings,
  onAddCard,
  onEditCard,
  onMoveCard,
  onDropCard,
  onDragColumn,
}: {
  column: Column;
  /** Every column of the board, for the Move menu on each card. */
  columns: Column[];
  /** The cards to show, in order; filters may hide others. */
  cards: Card[];
  /** Whether the column holds any card, shown or not. */
  hasCards: boolean;
  dropActive: boolean;
  disabled: boolean;
  canAddCard: boolean;
  today: string;
  onSettings: (column: Column) => void;
  onAddCard: (column: Column) => void;
  onEditCard: (card: Card) => void;
  onMoveCard: (card: Card, columnId: string) => void;
  onDropCard: (cardId: string, columnId: string) => void;
  /** Reports the column a card is dragged over, or an empty ID when it leaves. */
  onDragColumn: (columnId: string) => void;
}) {
  return (
    <section
      className={`pinboard-column color-${column.color} ${dropActive ? 'drop-active' : ''}`}
      aria-label={column.title}
      onDragOver={(event) => {
        if (!disabled && event.dataTransfer.types.includes('application/pinboard-card')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          onDragColumn(column.id);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragColumn('');
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragColumn('');
        onDropCard(event.dataTransfer.getData('application/pinboard-card'), column.id);
      }}
    >
      <div className="column-heading">
        <span className="column-dot" />
        <h2>{column.title}</h2>
        <span className="column-count">{cards.length}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Settings for ${column.title}`}
          disabled={disabled}
          onClick={() => onSettings(column)}
        >
          <MoreHorizontal size={19} />
        </button>
      </div>
      <div className="column-cards">
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            columns={columns}
            disabled={disabled}
            today={today}
            onEdit={onEditCard}
            onMove={onMoveCard}
          />
        ))}
        {cards.length === 0 && (
          <div className="column-empty">
            <span className="empty-dashes" />
            <p>{hasCards ? 'No matching cards' : 'A little breathing room.'}</p>
          </div>
        )}
      </div>
      <button
        type="button"
        className="add-card"
        disabled={disabled || !canAddCard}
        onClick={() => onAddCard(column)}
      >
        <Plus size={16} />
        Add a card
      </button>
    </section>
  );
}
