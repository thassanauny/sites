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
  mount,
  refresh,
  removeInAnotherTab,
  unmount,
  installHarness,
} from './testSupport';
import { DeviceBoards, DEVICE_BOARDS_PREFIX } from '../infrastructure/storage/deviceBoards';
import type { Board } from '../domain/boards/types';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('Pinboard UI: removing a board from this device', () => {
  it('keeps removal and a retryable error when restoring its device preference fails', async () => {
    const device = new DeviceBoards();
    device.remove(board.invite_code);
    await mount();
    cloud.joinBoard.mockResolvedValue(board);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('SecurityError');
    });
    await click('Join board');
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(document.querySelector('dialog')?.textContent).toContain('Could not restore the board');
    expect(device.removal(board.invite_code)).not.toBeNull();
    await click('Join board');
    expect(device.removal(board.invite_code)).toBeNull();
    expect(document.querySelector('.board-preview')).not.toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('confirms local removal, preserves cancelled details, and stays hidden after polling and reload', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Keep this draft');
    await click('Remove from this device');
    expect(field('Invitation code').value).toBe(board.invite_code);
    expect(document.body.textContent).toContain('Everyone else keeps access');
    await click('Keep on this device');
    expect(field('Board name').value).toBe('Keep this draft');
    await click('Remove from this device');
    await click('Remove from this device');
    expect(window.location.hash).toBe('');
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    await refresh();
    expect(document.querySelector('.board-preview')).toBeNull();
    await unmount();
    await mount([board], '');
    expect(document.querySelector('.board-preview')).toBeNull();
  });

  it('allows opening settings and removing locally while offline', async () => {
    await mount();
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(button('Settings').disabled).toBe(false);
    await click('Settings');
    expect(button('Save details').disabled).toBe(false);
    await click('Remove from this device');
    expect(button('Remove from this device').disabled).toBe(false);
    await click('Remove from this device');
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
  });

  it('keeps the board and confirmation when its local removal cannot be saved', async () => {
    await mount();
    await click('Settings');
    await click('Remove from this device');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    await click('Remove from this device');
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
    expect(document.querySelector('dialog')?.textContent).toContain('Could not remove the board');
    expect(window.location.hash).toBe(`#board/${board.invite_code}`);
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
  });

  it('restores a removed board to Home only after Join succeeds', async () => {
    const device = new DeviceBoards();
    device.remove(board.invite_code);
    device.remove('b'.repeat(32));
    await mount();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    expect(device.removal(board.invite_code)).not.toBeNull();
    cloud.joinBoard.mockResolvedValueOnce(board);
    await click('Join board');
    expect(device.removal(board.invite_code)).toBeNull();
    expect(device.removal('b'.repeat(32))).not.toBeNull();
    expect(document.querySelector('.board-preview')).not.toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('does not restore a removed board from a refresh that was already in flight', async () => {
    await mount();
    const pending = deferred<Board[]>();
    cloud.loadBoardList.mockReturnValueOnce(pending.promise);
    await refresh();
    await click('Settings');
    await click('Remove from this device');
    await click('Remove from this device');
    await act(async () => {
      pending.resolve([{ ...board, revision: 5 }]);
    });
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });

  it('keeps another tab’s removal after a pending save completes', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Accepted later');
    const pending = deferred<Board>();
    cloud.mutateBoard.mockReturnValueOnce(pending.promise);
    await click('Save details');
    await act(async () => {
      new DeviceBoards().remove(board.invite_code);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEVICE_BOARDS_PREFIX + board.invite_code,
          storageArea: window.localStorage,
        }),
      );
      pending.resolve({ ...board, title: 'Accepted later', revision: 2 });
    });
    expect(field('Board name').value).toBe('Accepted later');
    expect(document.querySelector('[aria-label="Draft recovery"]')).not.toBeNull();
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(window.location.hash).toBe('');
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });

  it.each([
    ['Settings', 'Board name', 'Save details'],
    ['Edit Buy coffee', 'Card title', 'Save'],
    ['Settings for To do', 'Column name', 'Save'],
    ['Add a card', 'Card title', 'Save'],
    ['Add column', 'New column name', 'Create column'],
  ])(
    'preserves and recovers the %s draft after cross-tab removal',
    async (opener, label, saveButton) => {
      const populated = { ...board, cards: [card] };
      await mount([populated]);
      if (opener === 'Add column') await click('Settings');
      await click(opener);
      await fill(label, 'Unsaved work');
      await removeInAnotherTab();
      expect(field(label).value).toBe('Unsaved work');
      expect(button(saveButton).disabled).toBe(true);
      expect(document.querySelector('.board-preview')).toBeNull();
      expect(cloud.joinBoard).not.toHaveBeenCalled();
      const storedValues = Array.from({ length: window.localStorage.length }, (_, index) =>
        window.localStorage.getItem(window.localStorage.key(index)!),
      );
      expect(storedValues.join('')).toContain('Unsaved work');
      cloud.joinBoard.mockResolvedValueOnce({ ...populated, revision: 2 });
      await click('Join again and keep draft');
      expect(cloud.joinBoard).toHaveBeenCalledWith(board.invite_code);
      expect(new DeviceBoards().removal(board.invite_code)).toBeNull();
      expect(field(label).value).toBe('Unsaved work');
      expect(button(saveButton).disabled).toBe(false);
      expect(window.location.hash).toBe(`#board/${board.invite_code}`);
    },
  );

  it('keeps a removed draft available offline, copies it and confirms explicit discard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await mount();
    await click('Settings');
    await fill('Board name', 'Recovery title');
    await fill('Description optional', 'Recovery details');
    await removeInAnotherTab();
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        configurable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });
    expect(button('Join again and keep draft').disabled).toBe(true);
    await click('Copy draft');
    expect(writeText).toHaveBeenCalledWith('Recovery title\nRecovery details');
    expect(
      document.querySelector<HTMLTextAreaElement>('[aria-label="Draft for recovery"]')?.value,
    ).toBe('Recovery title\nRecovery details');
    await click('Close dialog');
    expect(document.querySelector('dialog h2')?.textContent).toBe('Discard this draft?');
    expect(document.activeElement).toBe(button('Keep draft'));
    await click('Keep draft');
    expect(document.activeElement).toBe(field('Board name'));
    expect(field('Board name').value).toBe('Recovery title');
    await click('Discard draft');
    await click('Discard draft');
    expect(document.querySelector('dialog')).toBeNull();
    expect(new DeviceBoards().removal(board.invite_code)).not.toBeNull();
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
  });

  it('keeps a recovery draft hidden if restoring the device preference fails', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Keep on storage failure');
    await removeInAnotherTab();
    cloud.joinBoard.mockResolvedValueOnce(board);
    const restore = vi.spyOn(DeviceBoards.prototype, 'restore').mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    await click('Join again and keep draft');
    expect(restore).toHaveBeenCalled();
    expect(field('Board name').value).toBe('Keep on storage failure');
    expect(button('Save details').disabled).toBe(true);
    expect(new DeviceBoards().removal(board.invite_code)).not.toBeNull();
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(window.location.hash).toBe('');
    restore.mockRestore();
  });

  it('retains a recovery draft if joining fails or a newer removal arrives during recovery', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Keep through retries');
    await removeInAnotherTab();
    await click('Join again and keep draft');
    expect(field('Board name').value).toBe('Keep through retries');
    expect(new DeviceBoards().removal(board.invite_code)).not.toBeNull();
    const pending = deferred<Board>();
    cloud.joinBoard.mockReturnValueOnce(pending.promise);
    await click('Join again and keep draft');
    expect(button('Discard draft').disabled).toBe(true);
    expect(button('Close dialog').disabled).toBe(true);
    await act(async () => {
      new DeviceBoards().remove(board.invite_code);
      pending.resolve(board);
    });
    expect(field('Board name').value).toBe('Keep through retries');
    expect(new DeviceBoards().removal(board.invite_code)).not.toBeNull();
    expect(button('Save details').disabled).toBe(true);
  });

  it('keeps a newer removal when an older link-confirmed join completes', async () => {
    const pending = deferred<Board>();
    cloud.joinBoard.mockReturnValueOnce(pending.promise);
    await mount([], board.invite_code);
    await click('Join board');
    expect(cloud.joinBoard).toHaveBeenCalledExactlyOnceWith(board.invite_code);
    await act(async () => {
      new DeviceBoards().remove(board.invite_code);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEVICE_BOARDS_PREFIX + board.invite_code,
        }),
      );
      pending.resolve(board);
    });
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('keeps a newer removal when an older explicit join completes', async () => {
    await mount([], '');
    await click('Join a board');
    await fill('Invitation code or link', board.invite_code);
    const pending = deferred<Board>();
    cloud.joinBoard.mockReturnValueOnce(pending.promise);
    await click('Join board');
    await act(async () => {
      new DeviceBoards().remove(board.invite_code);
      pending.resolve(board);
    });
    expect(document.querySelector('.board-preview')).toBeNull();
    expect(document.querySelector('dialog')?.textContent).toContain(
      'removed from this device while joining',
    );
    expect(new DeviceBoards().removal(board.invite_code)).not.toBeNull();
  });

  it('updates another tab after a matching restoration acknowledgement', async () => {
    const device = new DeviceBoards();
    device.remove(board.invite_code);
    const marker = device.removal(board.invite_code);
    await mount([board], '');
    expect(document.querySelector('.board-preview')).toBeNull();
    await act(async () => {
      device.restore(board.invite_code, marker);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `${DEVICE_BOARDS_PREFIX}${board.invite_code}:restored:${marker}`,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(document.querySelector('.board-preview')).not.toBeNull();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });

  it('does not autojoin when removal preferences cannot be read and recovers on focus', async () => {
    new DeviceBoards().remove(board.invite_code);
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    await mount();
    expect(cloud.loadBoardList).not.toHaveBeenCalled();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Could not read boards');
    read.mockRestore();
    cloud.joinBoard.mockResolvedValueOnce(board);
    await refresh();
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    expect(new DeviceBoards().removal(board.invite_code)).not.toBeNull();
    expect(field('Invitation code or link').value).toBe(board.invite_code);
  });

  it('ignores unrelated and session-storage events and stops listening after unmount', async () => {
    const reads = vi.spyOn(DeviceBoards.prototype, 'removedCodes');
    await mount();
    const before = reads.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'iou-store' }));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEVICE_BOARDS_PREFIX + board.invite_code,
          storageArea: window.sessionStorage,
        }),
      );
    });
    expect(reads).toHaveBeenCalledTimes(before);
    expect(cloud.loadBoardList).toHaveBeenCalledTimes(1);
    await unmount();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(reads).toHaveBeenCalledTimes(before);
  });
});
