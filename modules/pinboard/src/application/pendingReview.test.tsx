// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import { board, button, click, field, fill, installHarness, mount } from './testSupport';
vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('reviewing queued device edits', () => {
  it('keeps footer metadata separate from review and preserves unsaved settings through review', async () => {
    cloud.reviewPendingBoard.mockResolvedValue({
      owner: 'first',
      local: board,
      shared: board,
      pendingIds: [],
      backups: [],
      online: true,
    });
    await mount();
    const footer = document.querySelector('.app-footer')!;
    expect([...footer.children].map((element) => element.className)).toEqual([
      'footer-sync',
      'footer-board-change',
      'app-version',
    ]);
    expect(footer.querySelector('.footer-board-change time')?.getAttribute('datetime')).toBe(
      board.updated_at,
    );
    expect(document.querySelector('.sidebar .footer-board-change')).toBeNull();
    expect(footer.querySelector('button')).toBeNull();
    const settings = button('Settings');
    settings.focus();
    await click('Settings');
    await fill('Board name', 'Unsaved board details');
    await click('Compare board versions');
    expect(document.querySelector('dialog h2')?.textContent).toBe('Compare board versions');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    await click('Back to settings');
    expect(field('Board name').value).toBe('Unsaved board details');
    await click('Close');
    expect(document.querySelector('dialog h2')?.textContent).toBe('Discard this draft?');
    await click('Keep draft');
    expect(field('Board name').value).toBe('Unsaved board details');
    await click('Close');
    await click('Discard draft');
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(settings);
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
  });
  it('explains an unapplied draft and offers confirmed replacement while keeping existing backups', async () => {
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
    await click('Settings');
    await click('Compare board versions');
    expect(document.querySelector('dialog')?.textContent).toContain('could not be queued');
    expect(document.querySelector('dialog')?.textContent).not.toContain('Retry reviewed edits');
    expect(button('Force sync my changes')).toBeDefined();
    expect(button('Download backup 1')).toBeDefined();
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
    await click('Settings');
    await click('Compare board versions');
    expect(document.querySelector('.comparison-local')?.textContent).toContain('Local draft');
    expect(document.querySelector('.comparison-shared')?.textContent).toContain('Shared title');
    expect(document.querySelector('dialog textarea')).toBeNull();
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
    await click('Settings');
    await click('Compare board versions');
    await click('Use shared board');
    expect(document.querySelector('dialog')).not.toBeNull();
    expect(document.querySelector('dialog')?.textContent).toContain(
      'Pending edits changed in another tab',
    );
    expect(button('Download backup 1')).toBeDefined();
    cloud.reviewPendingBoard.mockResolvedValue({ ...review, pendingIds: [], online: false });
    await click('Refresh review');
    expect(document.body.textContent).toContain('No edits are waiting to sync');
    expect(document.body.textContent).toContain('No differences.');
    expect(document.body.textContent).not.toContain('Retry reviewed edits');
    expect(button('Download backup 1')).toBeDefined();
  });
  it('requires confirmation before replacing the shared board and allows cancelling', async () => {
    const review = {
      owner: 'first',
      local: { ...board, title: 'Device title' },
      shared: board,
      pendingIds: [],
      backups: [],
      online: true,
    };
    cloud.reviewPendingBoard.mockResolvedValue(review);
    cloud.forcePendingBoard.mockResolvedValue(review.local);
    await mount();
    await click('Settings');
    await click('Compare board versions');
    await click('Force sync my changes');
    expect(cloud.forcePendingBoard).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')?.textContent).toContain('entire shared board');
    await click('Cancel force sync');
    expect(cloud.forcePendingBoard).not.toHaveBeenCalled();
    await click('Force sync my changes');
    await click('Replace shared board');
    expect(cloud.forcePendingBoard).toHaveBeenCalledExactlyOnceWith(review);
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('hides matching content and disables force sync when there are no differences', async () => {
    cloud.reviewPendingBoard.mockResolvedValue({
      owner: 'first',
      local: board,
      shared: board,
      pendingIds: [],
      backups: [],
      online: true,
    });
    await mount();
    await click('Settings');
    await click('Compare board versions');
    expect(document.querySelector('dialog')?.textContent).toContain('No differences.');
    expect(document.querySelector('.board-differences')).toBeNull();
    expect(button('Force sync my changes').disabled).toBe(true);
    expect(document.querySelector('dialog')?.textContent).not.toContain('Download local draft');
  });
  it('copies unsaved settings without changing the original and reuses its ID after a lost reply', async () => {
    cloud.copyBoard
      .mockRejectedValueOnce(new Error('Network response lost'))
      .mockImplementation(async (id, snapshot) => ({
        ...snapshot,
        id,
        invite_code: 'b'.repeat(32),
        revision: 1,
      }));
    await mount();
    await click('Settings');
    await fill('Board name', 'My unsaved name');
    await click('Save my changes as a new board');
    expect(field('Board name').value).toBe('My unsaved name');
    await click('Save my changes as a new board');
    const [first, second] = cloud.copyBoard.mock.calls;
    expect(first[0]).not.toBe(board.id);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toMatchObject({
      title: 'My unsaved name (copy)',
      cards: board.cards,
      columns: board.columns,
    });
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('My unsaved name (copy)');
  });
});
