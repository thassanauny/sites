// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import { summarizeBoard } from '../domain/boards/summary';
import {
  advance,
  board,
  deferred,
  button,
  field,
  click,
  fill,
  mount,
  refresh,
  status,
  syncLabel,
  navigateHash,
  unmount,
  installHarness,
} from './testSupport';
import type { Board } from '../domain/boards/types';
import { SESSION_CORRUPT_MESSAGE } from '../infrastructure/auth/migrateSession';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('Pinboard UI: synchronization and connectivity', () => {
  it.each([false, true])(
    'retries clean selected details despite another pending board (rejected: %s)',
    async (rejected) => {
      let health!: (healthy: boolean) => void;
      cloud.subscribeBoardChanges.mockImplementation((_listener, reportHealth) => {
        health = reportHealth!;
        return () => health(false);
      });
      const pending = {
        ...summarizeBoard(board),
        id: '33333333-3333-4333-8333-333333333333',
        invite_code: 'b'.repeat(32),
        title: 'Other pending board',
        localPending: true,
        ...(rejected ? { localError: 'That card was removed. Pending work is kept.' } : {}),
      };
      cloud.loadBoard.mockRejectedValueOnce(new Error('Selected detail connection failed'));
      await mount([board, pending]);
      await act(async () => health(true));
      await advance(9999);
      expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(cloud.loadBoard).toHaveBeenCalledTimes(2);
      expect(cloud.loadBoard.mock.calls.every(([id]) => id === board.id)).toBe(true);
      expect(document.querySelector('h1')?.textContent).toBe(board.title);
      expect(document.querySelector('.pinboard-columns')).not.toBeNull();
      if (rejected)
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(pending.localError);
      const reads = cloud.loadBoardList.mock.calls.length;
      await advance(59_999);
      expect(cloud.loadBoardList).toHaveBeenCalledTimes(reads);
      await advance(1);
      expect(cloud.loadBoardList).toHaveBeenCalledTimes(reads + 1);
      expect(cloud.loadBoard).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps Home on failed-read backoff when a healthy live channel receives success-shaped cached summaries', async () => {
    let health!: (healthy: boolean) => void;
    cloud.subscribeBoardChanges.mockImplementation((_listener, reportHealth) => {
      health = reportHealth!;
      return () => health(false);
    });
    await mount([board], '');
    await act(async () => health(true));
    cloud.loadBoardList.mockResolvedValue([
      {
        ...summarizeBoard(board),
        localCached: true,
        localError: 'Data API unavailable; saved boards are kept',
      },
    ]);
    await refresh();
    expect(document.querySelector('.board-preview')?.textContent).toContain(board.title);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Data API unavailable');
    await advance(9999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(3);
    await advance(19_999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(3);
    cloud.loadBoardList.mockResolvedValue([board]);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await advance(59_999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(5);
    expect(cloud.loadBoard).not.toHaveBeenCalled();
  });

  it('retries failed selected details at the existing backoff while live transport and summaries stay healthy', async () => {
    let health!: (healthy: boolean) => void;
    cloud.subscribeBoardChanges.mockImplementation((_listener, reportHealth) => {
      health = reportHealth!;
      return () => health(false);
    });
    cloud.loadBoard.mockRejectedValueOnce(new Error('Detail connection failed'));
    await mount();
    await act(async () => health(true));
    const pending = deferred<Board>();
    cloud.loadBoard.mockReturnValueOnce(pending.promise);
    await advance(9999);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(board));
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
    expect(document.body.textContent).not.toContain('Detail connection failed');
    await advance(59_999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(5);
  });

  it('keeps a stale cached detail readable without losing fast retry or its backoff', async () => {
    let health!: (healthy: boolean) => void;
    cloud.subscribeBoardChanges.mockImplementation((_listener, reportHealth) => {
      health = reportHealth!;
      return () => health(false);
    });
    const latest = { ...board, title: 'Latest board', revision: 2 };
    cloud.loadBoard.mockResolvedValueOnce({
      ...board,
      localCached: true,
      localError: 'Detail service unavailable',
    });
    cloud.loadBoard.mockResolvedValueOnce(latest);
    await mount([latest]);
    await act(async () => health(true));
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
    await advance(9999);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(2);
    expect(document.querySelector('h1')?.textContent).toBe(latest.title);
    const reads = cloud.loadBoardList.mock.calls.length;
    await advance(59_999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(reads);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(reads + 1);
  });

  it('returns to minute reconciliation when navigating away from failed selected details', async () => {
    let health!: (healthy: boolean) => void;
    cloud.subscribeBoardChanges.mockImplementation((_listener, reportHealth) => {
      health = reportHealth!;
      return () => health(false);
    });
    cloud.loadBoard.mockRejectedValueOnce(new Error('Detail connection failed'));
    await mount();
    await act(async () => health(true));
    await navigateHash('');
    await advance(59_999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(1);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
    expect(cloud.loadBoard).toHaveBeenCalledTimes(1);
  });

  it('keeps failed-read backoff while the live channel remains subscribed', async () => {
    let health!: (healthy: boolean) => void;
    cloud.subscribeBoardChanges.mockImplementation((_listener, reportHealth) => {
      health = reportHealth!;
      return () => health(false);
    });
    await mount();
    await act(async () => health(true));
    cloud.loadBoardList.mockRejectedValueOnce(new Error('Connection lost'));
    await refresh();
    await advance(9999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(3);
    await advance(59_999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
  });

  it('reconciles every minute while subscribed, keeps live catch-up and restores fast polls during an active read', async () => {
    let health!: (healthy: boolean) => void;
    let wake!: () => void;
    cloud.subscribeBoardChanges.mockImplementation((listener, reportHealth) => {
      wake = listener;
      health = reportHealth!;
      return () => health(false);
    });
    await mount();
    await act(async () => health(true));
    await advance(59_999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
    await act(async () => wake());
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(3);
    const pending = deferred<Board[]>();
    cloud.loadBoardList.mockReturnValueOnce(pending.promise);
    await act(async () => wake());
    await act(async () => health(false));
    await advance(5000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    await act(async () => pending.resolve([board]));
    await advance(4999);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    await advance(1);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(5);
    await unmount();
    await advance(60_000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(5);
  });

  it('keeps an open draft after access disappears and prompts Join only after the editor closes', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Retain this unsaved board draft');
    cloud.loadBoardList.mockResolvedValue([]);
    await refresh();
    expect(field('Board name').value).toBe('Retain this unsaved board draft');
    expect(document.querySelector('dialog h2')?.textContent).not.toBe('Join a board.');
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    cloud.mutateBoard.mockRejectedValueOnce(new Error('You no longer have access to this board.'));
    await click('Save details');
    expect(field('Board name').value).toBe('Retain this unsaved board draft');
    expect(document.querySelector('dialog')?.textContent).toContain('no longer have access');
    await click('Close dialog');
    await click('Discard draft');
    expect(document.querySelector('dialog h2')?.textContent).toBe('Join a board.');
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });
  it('refreshes after live invalidation, catches an event during a read and stops listening while hidden', async () => {
    const stop = vi.fn();
    let wake!: () => void;
    cloud.subscribeBoardChanges.mockImplementation((listener: () => void) => {
      wake = listener;
      return stop;
    });
    await mount();
    const pending = deferred<Board[]>();
    cloud.loadBoardList.mockReturnValueOnce(pending.promise);
    await act(async () => wake());
    const reads = cloud.loadBoardList.mock.calls.length;
    await act(async () => wake());
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(reads);
    await act(async () => pending.resolve([board]));
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(reads + 1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(stop).toHaveBeenCalled();
    const listeners = cloud.subscribeBoardChanges.mock.calls.length;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(cloud.subscribeBoardChanges).toHaveBeenCalledTimes(listeners + 1);
    await unmount();
    expect(stop.mock.calls.length).toBeGreaterThan(1);
  });
  it('waits for the initial list in StrictMode before trying an existing invitation', async () => {
    const pending = deferred<Board[]>();
    cloud.loadBoardList.mockReturnValueOnce(pending.promise);
    await mount([board], board.invite_code, true);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(1);
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Finding your boards…');
    await act(async () => {
      pending.resolve([board]);
    });
    expect(document.querySelector('h1')?.textContent).toBe('Weekend plans');
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });

  it('keeps newer saved revisions when an older refresh arrives afterwards', async () => {
    await mount();
    const pending = deferred<Board[]>();
    cloud.loadBoardList.mockReturnValueOnce(pending.promise);
    await refresh();
    await click('Settings');
    await fill('Board name', 'Newer saved title');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...board,
      title: 'Newer saved title',
      revision: 2,
    });
    await click('Save details');
    await act(async () => {
      pending.resolve([board]);
    });
    expect(document.querySelector('h1')?.textContent).toBe('Newer saved title');
  });

  it('updates live column order without replacing an unsaved details draft', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Still editing');
    cloud.loadBoardList.mockResolvedValueOnce([
      { ...board, revision: 2, columns: [...board.columns].reverse() },
    ]);
    await refresh();
    expect(field('Board name').value).toBe('Still editing');
    expect(button('Move Done earlier').disabled).toBe(true);
    expect(button('Move To do later').disabled).toBe(true);
  });

  it('drops boards absent from a complete refresh, retaining the list on failure', async () => {
    await mount([board], '');
    cloud.loadBoardList.mockRejectedValueOnce(new Error('Connection lost'));
    await refresh();
    expect(document.querySelector('.board-preview')?.textContent).toContain('Weekend plans');
    cloud.loadBoardList.mockResolvedValueOnce([]);
    await refresh();
    expect(document.querySelector('.board-preview')).toBeNull();
  });

  it('retains a board created while an older empty list is in flight', async () => {
    await mount([], '');
    const pending = deferred<Board[]>();
    cloud.loadBoardList.mockReturnValueOnce(pending.promise);
    await refresh();
    await click('Create a board');
    await fill('Board name', 'Weekend plans');
    cloud.createBoard.mockResolvedValueOnce(board);
    await click('Create board', document.querySelector('dialog')!);
    await act(async () => {
      pending.resolve([]);
    });
    expect(document.querySelector('h1')?.textContent).toBe('Weekend plans');
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });

  it('keeps offline editing available and preserves the draft until saved', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Keep this title');
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(button('Save details').disabled).toBe(false);
    expect(field('Board name').value).toBe('Keep this title');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    cloud.mutateBoard.mockResolvedValueOnce({
      ...board,
      revision: 2,
      title: 'Keep this title',
    });
    await click('Save details');
    expect(document.querySelector('h1')?.textContent).toBe('Keep this title');
  });

  it('does not attempt invitation access when sharing has no configuration', async () => {
    cloud.configured = false;
    await mount([], board.invite_code);
    expect(cloud.loadBoardList).not.toHaveBeenCalled();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    expect(document.querySelector('.connection')?.textContent).toBe('Setup required');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('reports connection and sync status while loading, saving, failing and offline', async () => {
    const pending = deferred<Board[]>();
    cloud.loadBoardList.mockReturnValueOnce(pending.promise);
    await mount();
    expect(status()).toBe('Syncing');
    expect(document.querySelector('.sidebar')).toBeNull();
    await act(async () => {
      pending.resolve([board]);
    });
    expect(status()).toBe('Connected');
    expect(syncLabel()).toMatch(/^Synced \d{1,2}:\d{2}/);
    expect(document.querySelector('.sidebar-footer time')?.getAttribute('datetime')).toBe(
      board.updated_at,
    );

    await click('Settings');
    await fill('Board name', 'Renamed');
    const saving = deferred<Board>();
    cloud.mutateBoard.mockReturnValueOnce(saving.promise);
    await click('Save details');
    expect(status()).toBe('Saving…');
    await act(async () => {
      saving.resolve({ ...board, title: 'Renamed', revision: 2 });
    });
    expect(status()).toBe('Connected');

    cloud.loadBoardList.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(status()).toBe('Sync unavailable');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not connect to shared boards.',
    );

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        configurable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });
    expect(status()).toBe('Offline');
    expect(document.body.textContent).toContain('You’re offline.');
  });

  it('offers Start a new session only for a damaged stored session, backs it up, then reconnects', async () => {
    await mount();
    expect(document.body.textContent).not.toContain('Start a new session');
    cloud.loadBoardList.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(document.body.textContent).not.toContain('Start a new session');
    cloud.loadBoardList.mockRejectedValueOnce(new Error(SESSION_CORRUPT_MESSAGE));
    await refresh();
    expect(document.querySelector('.banner.error')?.textContent).toContain('Start a new session');
    cloud.startNewSession.mockResolvedValueOnce(undefined);
    cloud.loadBoardList.mockResolvedValue([board]);
    await click('Start a new session');
    expect(cloud.startNewSession).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.banner.error')).toBeNull();
  });

  it('keeps the error and shows why when starting a new session fails', async () => {
    await mount();
    cloud.loadBoardList.mockRejectedValueOnce(new Error(SESSION_CORRUPT_MESSAGE));
    await refresh();
    cloud.startNewSession.mockRejectedValueOnce(
      new Error('Could not start a new session. Check browser storage and reload.'),
    );
    await click('Start a new session');
    expect(document.querySelector('.banner.error')?.textContent).toContain(
      'Could not start a new session',
    );
    expect(document.body.textContent).not.toContain('Start a new session');
  });

  it('retries from the error banner with a full refresh and lets the person dismiss the error', async () => {
    await mount();
    cloud.loadBoardList.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(document.querySelector('.banner.error')?.textContent).toContain(
      'Could not connect to shared boards.',
    );
    await click('Retry');
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(3);
    expect(document.querySelector('.banner.error')).toBeNull();
    expect(document.querySelector('.toast')?.textContent).toBe('Boards are up to date');
    cloud.loadBoardList.mockRejectedValueOnce(new Error('Could not connect again.'));
    await refresh();
    expect(document.querySelector('.banner.error')?.textContent).toContain(
      'Could not connect again.',
    );
    await click('Dismiss error');
    expect(document.querySelector('.banner.error')).toBeNull();
  });

  it('refreshes on demand from the board toolbar', async () => {
    await mount();
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(1);
    await click('Refresh boards');
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.toast')?.textContent).toBe('Boards are up to date');
  });

  it('clears a sync error when a later automatic refresh succeeds', async () => {
    await mount();
    cloud.loadBoardList.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(status()).toBe('Sync unavailable');
    expect(document.querySelector('.banner.error')).not.toBeNull();
    await refresh();
    expect(document.querySelector('.banner.error')).toBeNull();
    expect(status()).toBe('Connected');
    expect(syncLabel()).toMatch(/^Synced \d{1,2}:\d{2}/);
  });

  it('keeps the message of a failed save when a background refresh succeeds', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Renamed');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Could not save your changes. Try again.'));
    await click('Save details');
    expect(document.querySelector('.banner.error')?.textContent).toContain(
      'Could not save your changes.',
    );
    await refresh();
    await advance(5000);
    expect(document.querySelector('.banner.error')?.textContent).toContain(
      'Could not save your changes.',
    );
    await click('Dismiss error');
    expect(document.querySelector('.banner.error')).toBeNull();
  });

  it('uses held summaries for both background and manual refreshes', async () => {
    await mount();
    expect(cloud.loadBoardList).toHaveBeenNthCalledWith(1, []);
    await advance(5000);
    expect(cloud.loadBoardList).toHaveBeenNthCalledWith(2, [summarizeBoard(board)]);
    await click('Refresh boards');
    expect(cloud.loadBoardList).toHaveBeenNthCalledWith(3, [summarizeBoard(board)]);
    await refresh();
    expect(cloud.loadBoardList).toHaveBeenNthCalledWith(4, [summarizeBoard(board)]);
  });

  it('polls every five seconds only while the page is visible', async () => {
    await mount();
    Object.defineProperty(document, 'hidden', {
      value: true,
      configurable: true,
    });
    await advance(20_000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
    await advance(5000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
  });

  it('waits longer between background refreshes after failures, up to a minute, and recovers after one succeeds', async () => {
    await mount();
    const calls = () => cloud.loadBoardList.mock.calls.length;
    cloud.loadBoardList.mockRejectedValue(new Error('Could not connect to shared boards.'));
    await advance(5000);
    expect(calls()).toBe(2);
    await advance(5000);
    expect(calls()).toBe(2);
    await advance(5000);
    expect(calls()).toBe(3);
    await advance(15_000);
    expect(calls()).toBe(3);
    await advance(5000);
    expect(calls()).toBe(4);
    await advance(35_000);
    expect(calls()).toBe(4);
    await advance(5000);
    expect(calls()).toBe(5);
    await advance(55_000);
    expect(calls()).toBe(5);
    cloud.loadBoardList.mockResolvedValue([board]);
    await advance(5000);
    expect(calls()).toBe(6);
    expect(document.querySelector('.banner.error')).toBeNull();
    await advance(5000);
    expect(calls()).toBe(7);
  });

  it('refreshes at once on focus or reconnecting even while polling is backing off', async () => {
    await mount();
    cloud.loadBoardList.mockRejectedValue(new Error('Could not connect to shared boards.'));
    await advance(5000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
    await refresh();
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(3);
    cloud.loadBoardList.mockResolvedValue([board]);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(4);
    await advance(5000);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(5);
  });

  it('stops polling and focus refreshes after unmounting', async () => {
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
    await unmount();
    await refresh();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(2);
  });
});
