// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import {
  board,
  deferred,
  field,
  click,
  fill,
  mount,
  navigateHash,
  unmount,
  installHarness,
} from './testSupport';
import { DeviceBoards } from '../infrastructure/storage/deviceBoards';
import type { Board } from '../domain/boards/types';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('Pinboard UI: invitations and routes', () => {
  it('opens direct invitation links, clears a cancelled invitation, and stays closed after reload', async () => {
    await mount([], '', false, `#join/${board.invite_code}`);
    expect(field('Invitation code or link').value).toBe(board.invite_code);
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    await click('Cancel');
    expect(window.location.hash).toBe('');
    await unmount();
    await mount([], '');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('shares explicit invitation links and accepts them in the Join form', async () => {
    await mount();
    await click('Invite people');
    expect(field('Invitation link').value).toBe(`http://localhost/#join/${board.invite_code}`);
    await click('Close dialog');
    await click('Workspace');
    await click('Join with a code');
    await fill(
      'Invitation code or link',
      `http://localhost/#/join/${board.invite_code.toUpperCase()}`,
    );
    cloud.joinBoard.mockResolvedValueOnce(board);
    await click('Join board');
    expect(cloud.joinBoard).toHaveBeenCalledWith(board.invite_code);
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
  });

  it('opens a new invitation route as a prefilled form without joining automatically', async () => {
    await mount([], '');
    await act(async () => {
      window.history.replaceState(null, '', `/#join/${board.invite_code}`);
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(field('Invitation code or link').value).toBe(board.invite_code);
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    cloud.joinBoard.mockResolvedValueOnce(board);
    await click('Join board');
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
  });

  it('prefills the new code when navigating between invitation routes with a dialog already open', async () => {
    const nextCode = 'b'.repeat(32);
    await mount([], '', false, `#join/${board.invite_code}`);
    await fill('Invitation code or link', 'Unsubmitted draft');
    await navigateHash(`#join/${nextCode}`);
    expect(field('Invitation code or link').value).toBe(nextCode);
    expect(cloud.joinBoard).not.toHaveBeenCalled();
  });

  it('leaves a removed-board route when cancelling and opens confirmation again on Back', async () => {
    const device = new DeviceBoards();
    device.remove(board.invite_code);
    await mount();
    await click('Cancel');
    expect(window.location.hash).toBe('');
    expect(document.querySelector('dialog')).toBeNull();
    await navigateHash(`#board/${board.invite_code}`);
    expect(field('Invitation code or link').value).toBe(board.invite_code);
    expect(cloud.joinBoard).not.toHaveBeenCalled();
    expect(device.removal(board.invite_code)).not.toBeNull();
  });

  it('retries a failed ordinary board link after leaving and returning through history', async () => {
    await mount([], board.invite_code);
    expect(cloud.joinBoard).toHaveBeenCalledTimes(1);
    await click('Cancel');
    cloud.joinBoard.mockResolvedValueOnce(board);
    await navigateHash(`#board/${board.invite_code}`);
    expect(cloud.joinBoard).toHaveBeenCalledTimes(2);
    expect(document.querySelector('h1')?.textContent).toBe(board.title);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('keeps the new invitation open when an older explicit join completes after navigation', async () => {
    const device = new DeviceBoards();
    device.remove(board.invite_code);
    await mount([], '', false, `#join/${board.invite_code}`);
    const pending = deferred<Board>();
    cloud.joinBoard.mockReturnValueOnce(pending.promise);
    await click('Join board');
    const nextCode = 'b'.repeat(32);
    await navigateHash(`#join/${nextCode}`);
    await act(async () => {
      pending.resolve(board);
    });
    expect(window.location.hash).toBe(`#join/${nextCode}`);
    expect(field('Invitation code or link').value).toBe(nextCode);
    expect(device.removal(board.invite_code)).not.toBeNull();
    expect(document.querySelector('.board-preview')).toBeNull();
  });

  it('does not close a new invitation when an older save completes after navigation', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'Accepted on the server');
    const pending = deferred<Board>();
    cloud.mutateBoard.mockReturnValueOnce(pending.promise);
    await click('Save details');
    const nextCode = 'b'.repeat(32);
    await navigateHash(`#join/${nextCode}`);
    await act(async () => {
      pending.resolve({
        ...board,
        title: 'Accepted on the server',
        revision: 2,
      });
    });
    expect(field('Invitation code or link').value).toBe(nextCode);
    expect(window.location.hash).toBe(`#join/${nextCode}`);
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('retries an invitation automatically after reconnecting', async () => {
    cloud.joinBoard.mockRejectedValueOnce(new Error('Connection lost'));
    await mount([], board.invite_code);
    expect(cloud.joinBoard).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    cloud.joinBoard.mockResolvedValueOnce(board);
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(cloud.joinBoard).toHaveBeenCalledTimes(2);
    expect(document.querySelector('h1')?.textContent).toBe('Weekend plans');
  });
});
