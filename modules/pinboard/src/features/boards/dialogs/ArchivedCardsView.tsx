import { useRef, useState } from 'react';
import { Archive, ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import type { Board, Card, Operation } from '../../../domain/boards/types';
import { FormError } from './shared';
import { message } from '../../../ui/message';

const PAGE_SIZE = 20;

export function ArchivedCardsView({
  board,
  busy,
  locked,
  offline,
  removed,
  serverError,
  onSave,
  onBack,
}: {
  board: Board;
  busy: boolean;
  locked: boolean;
  offline: boolean;
  removed: boolean;
  serverError: string;
  onSave: (boardId: string, operation: Operation) => Promise<boolean>;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [columnId, setColumnId] = useState('');
  const [page, setPage] = useState(0);
  const [deleteId, setDeleteId] = useState('');
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const archived = board.cards.filter((card) => card.archived);
  const term = query.trim().toLowerCase();
  const matches = archived
    .filter(
      (card) =>
        (!columnId || card.columnId === columnId) && card.title.toLowerCase().includes(term),
    )
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * PAGE_SIZE;
  const visible = matches.slice(start, start + PAGE_SIZE);
  const filtered = Boolean(query || columnId);
  const resultLabel = filtered
    ? matches.length === 1
      ? 'match'
      : 'matches'
    : matches.length === 1
      ? 'card'
      : 'cards';

  function changePage(next: number) {
    setPage(next);
    setDeleteId('');
    if (list.current) list.current.scrollTop = 0;
  }

  async function save(card: Card, deleting: boolean) {
    if (locked) return;
    setLocalError('');
    setNotice('');
    try {
      const operation: Operation = deleting
        ? { type: 'delete_card', id: card.id }
        : { type: 'update_card', id: card.id, patch: { archived: false } };
      if (await onSave(board.id, operation)) {
        setDeleteId('');
        setNotice(`${deleting ? 'Deleted' : 'Restored'} “${card.title}”.`);
      }
    } catch (failure) {
      setLocalError(message(failure));
    }
  }

  return (
    <div className="archive-browser">
      <p className="archive-intro">
        {archived.length} archived {archived.length === 1 ? 'card' : 'cards'}. Restore a card with
        its details, or delete it permanently.
      </p>
      <div className="archive-filters">
        <label className="field">
          Search archived cards
          <input
            type="search"
            placeholder="Search by card title…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              changePage(0);
            }}
          />
        </label>
        <label className="field">
          Column
          <select
            aria-label="Filter archived cards by column"
            value={columnId}
            onChange={(event) => {
              setColumnId(event.target.value);
              changePage(0);
            }}
          >
            <option value="">All columns</option>
            {board.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="archive-results-heading">
        <p role="status">
          {matches.length
            ? `Showing ${start + 1}–${start + visible.length} of ${matches.length} ${resultLabel}`
            : filtered
              ? '0 matches'
              : '0 archived cards'}
          <span> · Sorted by title</span>
        </p>
        {filtered && (
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              setQuery('');
              setColumnId('');
              changePage(0);
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {matches.length ? (
        <ul className="archived-card-list" aria-label="Archived cards" ref={list}>
          {visible.map((card) => (
            <li key={card.id}>
              <div>
                <strong>{card.title}</strong>
                <span>
                  {board.columns.find((column) => column.id === card.columnId)?.title ??
                    'Column removed'}
                </span>
              </div>
              <div className="archive-card-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={locked}
                  aria-label={`Restore ${card.title}`}
                  onClick={() => void save(card, false)}
                >
                  <RotateCcw size={14} /> Restore
                </button>
                <button
                  type="button"
                  className="button quiet delete-button"
                  disabled={locked}
                  aria-label={`Delete ${card.title}`}
                  onClick={() => setDeleteId(card.id)}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
              {deleteId === card.id && (
                <div className="archive-delete-confirm">
                  <p>Delete “{card.title}” permanently? This cannot be undone.</p>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setDeleteId('')}
                  >
                    Cancel delete
                  </button>
                  <button
                    type="button"
                    className="button delete-button"
                    disabled={locked}
                    aria-label={`Permanently delete ${card.title}`}
                    onClick={() => void save(card, true)}
                  >
                    Delete permanently
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="archive-empty">
          <Archive size={28} />
          <h3>{archived.length ? 'No cards found' : 'Your archive is empty'}</h3>
          <p>
            {archived.length
              ? 'Try a different title or column.'
              : 'Archived cards will appear here when you need them.'}
          </p>
        </div>
      )}
      {notice && (
        <p className="archive-notice" role="status">
          {notice}
        </p>
      )}
      {(localError || serverError) && <FormError>{localError || serverError}</FormError>}
      {offline && <FormError>Reconnect to restore or delete cards.</FormError>}
      {removed && (
        <FormError>
          This board was removed from this device. Return to settings to recover your draft.
        </FormError>
      )}
      <div className="archive-footer">
        <button type="button" className="button secondary" onClick={onBack} disabled={busy}>
          <ArrowLeft size={16} /> Back to settings
        </button>
        {pageCount > 1 && (
          <nav aria-label="Archive pages">
            <button
              type="button"
              className="button secondary"
              disabled={currentPage === 0 || busy}
              onClick={() => changePage(currentPage - 1)}
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={currentPage === pageCount - 1 || busy}
              onClick={() => changePage(currentPage + 1)}
            >
              Next <ChevronRight size={16} />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
