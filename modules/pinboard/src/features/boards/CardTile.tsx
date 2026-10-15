import { memo } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, GripVertical } from 'lucide-react';
import type { Card, CardFieldSettings, Column } from '../../domain/boards/types';
import { fieldVisible } from '../../domain/boards/fields';

/** Re-renders only when its own card, the column list or the flags change, not on every refresh. */
export const CardTile = memo(function CardTile({
  card,
  columns,
  fields,
  disabled,
  today,
  canMoveUp,
  canMoveDown,
  dropEdge,
  onEdit,
  onMove,
  onReorder,
}: {
  card: Card;
  columns: Column[];
  fields: CardFieldSettings;
  disabled: boolean;
  /** Today's date as YYYY-MM-DD, to mark overdue cards. */
  today: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dropEdge?: 'before' | 'after';
  onEdit: (card: Card) => void;
  onMove: (card: Card, columnId: string) => void;
  onReorder: (card: Card, direction: -1 | 1) => void;
}) {
  const overdue = Boolean(card.dueDate && card.dueDate < today);
  return (
    <article
      className={`task-card${fieldVisible(fields, 'priority') ? ` priority-${card.priority}` : ''}${dropEdge ? ` drop-${dropEdge}` : ''}`}
      data-card-id={card.id}
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/pinboard-card', card.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button
        type="button"
        className="card-content"
        onClick={() => onEdit(card)}
        aria-label={`Edit ${card.title}`}
        disabled={disabled}
      >
        <div className="card-top">
          {fieldVisible(fields, 'priority') && (
            <span className={`priority priority-${card.priority}`}>
              <span />
              {card.priority} priority
            </span>
          )}
          <GripVertical className="drag-grip" size={15} />
        </div>
        <h3>{card.title}</h3>
        {fieldVisible(fields, 'description') && card.description && (
          <p className="card-description">{card.description}</p>
        )}
        {fieldVisible(fields, 'labels') && card.labels.length > 0 && (
          <div className="labels">
            {card.labels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        )}
        {fields.custom.some((field) => !field.hidden && card.customFields?.[field.id]) && (
          <dl className="card-custom-fields">
            {fields.custom
              .filter((field) => !field.hidden && card.customFields?.[field.id])
              .map((field) => (
                <div key={field.id}>
                  <dt>{field.title}</dt>
                  <dd>{card.customFields![field.id]}</dd>
                </div>
              ))}
          </dl>
        )}
        {((fieldVisible(fields, 'assignee') && card.assignee) ||
          (fieldVisible(fields, 'dueDate') && card.dueDate)) && (
          <div className="card-meta">
            {fieldVisible(fields, 'assignee') && card.assignee && (
              <span className="person">
                <span className="avatar">{card.assignee.slice(0, 1).toUpperCase()}</span>
                {card.assignee}
              </span>
            )}
            {fieldVisible(fields, 'dueDate') && card.dueDate && (
              <span className={overdue ? 'due overdue' : 'due'}>
                <CalendarDays size={13} />
                {new Date(`${card.dueDate}T12:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </div>
        )}
      </button>
      <div className="card-move">
        <div className="card-order">
          <button
            type="button"
            className="icon-button"
            aria-label={`Move ${card.title} up`}
            title="Move up"
            disabled={disabled || !canMoveUp}
            onClick={() => onReorder(card, -1)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Move ${card.title} down`}
            title="Move down"
            disabled={disabled || !canMoveDown}
            onClick={() => onReorder(card, 1)}
          >
            <ArrowDown size={14} />
          </button>
        </div>
        <ArrowRight size={13} />
        <label className="sr-only" htmlFor={`move-${card.id}`}>
          Move {card.title} to
        </label>
        <select
          id={`move-${card.id}`}
          value={card.columnId}
          disabled={disabled}
          onChange={(event) => onMove(card, event.target.value)}
        >
          {columns.map((column) => (
            <option value={column.id} key={column.id}>
              {column.title}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
});
