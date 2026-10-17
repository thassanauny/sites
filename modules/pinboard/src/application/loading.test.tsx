// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import {
  board,
  deferred,
  click,
  mount,
  refresh,
  advance,
  installHarness,
  removeInAnotherTab,
  uuid,
} from './testSupport';
import { summarizeBoard } from '../domain/boards/summary';
import type { Board } from '../domain/boards/types';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('compact collection and on-demand boards', () => {
  it('shows 200 board summaries in one list call without requesting any card documents', async () => {
    const summaries = Array.from({ length: 200 }, (_, i) => ({
      ...summarizeBoard(board),
      id: uuid(i),
      invite_code: i.toString(16).padStart(32, '0'),
      title: `Board ${i}`,
      active_card_count: i,
    }));
    await mount(summaries, '', true);
    expect(document.querySelectorAll('.board-preview')).toHaveLength(200);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(1);
    expect(cloud.loadBoard).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('199 cards');
  });

  it('coalesces StrictMode detail loads and keeps the loaded board in memory for navigation', async () => {
    const pending = deferred<Board>();
    cloud.loadBoard.mockReturnValue(pending.promise);
    await mount([summarizeBoard(board)], board.invite_code, true);
    expect(document.body.textContent).toContain('Opening your board…');
    expect(cloud.loadBoard).toHaveBeenCalledExactlyOnceWith(board.id);
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    await act(async () => pending.resolve(board));
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
    await click('Open workspace');
    await act(async () => document.querySelector<HTMLButtonElement>('.board-preview')!.click());
    expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
  });

  it('does not fetch unopened or unchanged board documents during polling', async () => {
    cloud.loadBoard.mockResolvedValue(board);
    const other = {
      ...summarizeBoard(board),
      id: uuid(9),
      invite_code: 'b'.repeat(32),
      title: 'Other',
    };
    await mount([summarizeBoard(board), other]);
    cloud.loadBoardList.mockResolvedValue([summarizeBoard(board), { ...other, revision: 2 }]);
    await refresh();
    await refresh();
    expect(cloud.loadBoard).toHaveBeenCalledExactlyOnceWith(board.id);
  });

  it('backs off failed detail requests and lets Retry bypass the wait', async () => {
    cloud.loadBoard.mockRejectedValue(new Error('Detail connection failed'));
    await mount([summarizeBoard(board)]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Detail connection failed',
    );
    await advance(5000);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
    cloud.loadBoard.mockResolvedValue(board);
    await click('Retry');
    expect(cloud.loadBoard).toHaveBeenCalledTimes(2);
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
  });

  it('dismisses a detail-load error without retrying the failed request', async () => {
    cloud.loadBoard.mockRejectedValue(new Error('Detail connection failed'));
    await mount([summarizeBoard(board)]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Detail connection failed',
    );
    await click('Dismiss error');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a board removed in another tab while its detail request is pending', async () => {
    const pending = deferred<Board>();
    cloud.loadBoard.mockReturnValue(pending.promise);
    await mount([summarizeBoard(board)]);
    await removeInAnotherTab();
    await act(async () => pending.resolve(board));
    expect(document.querySelector('.board-heading')).toBeNull();
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });
});
