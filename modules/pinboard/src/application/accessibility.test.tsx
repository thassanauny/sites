// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import { board, card, button, click, fill, mount, installHarness } from './testSupport';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

describe('Pinboard UI: keyboard focus and labelled controls', () => {
  const populated = { ...board, cards: [card] };

  it('skips navigation without changing the active board route', async () => {
    await mount([populated], board.invite_code);
    const hash = location.hash;
    await click('Skip to content');
    expect(document.activeElement).toBe(document.getElementById('main-content'));
    expect(location.hash).toBe(hash);
  });

  describe.each([
    ['normally', false],
    ['under StrictMode', true],
  ])('%s', (_mode, strict) => {
    it.each(['Settings', 'Edit Buy coffee', 'Add column', 'Create board', 'Join a board'])(
      'returns focus to "%s" after its dialog closes',
      async (name) => {
        await mount([populated], board.invite_code, strict);
        if (name === 'Join a board') await click('Open workspace');
        const opener = button(name === 'Add column' ? 'Settings' : name);
        opener.focus();
        if (name === 'Add column') await click('Settings');
        await click(name);
        expect(document.querySelector('dialog')).not.toBeNull();
        expect(document.activeElement).not.toBe(opener);
        await click('Close dialog');
        expect(document.querySelector('dialog')).toBeNull();
        expect(document.activeElement).toBe(opener);
      },
    );
  });

  it('returns focus to the card after its edits are saved', async () => {
    await mount([populated]);
    const opener = button('Edit Buy coffee');
    opener.focus();
    await click('Edit Buy coffee');
    await fill('Card title', 'Buy tea');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...populated,
      revision: 2,
      cards: [{ ...card, title: 'Buy tea' }],
    });
    await click('Save');
    expect(document.querySelector('dialog')).toBeNull();
    expect(opener.getAttribute('aria-label')).toBe('Edit Buy tea');
    expect(document.activeElement).toBe(opener);
  });

  it('leaves focus alone when the control that opened the dialog is gone', async () => {
    await mount([populated]);
    button('Edit Buy coffee').focus();
    await click('Edit Buy coffee');
    await click('Delete');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...populated,
      revision: 2,
      cards: [],
    });
    await click('Confirm delete');
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('presents the column colours as one named group and leaves no label without a control', async () => {
    await mount([populated]);
    await click('Settings for To do');
    const group = document.querySelector<HTMLElement>('dialog [role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Column color',
    );
    expect(
      [...group.querySelectorAll('button')].map((item) => item.getAttribute('aria-label')),
    ).toEqual(['slate', 'blue', 'amber', 'emerald', 'rose', 'violet']);
    expect(
      [...document.querySelectorAll('dialog label')].filter(
        (item) => !(item as HTMLLabelElement).control,
      ),
    ).toEqual([]);
  });
});
