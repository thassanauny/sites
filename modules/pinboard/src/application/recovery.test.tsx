// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import { board, card, click, field, fill, installHarness, mount, unmount } from './testSupport';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('local draft recovery', () => {
  it('recovers card edits after reload without publishing or overwriting unrelated remote fields', async () => {
    await mount([{ ...board, cards: [card] }]);
    await click('Edit Buy coffee');
    await fill('Card title', 'Recovered title');
    await unmount();
    const remote = {
      ...board,
      cards: [{ ...card, description: 'Another device added this' }],
      revision: 2,
    };
    await mount([remote]);
    await click('Edit Buy coffee');
    expect(field('Card title').value).toBe('Recovered title');
    expect(document.body.textContent).toContain('Recovered unsaved draft');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
    cloud.mutateBoard.mockResolvedValueOnce({
      ...remote,
      cards: [{ ...remote.cards[0], title: 'Recovered title' }],
      revision: 3,
    });
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { title: 'Recovered title' },
    });
    expect(
      [...Array(localStorage.length)].some((_, index) =>
        localStorage.key(index)?.startsWith('pinboard-recovery.v1:'),
      ),
    ).toBe(false);
  });

  it('recovers new board drafts and clears them only after explicit discard', async () => {
    await mount([], '');
    await click('Create a board');
    await fill('Board name', 'Keep my project');
    await unmount();
    await mount([], '');
    await click('Create a board');
    expect(field('Board name').value).toBe('Keep my project');
    expect(cloud.createBoard).not.toHaveBeenCalled();
    await click('Cancel');
    await click('Discard draft');
    await click('Create a board');
    expect(field('Board name').value).toBe('');
  });

  it('keeps an edit and reports when its recovery write fails', async () => {
    await mount([{ ...board, cards: [card] }]);
    await click('Edit Buy coffee');
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('pinboard-recovery.v1:')) throw new Error('Quota exceeded');
      set.call(this, key, value);
    });
    await fill('Card title', 'Still in the editor');
    expect(field('Card title').value).toBe('Still in the editor');
    expect(document.body.textContent).toContain('Could not save a local recovery copy');
    expect(cloud.mutateBoard).not.toHaveBeenCalled();
  });
});
