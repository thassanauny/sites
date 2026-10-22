// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { TextConflictError } from '../domain/snippets/model';
import { cloud, edit, element, first, flush, start, useMountHarness } from '../../tests/mountHarness';
useMountHarness();

describe('reviewing concurrent text', () => {
  it('keeps local text, renders shared text literally, and only replaces it on explicit choice', async () => {
    const shared = { ...first, text: '<script>other device</script>', version: 2 };
    cloud.saveCheckedPage = vi
      .fn()
      .mockRejectedValueOnce(new TextConflictError(shared))
      .mockImplementationOnce(async (_id, text) => ({ ...shared, text, version: 3 }));
    await start(`#/p/${first.code}`);
    edit('My version');
    await vi.advanceTimersByTimeAsync(700);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('My version');
    expect(element<HTMLTextAreaElement>('conflict-text').value).toBe(shared.text);
    expect(element('conflict-review').hidden).toBe(false);
    expect(element('retry').hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(cloud.saveCheckedPage).toHaveBeenCalledTimes(1);
    element('keep-local').click();
    await flush();
    expect(cloud.saveCheckedPage).toHaveBeenLastCalledWith(first.id, 'My version', expect.objectContaining({ resolveConflict: true }));
    expect(element('conflict-review').hidden).toBe(true);
    expect(element('save-status').textContent).toBe('All changes saved');
  });
  it('allows explicit shared-version acceptance without uploading the local text', async () => {
    const shared = { ...first, text: 'Shared wins by choice', version: 2 };
    cloud.saveCheckedPage = vi.fn().mockRejectedValue(new TextConflictError(shared));
    cloud.acceptSharedPage = vi.fn().mockResolvedValue(shared);
    await start(`#/p/${first.code}`);
    edit('My version');
    await vi.advanceTimersByTimeAsync(700);
    element('use-shared').click();
    await flush();
    expect(element<HTMLTextAreaElement>('editor').value).toBe(shared.text);
    expect(element('conflict-review').hidden).toBe(true);
    expect(cloud.saveCheckedPage).toHaveBeenCalledTimes(1);
  });
  it('keeps the edit baseline when a poll arrives before autosave', async () => {
    cloud.saveCheckedPage = vi.fn(async (_id, text) => ({ ...first, text, version: 3 }));
    vi.mocked(cloud.pollPage).mockResolvedValue({ ...first, text: 'Remote update', version: 2 });
    await start(`#/p/${first.code}`);
    edit('My edit');
    window.dispatchEvent(new Event('focus'));
    await flush();
    await vi.advanceTimersByTimeAsync(700);
    expect(cloud.saveCheckedPage).toHaveBeenCalledWith(first.id, 'My edit', expect.objectContaining({ baseVersion: 1, baseText: first.text }));
  });
});
