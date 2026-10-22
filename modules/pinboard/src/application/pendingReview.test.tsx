// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import { board, button, click, installHarness, mount } from './testSupport';
vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('reviewing queued device edits', () => {
  it('explains an unapplied deleted-card draft and allows only download or the shared board', async () => {
    const review = {
      owner: 'first',
      local: { ...board, title: 'Unapplied local draft' },
      shared: board,
      pendingIds: [],
      unappliedBackupId: 'backup',
      backups: [{ id: 'backup', board, createdAt: board.created_at }],
      online: true,
      retryError: 'A card in this draft was removed.',
    };
    cloud.reviewPendingBoard.mockResolvedValue(review);
    cloud.resolvePendingBoard.mockResolvedValue(board);
    await mount();
    await click('Review device edits');
    expect(document.querySelector('dialog')?.textContent).toContain('could not be queued');
    expect(document.querySelector('dialog')?.textContent).not.toContain('Retry reviewed edits');
    expect(button('Download local draft')).toBeDefined();
    await click('Use shared board');
    expect(cloud.resolvePendingBoard).toHaveBeenCalledExactlyOnceWith(review, 'discard');
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('shows both versions and retries only after explicit review', async () => {
    const local = { ...board, title: 'Local draft', localPending: true };
    const review = {
      owner: 'first',
      local,
      shared: { ...board, title: 'Shared title', revision: 1002 },
      pendingIds: ['operation'],
      backups: [],
      online: true,
    };
    cloud.reviewPendingBoard.mockResolvedValue(review);
    cloud.resolvePendingBoard.mockResolvedValue({ ...board, title: 'Local draft', revision: 1003 });
    await mount([local]);
    await click('Review device edits');
    expect(
      [...document.querySelectorAll('textarea')].map((input) => input.value).join(' '),
    ).toContain('Local draft');
    expect(
      [...document.querySelectorAll('textarea')].map((input) => input.value).join(' '),
    ).toContain('Shared title');
    expect(cloud.resolvePendingBoard).not.toHaveBeenCalled();
    await click('Retry reviewed edits');
    expect(cloud.resolvePendingBoard).toHaveBeenCalledExactlyOnceWith(review, 'retry');
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('keeps review open on a failed choice and exposes retained backups without queued edits', async () => {
    const review = {
      owner: 'first',
      local: board,
      shared: board,
      pendingIds: ['operation'],
      backups: [{ id: 'backup', board, createdAt: board.created_at }],
      online: true,
    };
    cloud.reviewPendingBoard.mockResolvedValue(review);
    cloud.resolvePendingBoard.mockRejectedValue(
      new Error('Pending edits changed in another tab. Refresh this review.'),
    );
    await mount();
    await click('Review device edits');
    await click('Use shared board');
    expect(document.querySelector('dialog')).not.toBeNull();
    expect(document.querySelector('dialog')?.textContent).toContain(
      'Pending edits changed in another tab',
    );
    expect(button('Download backup 1')).toBeDefined();
    cloud.reviewPendingBoard.mockResolvedValue({ ...review, pendingIds: [], online: false });
    await click('Refresh review');
    expect(document.body.textContent).toContain('No edits are waiting to sync');
    expect(document.body.textContent).toContain('Last downloaded shared board');
    expect(document.body.textContent).not.toContain('Retry reviewed edits');
    expect(button('Download backup 1')).toBeDefined();
  });
});
