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
  field,
  fill,
  installHarness,
  mount,
  moveWithMenu,
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
const column = (title: string) => document.querySelector(`main section[aria-label="${title}"]`)!;
const titlesIn = (name: string) =>
  [...column(name).querySelectorAll('.task-card h3')].map((item) => item.textContent);

describe('Pinboard UI: cards and columns', () => {
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

  it('ignores a drop on the card’s own column and a drop while offline', async () => {
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
    await dragCard('Buy coffee', 'Done');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    expect(column('To do').querySelector<HTMLElement>('.task-card')!.draggable).toBe(false);
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
    await click('Add column');
    await fill('Column name', 'Review');
    await click('rose');
    const added = { id: 'review', title: 'Review', color: 'rose' as const };
    cloud.mutateBoard.mockResolvedValue({
      ...populated,
      revision: 2,
      columns: [...populated.columns, added],
    });
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'add_column',
      column: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: 'Review',
        color: 'rose',
      },
    });
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelector('main section[aria-label="Review"]')).not.toBeNull();
  });

  it('starts a new column blue and sends only the column fields that changed', async () => {
    await mount([populated]);
    await click('Add column');
    expect(button('blue').getAttribute('aria-pressed')).toBe('true');
    await click('Cancel');
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
    expect(button('Add column').disabled).toBe(false);
  });
});
