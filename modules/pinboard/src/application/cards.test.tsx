// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import {
  board,
  button,
  card,
  choose,
  click,
  deferred,
  dragCard,
  dragCardToCard,
  field,
  fill,
  installHarness,
  mount,
  moveWithMenu,
  refresh,
  search,
  uuid,
} from './testSupport';
import type { Board, Card } from '../domain/boards/types';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

const packBags: Card = {
  ...card,
  id: uuid(2),
  title: 'Pack bags',
  columnId: 'doing',
  position: 3072,
};
const populated: Board = { ...board, cards: [card, packBags] };
const sameColumn: Board = {
  ...board,
  cards: [card, { ...packBags, columnId: 'todo' }],
};
const column = (title: string) => document.querySelector(`main section[aria-label="${title}"]`)!;
const titlesIn = (name: string) =>
  [...column(name).querySelectorAll('.task-card h3')].map((item) => item.textContent);

describe('Pinboard UI: cards and columns', () => {
  it('passes exact editor text to local recovery while keeping the wire patch trimmed', async () => {
    await mount([populated]);
    await click('Edit Buy coffee');
    await fill('Card title', '  Deleted-card draft  ');
    await fill('Description optional', '  Keep exact text\nincluding spaces  ');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('That card was removed.'));
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { title: 'Deleted-card draft', description: 'Keep exact text\nincluding spaces' },
    });
    expect(cloud.recoveryDraft).toHaveBeenCalledExactlyOnceWith({
      ...populated,
      cards: [
        {
          ...card,
          title: '  Deleted-card draft  ',
          description: '  Keep exact text\nincluding spaces  ',
        },
        packBags,
      ],
    });
    expect(field('Card title').value).toBe('  Deleted-card draft  ');
    expect(button('Download card draft')).toBeDefined();
    await click('Cancel');
    await click('Discard draft');
    await click('Edit Pack bags');
    // Workspace errors outlive the editor that caused them. They must not
    // classify a different, still-present card as deleted.
    expect(document.querySelector('[aria-label="Deleted card recovery"]')).toBeNull();
    expect(field('Card title').value).toBe('Pack bags');
  });
  it.each(['before', 'after'] as const)(
    'reorders a card dropped %s another card and keeps it after refresh',
    async (edge) => {
      await mount([sameColumn]);
      const title = edge === 'before' ? 'Pack bags' : 'Buy coffee';
      const target = edge === 'before' ? 'Buy coffee' : 'Pack bags';
      const id = edge === 'before' ? packBags.id : card.id;
      const position = edge === 'before' ? 512 : 4096;
      const saved = {
        ...sameColumn,
        revision: 2,
        cards: sameColumn.cards.map((item) => (item.id === id ? { ...item, position } : item)),
      };
      cloud.mutateBoard.mockResolvedValue(saved);
      await dragCardToCard(title, target, edge, false);
      expect(button(`Edit ${target}`).closest('article')!.className).toContain(`drop-${edge}`);
      await dragCardToCard(title, target, edge);
      expect(cloud.mutateBoard).toHaveBeenCalledTimes(1);
      expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
        type: 'move_card',
        id,
        columnId: 'todo',
        position,
      });
      expect(titlesIn('To do')).toEqual(['Pack bags', 'Buy coffee']);
      expect(document.querySelector('.drop-before, .drop-after')).toBeNull();
      cloud.loadBoardList.mockResolvedValue([saved]);
      await refresh();
      expect(titlesIn('To do')).toEqual(['Pack bags', 'Buy coffee']);
    },
  );

  it('appends a card dropped on space in its own column, while self and unchanged drops do nothing', async () => {
    await mount([sameColumn]);
    await dragCardToCard('Buy coffee', 'Buy coffee', 'after');
    await dragCardToCard('Buy coffee', 'Pack bags', 'before');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    cloud.mutateBoard.mockResolvedValue({
      ...sameColumn,
      revision: 2,
      cards: [{ ...card, position: 4096 }, sameColumn.cards[1]!],
    });
    await dragCard('Buy coffee', 'To do');
    expect(cloud.mutateBoard).toHaveBeenCalledTimes(1);
    expect(titlesIn('To do')).toEqual(['Pack bags', 'Buy coffee']);
  });

  it('treats the gap between cards as an insertion point', async () => {
    const middle = { ...card, id: uuid(3), title: 'Middle', position: 2048 };
    const source = { ...sameColumn, cards: [...sameColumn.cards, middle] };
    await mount([source]);
    for (const [index, title] of ['Buy coffee', 'Middle', 'Pack bags'].entries()) {
      const tile = button(`Edit ${title}`).closest('article')!;
      vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue({
        top: 100 + index * 120,
        height: 100,
      } as DOMRect);
    }
    cloud.mutateBoard.mockResolvedValueOnce({
      ...source,
      revision: 2,
      cards: source.cards.map((item) =>
        item.id === packBags.id ? { ...item, position: 1536 } : item,
      ),
    });
    await dragCard('Pack bags', 'To do', true, 210);
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'move_card',
      id: packBags.id,
      columnId: 'todo',
      position: 1536,
    });
    expect(titlesIn('To do')).toEqual(['Buy coffee', 'Pack bags', 'Middle']);
  });

  it('reports an exhausted position without changing the board', async () => {
    const first = { ...card, position: 0 };
    const middle = { ...card, id: uuid(3), title: 'Middle', position: 0 };
    // UUID ordering puts Middle before Buy coffee when both positions are zero.
    await mount([{ ...sameColumn, cards: [first, middle, sameColumn.cards[1]!] }]);
    await dragCardToCard('Pack bags', 'Buy coffee', 'before');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    expect(titlesIn('To do')).toEqual(['Middle', 'Buy coffee', 'Pack bags']);
    expect(document.body.textContent).toContain('There is no space at this position');
  });

  it('inserts into another column before a card instead of always appending', async () => {
    await mount([populated]);
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      cards: [{ ...card, columnId: 'doing', position: 1536 }, packBags],
    });
    await dragCardToCard('Buy coffee', 'Pack bags', 'before');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'move_card',
      id: card.id,
      columnId: 'doing',
      position: 1536,
    });
    expect(titlesIn('In progress')).toEqual(['Buy coffee', 'Pack bags']);
  });

  it('uses accessible up/down buttons and disables the two ends of a column', async () => {
    await mount([sameColumn]);
    expect(button('Move Buy coffee up').disabled).toBe(true);
    expect(button('Move Pack bags down').disabled).toBe(true);
    cloud.mutateBoard.mockResolvedValueOnce({
      ...sameColumn,
      revision: 2,
      cards: [card, { ...sameColumn.cards[1]!, position: 512 }],
    });
    await click('Move Pack bags up');
    expect(titlesIn('To do')).toEqual(['Pack bags', 'Buy coffee']);
    expect(button('Move Pack bags up').disabled).toBe(true);
    expect(button('Move Buy coffee down').disabled).toBe(true);
    cloud.mutateBoard.mockResolvedValueOnce({ ...sameColumn, revision: 3 });
    await click('Move Pack bags down');
    expect(titlesIn('To do')).toEqual(['Buy coffee', 'Pack bags']);
  });

  it('keeps the original order after a failed reorder and lets the person retry', async () => {
    await mount([sameColumn]);
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Connection lost'));
    await click('Move Pack bags up');
    expect(titlesIn('To do')).toEqual(['Buy coffee', 'Pack bags']);
    expect(document.body.textContent).toContain('Connection lost');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...sameColumn,
      revision: 2,
      cards: [card, { ...sameColumn.cards[1]!, position: 512 }],
    });
    await click('Move Pack bags up');
    expect(titlesIn('To do')).toEqual(['Pack bags', 'Buy coffee']);
  });

  it('places filtered cards relative to the full column and preserves hidden cards', async () => {
    const hidden = { ...card, id: uuid(3), title: 'Hidden', position: 2048 };
    const filtered = {
      ...sameColumn,
      cards: [
        { ...card, title: 'Visible coffee' },
        hidden,
        { ...sameColumn.cards[1]!, title: 'Visible bags' },
      ],
    };
    await mount([filtered]);
    await search('Visible');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...filtered,
      revision: 2,
      cards: filtered.cards.map((item) =>
        item.id === packBags.id ? { ...item, position: 512 } : item,
      ),
    });
    await dragCardToCard('Visible bags', 'Visible coffee', 'before');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'move_card',
      id: packBags.id,
      columnId: 'todo',
      position: 512,
    });
    await search('');
    expect(titlesIn('To do')).toEqual(['Visible bags', 'Visible coffee', 'Hidden']);
  });

  it('disables reordering during a save and allows queued moves offline', async () => {
    await mount([sameColumn]);
    const saving = deferred<Board>();
    cloud.mutateBoard.mockReturnValueOnce(saving.promise);
    await click('Move Pack bags up');
    expect(button('Move Pack bags up').disabled).toBe(true);
    expect(button('Move Buy coffee down').disabled).toBe(true);
    expect(button('Edit Buy coffee').closest<HTMLElement>('article')!.draggable).toBe(false);
    await act(async () => saving.resolve({ ...sameColumn, revision: 2 }));
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await dragCardToCard('Pack bags', 'Buy coffee', 'before');
    expect(cloud.mutateBoard).toHaveBeenCalledTimes(2);
    expect(button('Edit Pack bags').closest<HTMLElement>('article')!.draggable).toBe(true);
  });

  it('moves a card to the end of another column when it is dropped there', async () => {
    await mount([populated]);
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      cards: [{ ...card, columnId: 'doing', position: 4096 }, packBags],
    });
    await dragCard('Buy coffee', 'In progress', false);
    expect(column('In progress').className).toContain('drop-active');
    await dragCard('Buy coffee', 'In progress');
    expect(cloud.mutateBoard).toHaveBeenCalledTimes(1);
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'move_card',
      id: card.id,
      columnId: 'doing',
      position: 4096,
    });
    expect(column('In progress').className).not.toContain('drop-active');
    expect(titlesIn('In progress')).toEqual(['Pack bags', 'Buy coffee']);
    expect(titlesIn('To do')).toEqual([]);
  });

  it('moves a card with its Move menu and starts an empty column at the first position', async () => {
    await mount([populated]);
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      cards: [{ ...card, columnId: 'done', position: 1024 }, packBags],
    });
    await moveWithMenu(card.id, 'done');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'move_card',
      id: card.id,
      columnId: 'done',
      position: 1024,
    });
    expect(titlesIn('Done')).toEqual(['Buy coffee']);
  });

  it('ignores a drop on the card’s own column and queues a move while offline', async () => {
    await mount([populated]);
    await dragCard('Buy coffee', 'To do');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        configurable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });
    cloud.mutateBoard.mockResolvedValueOnce({
      ...populated,
      localPending: true,
      cards: [{ ...card, columnId: 'done', position: 1024 }, packBags],
    });
    await dragCard('Buy coffee', 'Done');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'move_card',
      id: card.id,
      columnId: 'done',
      position: 1024,
    });
    expect(titlesIn('Done')).toEqual(['Buy coffee']);
    expect(document.body.textContent).toContain('Saved on this device. Waiting to sync.');
  });

  it('tells the person when a drop arrives while another change is still saving', async () => {
    await mount([populated]);
    await click('Settings');
    await fill('Board name', 'Renamed');
    const saving = deferred<Board>();
    cloud.mutateBoard.mockReturnValueOnce(saving.promise);
    await click('Save details');
    await dragCard('Buy coffee', 'In progress');
    expect(cloud.mutateBoard).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast')?.textContent).toBe(
      'Another change is still saving. Try again in a moment.',
    );
    await act(async () => {
      saving.resolve({ ...populated, title: 'Renamed', revision: 2 });
    });
    expect(titlesIn('To do')).toEqual(['Buy coffee']);
  });

  it('deletes a card only after confirmation', async () => {
    await mount([populated]);
    await click('Edit Buy coffee');
    await click('Delete');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    await click('Keep it');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    await click('Delete');
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      cards: [packBags],
    });
    await click('Confirm delete');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'delete_card',
      id: card.id,
    });
    expect(document.querySelector('dialog')).toBeNull();
    expect(titlesIn('To do')).toEqual([]);
  });

  it('removes a column and moves its cards to the first other column by default', async () => {
    await mount([populated]);
    await click('Settings for To do');
    await click('Remove');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      columns: populated.columns.slice(1),
      cards: [{ ...card, columnId: 'doing', position: 4096 }, packBags],
    });
    await click('Confirm removal');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'delete_column',
      id: 'todo',
      targetColumnId: 'doing',
    });
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelector('main section[aria-label="To do"]')).toBeNull();
    expect(titlesIn('In progress')).toEqual(['Pack bags', 'Buy coffee']);
  });

  it('moves the cards of a removed column to the column that was chosen', async () => {
    await mount([populated]);
    await click('Settings for To do');
    await click('Remove');
    await choose('Move cards to', 'done');
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      columns: populated.columns.slice(1),
    });
    await click('Confirm removal');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'delete_column',
      id: 'todo',
      targetColumnId: 'done',
    });
  });

  it('adds a column with its name and chosen color', async () => {
    await mount([populated]);
    await click('Settings');
    await click('Add column');
    await fill('New column name', 'Review');
    await choose('New column color', 'rose');
    const added = { id: 'review', title: 'Review', color: 'rose' as const };
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      columns: [...populated.columns, added],
    });
    await click('Create column');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'add_column',
      column: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: 'Review',
        color: 'rose',
      },
    });
    await click('Close');
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelector('main section[aria-label="Review"]')).not.toBeNull();
  });

  it('starts a new column blue and sends only the column fields that changed', async () => {
    await mount([populated]);
    await click('Settings');
    await click('Add column');
    expect(document.querySelector<HTMLSelectElement>('.inline-column-editor select')!.value).toBe(
      'blue',
    );
    await click('Cancel new column');
    await click('Close');
    await click('Settings for To do');
    expect(field('Column name').value).toBe('To do');
    await click('Save');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    cloud.mutateBoard.mockResolvedValue({ ...populated, revision: 2 });
    await click('Settings for To do');
    await fill('Column name', 'Backlog');
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_column',
      id: 'todo',
      patch: { title: 'Backlog' },
    });
    await click('Settings for To do');
    await click('violet');
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_column',
      id: 'todo',
      patch: { color: 'violet' },
    });
  });

  it('keeps Remove unavailable for the only column', async () => {
    await mount([{ ...board, columns: [board.columns[0]!], cards: [] }]);
    await click('Settings for To do');
    expect(document.querySelector('.delete-button')).toBeNull();
  });

  it('disables adding at the documented limits of 20 columns and 2,000 cards', async () => {
    const columns = Array.from({ length: 20 }, (_, index) => ({
      id: `column-${index}`,
      title: `Column ${index}`,
      color: 'slate' as const,
    }));
    await mount([{ ...board, columns, cards: [] }]);
    await click('Settings');
    expect(button('Add column').disabled).toBe(true);
    expect(button('Add a card', column('Column 0')).disabled).toBe(false);
  });

  it('renders a board of 2,000 cards, disables adding cards and keeps adding columns available', async () => {
    const cards = Array.from({ length: 2000 }, (_, index) => ({
      ...card,
      id: uuid(index + 10),
      title: `Card ${index}`,
      columnId: board.columns[index % 3]!.id,
      position: (index + 1) * 1024,
    }));
    await mount([{ ...board, cards }]);
    expect(document.querySelectorAll('.task-card')).toHaveLength(2000);
    expect(document.body.textContent).toContain('2000 cards');
    for (const name of ['To do', 'In progress', 'Done']) {
      expect(button('Add a card', column(name)).disabled).toBe(true);
    }
    await click('Settings');
    expect(button('Add column').disabled).toBe(false);
  });
});
