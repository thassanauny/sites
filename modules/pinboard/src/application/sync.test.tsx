// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
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
  unmount,
  installHarness,
} from './testSupport';
import type { Board } from '../domain/boards/types';
import { SESSION_CORRUPT_MESSAGE } from '../infrastructure/auth/migrateSession';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('Pinboard UI: synchronization and connectivity', () => {
  it('waits for the initial list in StrictMode before trying an existing invitation', async () => {
    const pending = deferred<Board[]>();
    cloud.loadBoards.mockReturnValueOnce(pending.promise);
    await mount([board], board.invite_code, true);
    expect(cloud.loadBoards).toHaveBeenCalledTimes(1);
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
    cloud.loadBoards.mockReturnValueOnce(pending.promise);
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
    cloud.loadBoards.mockResolvedValueOnce([
      { ...board, revision: 2, columns: [...board.columns].reverse() },
    ]);
    await refresh();
    expect(field('Board name').value).toBe('Still editing');
    expect(button('Move Done earlier').disabled).toBe(true);
    expect(button('Move To do later').disabled).toBe(true);
  });

  it('drops boards absent from a complete refresh, retaining the list on failure', async () => {
    await mount([board], '');
    cloud.loadBoards.mockRejectedValueOnce(new Error('Connection lost'));
    await refresh();
    expect(document.querySelector('.board-preview')?.textContent).toContain('Weekend plans');
    cloud.loadBoards.mockResolvedValueOnce([]);
    await refresh();
    expect(document.querySelector('.board-preview')).toBeNull();
  });

  it('retains a board created while an older empty list is in flight', async () => {
    await mount([], '');
    const pending = deferred<Board[]>();
    cloud.loadBoards.mockReturnValueOnce(pending.promise);
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

  it('keeps an offline editor draft and allows saving after reconnecting', async () => {
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
    expect(button('Save details').disabled).toBe(true);
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
    expect(cloud.loadBoards).not.toHaveBeenCalled();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    expect(document.querySelector('.connection')?.textContent).toBe('Setup needed');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('reports connection and sync status while loading, saving, failing and offline', async () => {
    const pending = deferred<Board[]>();
    cloud.loadBoards.mockReturnValueOnce(pending.promise);
    await mount();
    expect(status()).toBe('Syncing');
    expect(syncLabel()).toBe('Connecting…');
    await act(async () => {
      pending.resolve([board]);
    });
    expect(status()).toBe('All changes saved');
    expect(syncLabel()).toMatch(/^Synced \d{1,2}:\d{2}/);

    await click('Settings');
    await fill('Board name', 'Renamed');
    const saving = deferred<Board>();
    cloud.mutateBoard.mockReturnValueOnce(saving.promise);
    await click('Save details');
    expect(status()).toBe('Saving…');
    await act(async () => {
      saving.resolve({ ...board, title: 'Renamed', revision: 2 });
    });
    expect(status()).toBe('All changes saved');

    cloud.loadBoards.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(status()).toBe('Sync unavailable');
    expect(syncLabel()).toBe('Sync paused');
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
    expect(syncLabel()).toBe('Sync paused');
    expect(document.body.textContent).toContain('You’re offline.');
  });

  it('offers Start a new session only for a damaged stored session, backs it up, then reconnects', async () => {
    await mount();
    expect(document.body.textContent).not.toContain('Start a new session');
    cloud.loadBoards.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(document.body.textContent).not.toContain('Start a new session');
    cloud.loadBoards.mockRejectedValueOnce(new Error(SESSION_CORRUPT_MESSAGE));
    await refresh();
    expect(document.querySelector('.banner.error')?.textContent).toContain('Start a new session');
    cloud.startNewSession.mockResolvedValueOnce(undefined);
    cloud.loadBoards.mockResolvedValue([board]);
    await click('Start a new session');
    expect(cloud.startNewSession).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.banner.error')).toBeNull();
  });

  it('keeps the error and shows why when starting a new session fails', async () => {
    await mount();
    cloud.loadBoards.mockRejectedValueOnce(new Error(SESSION_CORRUPT_MESSAGE));
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
    cloud.loadBoards.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(document.querySelector('.banner.error')?.textContent).toContain(
      'Could not connect to shared boards.',
    );
    await click('Retry');
    expect(cloud.loadBoards).toHaveBeenCalledTimes(3);
    expect(document.querySelector('.banner.error')).toBeNull();
    expect(document.querySelector('.toast')?.textContent).toBe('Boards are up to date');
    cloud.loadBoards.mockRejectedValueOnce(new Error('Could not connect again.'));
    await refresh();
    expect(document.querySelector('.banner.error')?.textContent).toContain(
      'Could not connect again.',
    );
    await click('Dismiss error');
    expect(document.querySelector('.banner.error')).toBeNull();
  });

  it('refreshes on demand from the board toolbar', async () => {
    await mount();
    expect(cloud.loadBoards).toHaveBeenCalledTimes(1);
    await click('Refresh boards');
    expect(cloud.loadBoards).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.toast')?.textContent).toBe('Boards are up to date');
  });

  it('clears a sync error when a later automatic refresh succeeds', async () => {
    await mount();
    cloud.loadBoards.mockRejectedValueOnce(new Error('Could not connect to shared boards.'));
    await refresh();
    expect(status()).toBe('Sync unavailable');
    expect(syncLabel()).toBe('Sync paused');
    expect(document.querySelector('.banner.error')).not.toBeNull();
    await refresh();
    expect(document.querySelector('.banner.error')).toBeNull();
    expect(status()).toBe('All changes saved');
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

  it('polls with the boards it already holds and downloads everything for a person’s refresh', async () => {
    await mount();
    expect(cloud.loadBoards).toHaveBeenNthCalledWith(1, []);
    await advance(5000);
    expect(cloud.loadBoards).toHaveBeenNthCalledWith(2, [board]);
    await click('Refresh boards');
    expect(cloud.loadBoards).toHaveBeenNthCalledWith(3, undefined);
    await refresh();
    expect(cloud.loadBoards).toHaveBeenNthCalledWith(4, [board]);
  });

  it('polls every five seconds only while the page is visible', async () => {
    await mount();
    Object.defineProperty(document, 'hidden', {
      value: true,
      configurable: true,
    });
    await advance(20_000);
    expect(cloud.loadBoards).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
    await advance(5000);
    expect(cloud.loadBoards).toHaveBeenCalledTimes(2);
  });

  it('waits longer between background refreshes after failures, up to a minute, and recovers after one succeeds', async () => {
    await mount();
    const calls = () => cloud.loadBoards.mock.calls.length;
    cloud.loadBoards.mockRejectedValue(new Error('Could not connect to shared boards.'));
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
    cloud.loadBoards.mockResolvedValue([board]);
    await advance(5000);
    expect(calls()).toBe(6);
    expect(document.querySelector('.banner.error')).toBeNull();
    await advance(5000);
    expect(calls()).toBe(7);
  });

  it('refreshes at once on focus or reconnecting even while polling is backing off', async () => {
    await mount();
    cloud.loadBoards.mockRejectedValue(new Error('Could not connect to shared boards.'));
    await advance(5000);
    expect(cloud.loadBoards).toHaveBeenCalledTimes(2);
    await refresh();
    expect(cloud.loadBoards).toHaveBeenCalledTimes(3);
    cloud.loadBoards.mockResolvedValue([board]);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(cloud.loadBoards).toHaveBeenCalledTimes(4);
    await advance(5000);
    expect(cloud.loadBoards).toHaveBeenCalledTimes(5);
  });

  it('stops polling and focus refreshes after unmounting', async () => {
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(cloud.loadBoards).toHaveBeenCalledTimes(2);
    await unmount();
    await refresh();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(cloud.loadBoards).toHaveBeenCalledTimes(2);
  });
});
