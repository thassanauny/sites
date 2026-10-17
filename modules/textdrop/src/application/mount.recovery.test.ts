// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { cloud, dispose, edit, element, first, flush, start, useMountHarness } from '../../tests/mountHarness';
useMountHarness();

describe('local recovery', () => {
  it('restores unsaved text on reopening and waits for explicit retry before publishing', async () => {
    await start(`#/p/${first.code}`);
    edit('Recovery text');
    dispose!();
    await start(`#/p/${first.code}`);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Recovery text');
    expect(element('notice-message').textContent).toContain('Recovered unsaved text');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(cloud.savePage).not.toHaveBeenCalled();
    element('retry').click();
    await flush();
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(first.id, 'Recovery text');
    expect([...Array(localStorage.length)].some((_, index) => localStorage.key(index)?.startsWith('textdrop-recovery.v1:'))).toBe(false);
  });

  it('preserves the editor and warns if the recovery copy cannot be written', async () => {
    await start(`#/p/${first.code}`);
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('textdrop-recovery.v1:')) throw new Error('Quota exceeded');
      set.call(this, key, value);
    });
    edit('Keep this text');
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this text');
    expect(element('notice-message').textContent).toContain('Could not save a local recovery copy');
  });
});
