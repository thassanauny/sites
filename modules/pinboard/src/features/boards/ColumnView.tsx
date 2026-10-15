import { useState, type DragEvent } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { Card, CardDropTarget, CardFieldSettings, Column } from '../../domain/boards/types';
import { CardTile } from './CardTile';

export function ColumnView({
  column,
  columns,
  fields,
  cards,
  firstCardId,
  lastCardId,
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
  onReorderCard,
  onDragColumn,
}: {
  column: Column;
  /** Every column of the board, for the Move menu on each card. */
  columns: Column[];
  fields: CardFieldSettings;
  /** The cards to show, in order; filters may hide others. */
  cards: Card[];
  firstCardId?: string;
  lastCardId?: string;
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
  onDropCard: (cardId: string, columnId: string, target?: CardDropTarget) => void;
  onReorderCard: (card: Card, direction: -1 | 1) => void;
  /** Reports the column a card is dragged over, or an empty ID when it leaves. */
  onDragColumn: (columnId: string) => void;
}) {
  const [dropTarget, setDropTarget] = useState<CardDropTarget>();
  function targetAt(event: DragEvent<HTMLElement>): CardDropTarget | undefined {
    const tile = (event.target as Element).closest<HTMLElement>('[data-card-id]');
    if (!tile) {
      // A gap between tiles is the position before the next visible card, not the column end.
      const next = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]')].find(
        (item) => event.clientY < item.getBoundingClientRect().top,
      );
      return next ? { id: next.dataset.cardId!, edge: 'before' } : undefined;
    }
    if (!event.currentTarget.contains(tile)) return;
    const bounds = tile.getBoundingClientRect();
    return {
      id: tile.dataset.cardId!,
      edge: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
    };
  }
  return (
    <section
      className={`pinboard-column color-${column.color} ${dropActive ? 'drop-active' : ''}`}
      aria-label={column.title}
      onDragOver={(event) => {
        if (!disabled && event.dataTransfer.types.includes('application/pinboard-card')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const target = targetAt(event);
          setDropTarget((current) =>
            current?.id === target?.id && current?.edge === target?.edge ? current : target,
          );
          onDragColumn(column.id);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragColumn('');
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragColumn('');
        setDropTarget(undefined);
        onDropCard(
          event.dataTransfer.getData('application/pinboard-card'),
          column.id,
          targetAt(event),
        );
      }}
      onDragEnd={() => onDragColumn('')}
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
            fields={fields}
            disabled={disabled}
            today={today}
            canMoveUp={card.id !== firstCardId}
            canMoveDown={card.id !== lastCardId}
            dropEdge={dropActive && dropTarget?.id === card.id ? dropTarget.edge : undefined}
            onEdit={onEditCard}
            onMove={onMoveCard}
            onReorder={onReorderCard}
          />
        ))}
        {dropActive && !dropTarget && cards.length > 0 && <div className="card-drop-end" />}
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
