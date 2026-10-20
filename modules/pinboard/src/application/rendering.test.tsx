// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import {
  advance,
  board,
  card,
  click,
  installHarness,
  mount,
  refresh,
  search,
  uuid,
} from './testSupport';
import type { Board } from '../domain/boards/types';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

const dated = (index: number, title: string) => ({
  ...card,
  id: uuid(index),
  title,
  dueDate: '2030-01-01',
  position: index * 1024,
});
const populated: Board = {
  ...board,
  cards: [dated(1, 'One'), dated(2, 'Two'), dated(3, 'Three')],
};
const copy = (value: Board): Board => JSON.parse(JSON.stringify(value));

/** Each rendered card formats its due date once without a locale; the page shell passes one. */
function cardRenders() {
  const formatted = vi.spyOn(Date.prototype, 'toLocaleDateString');
  return () => formatted.mock.calls.filter(([locale]) => locale === undefined).length;
}

describe('Pinboard UI: rendering work', () => {
  it('keeps the tab title aligned with the open board and clears it on Home', async () => {
    await mount([populated]);
    expect(document.title).toBe('Weekend plans · Pinboard');
    cloud.loadBoardList.mockResolvedValue([{ ...populated, title: 'Renamed board', revision: 2 }]);
    await refresh();
    expect(document.title).toBe('Renamed board · Pinboard');
    await click('Open workspace');
    expect(document.title).toBe('Pinboard · a place for your projects');
  });

  it('renders no card again when a refresh brings the same boards', async () => {
    const renders = cardRenders();
    await mount([populated]);
    expect(renders()).toBe(3);
    cloud.loadBoardList.mockResolvedValue([copy(populated)]);
    await refresh();
    await advance(10_000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    expect(renders()).toBe(3);
  });

  it('renders only the card that changed when another member edits one', async () => {
    const renders = cardRenders();
    await mount([populated]);
    const edited = copy(populated);
    edited.revision = 2;
    edited.cards[1]!.title = 'Two, edited';
    cloud.loadBoardList.mockResolvedValue([edited]);
    await refresh();
    expect(document.body.textContent).toContain('Two, edited');
    expect(renders()).toBe(4);
  });

  it('renders only the cards that appear or change while the person searches', async () => {
    const renders = cardRenders();
    await mount([populated]);
    await search('o');
    expect(document.querySelectorAll('.task-card')).toHaveLength(2);
    await search('on');
    expect(document.querySelectorAll('.task-card')).toHaveLength(1);
    expect(renders()).toBe(3);
    await search('');
    expect(document.querySelectorAll('.task-card')).toHaveLength(3);
    expect(renders()).toBe(5);
  });

  it('marks a card overdue once midnight passes while the page stays open', async () => {
    vi.setSystemTime(new Date(2030, 0, 1, 23, 59, 50));
    await mount([populated]);
    expect(document.querySelector('.due.overdue')).toBeNull();
    await advance(20_000);
    expect(document.querySelectorAll('.due.overdue')).toHaveLength(3);
  });
});
