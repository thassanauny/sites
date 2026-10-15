// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import {
  board,
  button,
  card,
  click,
  field,
  fill,
  installHarness,
  mount,
  select,
  search,
  uuid,
} from './testSupport';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('Pinboard card archives', () => {
  it('keeps a failed archive draft and restores its details without losing settings edits', async () => {
    const original = { ...card, dueDate: new Date().toLocaleDateString('en-CA'), labels: ['Keep'] };
    const source = { ...board, cards: [original] };
    await mount([source]);
    await click('Edit Buy coffee');
    await fill('Description optional', 'Keep the edited details');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Archive');
    expect(field('Description optional').value).toBe('Keep the edited details');
    expect(document.querySelector('.task-card')).not.toBeNull();
    const archivedCard = { ...original, description: 'Keep the edited details', archived: true };
    const archived = { ...source, revision: 2, cards: [archivedCard] };
    cloud.mutateBoard.mockResolvedValueOnce(archived);
    await click('Archive');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { description: 'Keep the edited details', archived: true },
    });
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelector('.task-card')).toBeNull();
    expect(document.querySelector('.sidebar-visible-cards')?.textContent).toContain(
      'Showing 0 of 0 cards',
    );
    expect(
      [...document.querySelectorAll('.sidebar-overview dd')].map((item) => item.textContent),
    ).toEqual(['3', '0', '0', '0']);
    expect(document.querySelector('.board-nav-count')?.textContent).toBe('0');
    await click('Settings');
    await fill('Board name', 'Unsaved board name');
    await click('Browse archive');
    expect(document.querySelector('.archived-card-list')?.textContent).toContain('Buy coffee');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Restore Buy coffee');
    expect(button('Restore Buy coffee')).toBeDefined();
    await click('Back to settings');
    expect(field('Board name').value).toBe('Unsaved board name');
    await click('Browse archive');
    const restored = { ...archived, revision: 3, cards: [{ ...archivedCard, archived: false }] };
    cloud.mutateBoard.mockResolvedValueOnce(restored);
    await click('Restore Buy coffee');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { archived: false },
    });
    expect(document.querySelector('.archived-card-list')).toBeNull();
    await click('Back to settings');
    expect(field('Board name').value).toBe('Unsaved board name');
    expect(document.querySelector('.task-card')?.textContent).toContain('Keep the edited details');
    expect(document.querySelector('.sidebar-visible-cards')?.textContent).toContain(
      'Showing 1 of 1 card',
    );
    cloud.mutateBoard.mockResolvedValueOnce({
      ...restored,
      revision: 4,
      title: 'Unsaved board name',
    });
    await click('Save details');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_board',
      patch: { title: 'Unsaved board name' },
    });
    await click('Open workspace');
    expect(document.querySelector('.preview-info')?.textContent).toContain('1 cards');
  });

  it('searches and filters hundreds of archived cards without rendering every row', async () => {
    const cards = Array.from({ length: 245 }, (_, index) => ({
      ...card,
      id: uuid(index + 100),
      title: `Archived task ${String(index).padStart(3, '0')}`,
      columnId: index % 2 ? 'done' : 'todo',
      archived: true,
    }));
    await mount([{ ...board, cards }]);
    await click('Settings');
    expect(document.querySelector('.archived-card-list')).toBeNull();
    await click('Browse archive');
    expect(document.querySelectorAll('.archived-card-list > li')).toHaveLength(20);
    expect(document.querySelector('.archive-results-heading')?.textContent).toContain(
      '1–20 of 245',
    );
    expect(button('Previous').disabled).toBe(true);
    await click('Next');
    expect(document.querySelector('.archive-results-heading')?.textContent).toContain(
      '21–40 of 245',
    );
    expect(button('Restore Archived task 020')).toBeDefined();
    await fill('Search archived cards', 'TASK 24');
    expect(document.querySelectorAll('.archived-card-list > li')).toHaveLength(5);
    await select('Filter archived cards by column', 'done');
    expect(document.querySelectorAll('.archived-card-list > li')).toHaveLength(2);
    expect(button('Restore Archived task 241')).toBeDefined();
    await fill('Search archived cards', 'No such card');
    expect(document.querySelector('.archive-empty')?.textContent).toContain('No cards found');
    await click('Clear filters');
    expect(document.querySelectorAll('.archived-card-list > li')).toHaveLength(20);
    expect(field('Search archived cards').value).toBe('');
    expect(button('Previous').disabled).toBe(true);
  });

  it('confirms permanent deletion, preserves failed attempts and returns from an emptied last page', async () => {
    const cards = Array.from({ length: 21 }, (_, index) => ({
      ...card,
      id: uuid(index + 100),
      title: `Archived task ${String(index).padStart(3, '0')}`,
      archived: true,
    }));
    const source = { ...board, cards };
    await mount([source]);
    await click('Settings');
    await fill('Board name', 'Keep this draft');
    await click('Browse archive');
    await click('Next');
    await click('Delete Archived task 020');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    expect(document.querySelector('.archive-delete-confirm')?.textContent).toContain(
      'cannot be undone',
    );
    await click('Cancel delete');
    expect(document.querySelector('.archive-delete-confirm')).toBeNull();
    await click('Delete Archived task 020');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Permanently delete Archived task 020');
    expect(document.querySelector('.archive-delete-confirm')).not.toBeNull();
    expect(button('Restore Archived task 020')).toBeDefined();
    cloud.mutateBoard.mockResolvedValueOnce({ ...source, revision: 2, cards: cards.slice(0, 20) });
    await click('Permanently delete Archived task 020');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'delete_card',
      id: cards[20]!.id,
    });
    expect(document.querySelectorAll('.archived-card-list > li')).toHaveLength(20);
    expect(document.querySelector('.archive-results-heading')?.textContent).toContain('1–20 of 20');
    expect(document.querySelector('.archive-delete-confirm')).toBeNull();
    await click('Back to settings');
    expect(field('Board name').value).toBe('Keep this draft');
  });

  it('excludes archived cards from search, counts, due dates and reorder arrows', async () => {
    await mount([
      {
        ...board,
        cards: [
          card,
          {
            ...card,
            id: uuid(9),
            title: 'Old archived work',
            position: 2048,
            dueDate: '2020-01-01',
            archived: true,
          },
        ],
      },
    ]);
    expect(document.querySelectorAll('.task-card')).toHaveLength(1);
    expect(button('Move Buy coffee down').disabled).toBe(true);
    expect(
      [...document.querySelectorAll('.sidebar-overview dd')].map((item) => item.textContent),
    ).toEqual(['3', '1', '0', '0']);
    await search('Old archived work');
    expect(document.querySelector('.task-card')).toBeNull();
    expect(document.querySelector('.sidebar-visible-cards')?.textContent).toContain(
      'Showing 0 of 1 card',
    );
    expect(document.querySelector('.filter-summary')?.textContent).toContain(
      'Showing 0 of 1 cards',
    );
    await click('Clear filters');
    await click('Open workspace');
    expect(document.querySelector('.preview-info')?.textContent).toContain('1 cards');
    expect(document.querySelector('.home-bottom')?.textContent).toContain(
      '1 card across your boards',
    );
  });
});
