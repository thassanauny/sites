// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import {
  board,
  card,
  deferred,
  button,
  field,
  click,
  fill,
  select,
  choose,
  mount,
  refresh,
  columnTitles,
  navigateHash,
  search,
  installHarness,
} from './testSupport';
import type { Board } from '../domain/boards/types';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

/** A click on the dialog element itself: its padding when inside the box, the backdrop outside it. */
async function clickDialog(clientX: number, clientY: number) {
  const dialog = document.querySelector('dialog')!;
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 10,
    right: 410,
    bottom: 410,
  } as DOMRect);
  await act(async () => {
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
  });
}
async function pressEscape() {
  await act(async () => {
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
}
const heading = () => document.querySelector('dialog h2')?.textContent;

describe('Pinboard UI: editing boards, columns and cards', () => {
  it('deletes a column from settings, preserves cards and unsaved board details, and retains a failed deletion for retry', async () => {
    await mount([{ ...board, cards: [card, { ...card, id: 'archived', archived: true }] }]);
    await click('Settings');
    await fill('Board name', 'Keep my draft');
    await click('Delete column To do');
    await select('Move cards to', 'doing');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Connection lost'));
    await click('Delete column');
    expect(document.querySelector('dialog')?.textContent).toContain('Connection lost');
    expect(button('Delete column')).toBeDefined();
    cloud.mutateBoard.mockResolvedValueOnce({
      ...board,
      revision: 2,
      columns: board.columns.slice(1),
      cards: [
        { ...card, columnId: 'doing' },
        { ...card, id: 'archived', columnId: 'doing', archived: true },
      ],
    });
    await click('Delete column');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'delete_column',
      id: 'todo',
      targetColumnId: 'doing',
    });
    expect(field('Board name').value).toBe('Keep my draft');
    expect(columnTitles()).not.toContain('To do');
    expect(document.querySelector('.delete-confirm')).toBeNull();
  });
  it('does not offer deletion of the last column', async () => {
    await mount([{ ...board, columns: [board.columns[0]!] }]);
    await click('Settings');
    expect(button('Delete column To do').disabled).toBe(true);
  });
  it('saves column order immediately while retaining board details and disabling boundary moves', async () => {
    await mount();
    await click('Settings');
    expect(button('Move To do earlier').disabled).toBe(true);
    expect(button('Move Done later').disabled).toBe(true);
    await fill('Board name', 'My draft name');
    const pending = deferred<Board>();
    cloud.mutateBoard.mockReturnValueOnce(pending.promise);
    await click('Move In progress earlier');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'reorder_columns',
      columnIds: ['doing', 'todo', 'done'],
    });
    expect(document.querySelector('.connection')?.textContent).toBe('Saving…');
    expect(button('Move Done earlier').matches(':disabled')).toBe(true);
    const saved = {
      ...board,
      revision: 2,
      columns: [board.columns[1]!, board.columns[0]!, board.columns[2]!],
    };
    await act(async () => {
      pending.resolve(saved);
    });
    expect(field('Board name').value).toBe('My draft name');
    expect(button('Move In progress earlier').disabled).toBe(true);
    cloud.mutateBoard.mockResolvedValueOnce({
      ...saved,
      title: 'My draft name',
      revision: 3,
    });
    await click('Save details');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_board',
      patch: { title: 'My draft name' },
    });
    expect(document.querySelector('dialog')).toBeNull();
    expect(columnTitles()).toEqual(['In progress', 'To do', 'Done']);
  });

  it('keeps a failed ordering save and its details available to retry', async () => {
    await mount();
    await click('Settings');
    await fill('Description optional', 'Keep this draft');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Connection lost'));
    await click('Move Done earlier');
    expect(field('Description optional').value).toBe('Keep this draft');
    expect(columnTitles()).toEqual(['To do', 'In progress', 'Done']);
    expect(document.querySelector('dialog')?.textContent).toContain('Connection lost');
    expect(button('Move Done earlier').disabled).toBe(false);
  });

  it('filters a person named all independently of Everyone and Unassigned', async () => {
    await mount([
      {
        ...board,
        cards: [
          { ...card, assignee: 'all' },
          {
            ...card,
            id: '11111111-1111-4111-8111-111111111112',
            title: 'Unassigned task',
            assignee: '',
          },
          {
            ...card,
            id: '11111111-1111-4111-8111-111111111113',
            title: 'Alex task',
          },
        ],
      },
    ]);
    const options = [
      ...document.querySelector<HTMLSelectElement>('select[aria-label="Filter assignee"]')!.options,
    ];
    await select('Filter assignee', options.find((item) => item.text === 'all')!.value);
    expect(document.querySelectorAll('article').length).toBe(1);
    expect(document.querySelector('article h3')?.textContent).toBe('Buy coffee');
    await select('Filter assignee', options.find((item) => item.text === 'Unassigned')!.value);
    expect(document.querySelector('article h3')?.textContent).toBe('Unassigned task');
    await click('Clear filters');
    expect(document.querySelectorAll('article').length).toBe(3);
  });

  it('sends only edited card fields after another member moves the card', async () => {
    await mount([{ ...board, cards: [card] }]);
    await click('Edit Buy coffee');
    await fill('Card title', 'Buy tea');
    const moved = {
      ...board,
      revision: 2,
      cards: [{ ...card, columnId: 'done', assignee: 'Sam' }],
    };
    cloud.loadBoardList.mockResolvedValueOnce([moved]);
    await refresh();
    cloud.mutateBoard.mockResolvedValueOnce({
      ...moved,
      revision: 3,
      cards: [{ ...moved.cards[0]!, title: 'Buy tea' }],
    });
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { title: 'Buy tea' },
    });
    expect(document.querySelector('section[aria-label="Done"] h3')?.textContent).toBe('Buy tea');
  });

  it('saves a due date that is entered and then cleared again', async () => {
    await mount([{ ...board, cards: [card] }]);
    await click('Edit Buy coffee');
    await fill('Due date optional', '2030-05-17');
    const dated = {
      ...board,
      revision: 2,
      cards: [{ ...card, dueDate: '2030-05-17' }],
    };
    cloud.mutateBoard.mockResolvedValueOnce(dated);
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { dueDate: '2030-05-17' },
    });
    await click('Edit Buy coffee');
    expect(field('Due date optional').value).toBe('2030-05-17');
    await fill('Due date optional', '');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...dated,
      revision: 3,
      cards: [card],
    });
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { dueDate: '' },
    });
  });

  it('retains a new card draft and stable ID across a lost response and retry', async () => {
    await mount();
    await click('Add a card', document.querySelector('section[aria-label="To do"]')!);
    await fill('Card title', 'Buy coffee');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Save');
    const first = cloud.mutateBoard.mock.calls[0]![1];
    expect(field('Card title').value).toBe('Buy coffee');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...board,
      revision: 2,
      cards: [first.card],
    });
    await click('Save');
    expect(cloud.mutateBoard.mock.calls[1]![1]).toEqual(first);
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelectorAll('article').length).toBe(1);
  });

  it('reuses a new board ID when its creation response is lost', async () => {
    await mount([], '');
    await click('Create a board');
    await fill('Board name', 'Weekend plans');
    cloud.createBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Create board', document.querySelector('dialog')!);
    const first = cloud.createBoard.mock.calls[0]!;
    expect(field('Board name').value).toBe('Weekend plans');
    cloud.createBoard.mockResolvedValueOnce({ ...board, id: first[0] });
    await click('Create board', document.querySelector('dialog')!);
    expect(cloud.createBoard.mock.calls[1]).toEqual(first);
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Weekend plans');
  });

  it('uses current column membership when offering removal and its destination', async () => {
    const single = { ...board, columns: [board.columns[0]!] };
    await mount([single]);
    await click('Settings for To do');
    expect(
      [...document.querySelectorAll('dialog button')].some(
        (item) => item.textContent?.trim() === 'Remove',
      ),
    ).toBe(false);
    cloud.loadBoardList.mockResolvedValueOnce([{ ...board, revision: 2 }]);
    await refresh();
    await click('Remove');
    expect(button('Confirm removal').disabled).toBe(false);
    cloud.loadBoardList.mockResolvedValueOnce([{ ...single, revision: 3 }]);
    await refresh();
    expect(button('Confirm removal').disabled).toBe(true);
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    expect(field('Column name').value).toBe('To do');
  });

  it('keeps clicks inside dialog padding from closing the dialog', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Still editing');
    await clickDialog(20, 20);
    expect(field('Board name').value).toBe('Still editing');
    expect(heading()).toBe('Board settings');
  });

  describe('closing a form that has unsaved edits', () => {
    const populated = { ...board, cards: [card] };
    const forms = [
      ['Settings', 'Board name', 'Board settings'],
      ['Edit Buy coffee', 'Card title', 'Card details'],
      ['Settings for To do', 'Column name', 'Column settings'],
      ['Add a card', 'Card title', 'A new thing to do.'],
      ['Add column', 'New column name', 'Board settings'],
    ] as const;

    it.each(forms)('%s closes at once while nothing was changed', async (opener, _label, title) => {
      await mount([populated]);
      if (opener === 'Add column') await click('Settings');
      await click(opener);
      expect(heading()).toBe(title);
      await click('Close dialog');
      expect(document.querySelector('dialog')).toBeNull();
    });

    it.each(forms)('%s asks before unsaved edits are thrown away', async (opener, label, title) => {
      await mount([populated]);
      if (opener === 'Add column') await click('Settings');
      await click(opener);
      await fill(label, 'Unsaved work');
      await click('Close dialog');
      expect(heading()).toBe('Discard this draft?');
      expect(document.querySelector('dialog')?.textContent).toContain(
        'Your changes have not been saved',
      );
      expect(document.activeElement).toBe(button('Keep draft'));
      await click('Keep draft');
      expect(heading()).toBe(title);
      expect(field(label).value).toBe('Unsaved work');
      await click('Close dialog');
      await click('Discard draft');
      expect(document.querySelector('dialog')).toBeNull();
      expect(cloud.mutateBoard).not.toHaveBeenCalled();
    });

    it.each([
      ['Escape', pressEscape],
      ['a click outside the dialog', () => clickDialog(5, 20)],
      ['the Cancel button', () => click('Cancel')],
    ])('asks again when %s is used', async (_way, dismiss) => {
      await mount([populated]);
      await click('Edit Buy coffee');
      await fill('Card title', 'Buy tea');
      await dismiss();
      expect(heading()).toBe('Discard this draft?');
      await click('Keep draft');
      expect(field('Card title').value).toBe('Buy tea');
      await dismiss();
      await click('Discard draft');
      expect(document.querySelector('dialog')).toBeNull();
    });

    it('treats Escape on the question as a request to keep editing', async () => {
      await mount([populated]);
      await click('Edit Buy coffee');
      await fill('Card title', 'Buy tea');
      await pressEscape();
      expect(heading()).toBe('Discard this draft?');
      await pressEscape();
      expect(heading()).toBe('Card details');
      expect(field('Card title').value).toBe('Buy tea');
    });

    it('counts a changed colour or priority and ignores edits typed back to the original', async () => {
      await mount([populated]);
      await click('Settings for To do');
      await click('amber');
      await click('Close dialog');
      expect(heading()).toBe('Discard this draft?');
      await click('Discard draft');
      await click('Edit Buy coffee');
      await choose('Priority', 'high');
      await click('Close dialog');
      expect(heading()).toBe('Discard this draft?');
      await click('Discard draft');
      await click('Edit Buy coffee');
      await fill('Card title', 'Buy tea');
      await fill('Card title', 'Buy coffee');
      await click('Close dialog');
      expect(document.querySelector('dialog')).toBeNull();
    });

    it('asks before a half-written new board is thrown away', async () => {
      await mount([], '');
      await click('Create a board');
      await click('Cancel');
      expect(document.querySelector('dialog')).toBeNull();
      await click('Create a board');
      await fill('Board name', 'Weekend plans');
      await click('Cancel');
      expect(heading()).toBe('Discard this draft?');
      await click('Keep draft');
      expect(field('Board name').value).toBe('Weekend plans');
      await click('Cancel');
      await click('Discard draft');
      expect(document.querySelector('dialog')).toBeNull();
      expect(cloud.createBoard).not.toHaveBeenCalled();
    });

    it('closes after a successful save without asking', async () => {
      await mount([populated]);
      await click('Edit Buy coffee');
      await fill('Card title', 'Buy tea');
      cloud.mutateBoard.mockResolvedValueOnce({
        ...populated,
        revision: 2,
        cards: [{ ...card, title: 'Buy tea' }],
      });
      await click('Save');
      expect(document.querySelector('dialog')).toBeNull();
    });
  });

  it('starts the card filters over when a board is opened again or the address changes', async () => {
    const populated = { ...board, cards: [card] };
    await mount([populated]);
    const searchBox = () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Search cards"]')!;
    const visibleCount = () => document.querySelector('.sidebar-visible-cards')?.textContent;
    expect(visibleCount()).toContain('Showing 1 of 1 card');
    expect(document.querySelector('.footer-sync')?.textContent).toMatch(
      /^Synced \d{2}:\d{2} [AP]M$/,
    );
    expect(document.querySelector('.app-footer time')?.getAttribute('datetime')).not.toBe(
      board.updated_at,
    );
    await search('coffee');
    expect(searchBox().value).toBe('coffee');
    expect(visibleCount()).toContain('Showing 1 of 1 card');
    expect(document.querySelector('.filter-summary')?.textContent).toContain(
      'Showing 1 of 1 cards',
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.board-nav-item')!.click();
    });
    expect(searchBox().value).toBe('');
    expect(document.querySelector('.filter-summary')).toBeNull();
    await search('tea');
    expect(visibleCount()).toContain('Showing 0 of 1 card');
    expect(document.querySelector('.filter-summary')?.textContent).toContain(
      'Showing 0 of 1 cards',
    );
    await navigateHash(`#board/${board.invite_code}`);
    expect(searchBox().value).toBe('');
    expect(visibleCount()).toContain('Showing 1 of 1 card');
    expect(document.querySelector('.filter-summary')).toBeNull();
  });
});
