// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { useMountHarness, first, pending, root, cloud, element, flush, start, edit } from '../../tests/mountHarness';
import { MAX_TEXT_BYTES, type TextDropPage } from '../domain/snippets/model';
import { DeviceSnippets } from '../infrastructure/storage/deviceSnippets';

useMountHarness();

describe('TextDrop synchronization and save status', () => {
  const visibility = (state: DocumentVisibilityState) => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  const loads = () => vi.mocked(cloud.loadPage).mock.calls.length;
  const status = () => element('save-status').textContent;
  const newer = { ...first, text: 'Newer text', version: 2 };

  it('polls a clean snippet every 3 seconds only while the page is visible and shows the newer text', async () => {
    await start(`#/p/${first.code}`);
    vi.mocked(cloud.loadPage).mockResolvedValue(newer);
    await vi.advanceTimersByTimeAsync(2998); // mounting already advanced 1 ms
    expect(loads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(loads()).toBe(1);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Newer text');
    await vi.advanceTimersByTimeAsync(3000);
    expect(loads()).toBe(2);
    visibility('hidden');
    await vi.advanceTimersByTimeAsync(9000);
    expect(loads()).toBe(2);
    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(loads()).toBe(3);
  });

  it('announces a finished save politely but not every intermediate state or failure twice', async () => {
    await start(`#/p/${first.code}`);
    const announcement = element('save-announcement');
    expect(announcement.getAttribute('role')).toBe('status');
    expect(announcement.getAttribute('aria-live')).toBe('polite');
    expect(announcement.classList.contains('sr-only')).toBe(true);
    // The visible status changes at every step, so it is not itself a live region.
    expect(element('save-status').getAttribute('role')).toBeNull();
    expect(element('save-status').getAttribute('aria-live')).toBeNull();
    expect(element('notice-message').getAttribute('role')).toBe('alert');
    expect(announcement.textContent).toBe('');

    edit('A first draft');
    expect(status()).toBe('Unsaved changes…');
    expect(announcement.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(649);
    expect(announcement.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(status()).toBe('All changes saved');
    expect(announcement.textContent).toBe('All changes saved');

    edit('Typing again');
    expect(announcement.textContent).toBe('');
    vi.mocked(cloud.savePage).mockRejectedValueOnce(new Error('Save failed'));
    await vi.advanceTimersByTimeAsync(650);
    expect(status()).toBe('Not saved');
    expect(announcement.textContent).toBe('');
    expect(element('notice-message').textContent).toBe('Save failed');

    element('retry').click();
    await flush();
    expect(announcement.textContent).toBe('All changes saved');
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(announcement.textContent).toBe('All changes saved');
  });

  it('does no page work when a poll finds nothing new', async () => {
    await start(`#/p/${first.code}`);
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver(records => {
      changes.push(...records);
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    await vi.advanceTimersByTimeAsync(9000);
    changes.push(...observer.takeRecords());
    observer.disconnect();
    expect(loads()).toBe(3);
    expect(changes).toEqual([]);
  });

  it('rewrites only the character count when the next character is typed', async () => {
    await start(`#/p/${first.code}`);
    edit('a');
    const observer = new MutationObserver(() => undefined);
    observer.observe(document, { subtree: true, childList: true, characterData: true });
    edit('ab');
    const rewritten = observer.takeRecords().map(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.id);
    observer.disconnect();
    expect(new Set(rewritten)).toEqual(new Set(['text-count']));
    expect(element('text-count').textContent).toBe('2 characters · 1 lines');
  });

  it('polls less often while nothing changes and quickly again once someone types', async () => {
    await start(`#/p/${first.code}`);
    await vi.advanceTimersByTimeAsync(60_000); // every 3 s for the first minute
    expect(loads()).toBe(20);
    await vi.advanceTimersByTimeAsync(30_000); // then every 10 s
    expect(loads()).toBe(20 + 3);
    await vi.advanceTimersByTimeAsync(300_000); // every 10 s until minute five, then every 30 s
    expect(loads()).toBe(20 + 3 + 21 + 3);
    const slow = loads();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(loads()).toBe(slow);
    edit('Back to work');
    await vi.advanceTimersByTimeAsync(3000);
    expect(loads()).toBe(slow + 1);
  });

  it('waits longer between polls after failures and polls normally again after one succeeds', async () => {
    vi.mocked(cloud.loadPage).mockRejectedValue(new Error('Poll failed'));
    await start(`#/p/${first.code}`);
    await vi.advanceTimersByTimeAsync(2999);
    expect(loads()).toBe(1);
    await vi.advanceTimersByTimeAsync(5999);
    expect(loads()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(loads()).toBe(2);
    expect(status()).toBe('Sync unavailable');
    vi.mocked(cloud.loadPage).mockResolvedValue(first);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(loads()).toBe(3);
    expect(status()).toBe('All changes saved');
    await vi.advanceTimersByTimeAsync(6000);
    expect(loads()).toBe(5);
  });

  it('keeps unsaved text while a newer version from another device arrives', async () => {
    vi.mocked(cloud.savePage).mockReturnValue(new Promise(() => {}));
    await start(`#/p/${first.code}`);
    edit('My unsaved words');
    vi.mocked(cloud.loadPage).mockResolvedValue(newer);
    await vi.advanceTimersByTimeAsync(3000);
    expect(loads()).toBe(1);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('My unsaved words');
    expect(status()).toBe('Saving…');
  });

  it('refreshes once when the window gains focus, the page becomes visible or the connection returns', async () => {
    await start(`#/p/${first.code}`);
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(loads()).toBe(1);
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(loads()).toBe(1);
    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(loads()).toBe(2);
    window.dispatchEvent(new Event('offline'));
    await flush();
    expect(loads()).toBe(2);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(loads()).toBe(3);
  });

  it('shows "Sync unavailable" after a failed refresh and clears it when the next refresh succeeds', async () => {
    await start(`#/p/${first.code}`);
    vi.mocked(cloud.loadPage).mockRejectedValueOnce(new Error('Poll failed'));
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(status()).toBe('Sync unavailable');
    expect(element('notice-message').textContent).toBe('Poll failed');
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(status()).toBe('All changes saved');
    expect(element('notice').hidden).toBe(true);
  });

  it('shows the over-limit state, hides Retry and sends nothing while the text is too large', async () => {
    await start(`#/p/${first.code}`);
    edit('x'.repeat(MAX_TEXT_BYTES + 1));
    expect(element('text-count').textContent).toContain('over 1 MiB limit');
    expect(element('text-count').classList.contains('over-limit')).toBe(true);
    expect(element('retry').hidden).toBe(true);
    expect(element('notice-message').textContent).toContain('1 MiB');
    await vi.advanceTimersByTimeAsync(2000);
    expect(cloud.savePage).not.toHaveBeenCalled();
    edit('Back under the limit');
    expect(element('text-count').textContent).not.toContain('over');
    expect(element('text-count').classList.contains('over-limit')).toBe(false);
    await vi.advanceTimersByTimeAsync(650);
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(first.id, 'Back under the limit');
  });

  it('does not encode small texts and measures a large text once per change, not once per redraw', async () => {
    await start(`#/p/${first.code}`);
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    edit('x'.repeat(5000));
    await vi.advanceTimersByTimeAsync(650);
    expect(cloud.savePage).toHaveBeenCalledTimes(1);
    expect(status()).toBe('All changes saved');
    expect(element('text-count').textContent).toBe('5,000 characters · 1 lines');
    expect(encode).not.toHaveBeenCalled();
    // 500,000 characters may or may not fit in 1 MiB, so the size is counted exactly.
    edit('y'.repeat(500_000));
    await vi.advanceTimersByTimeAsync(650);
    expect(status()).toBe('All changes saved');
    // Checks when typing and before saving, plus one count for the page: not one per redraw.
    expect(encode.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('saves pending text when the page is hidden or being closed', async () => {
    await start(`#/p/${first.code}`);
    edit('Typed just before switching apps');
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(cloud.savePage).toHaveBeenCalledExactlyOnceWith(first.id, 'Typed just before switching apps');
    visibility('visible');
    edit('Typed just before closing');
    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(cloud.savePage).toHaveBeenCalledTimes(2);
    expect(cloud.savePage).toHaveBeenLastCalledWith(first.id, 'Typed just before closing');
  });

  it('does not retry a failed save when the page is hidden', async () => {
    vi.mocked(cloud.savePage).mockRejectedValueOnce(new Error('Save failed'));
    await start(`#/p/${first.code}`);
    edit('Needs an explicit retry');
    await vi.advanceTimersByTimeAsync(650);
    expect(status()).toBe('Not saved');
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(cloud.savePage).toHaveBeenCalledTimes(1);
  });

  it('keeps saving while someone types without pausing', async () => {
    await start(`#/p/${first.code}`);
    for (let seconds = 0; seconds < 25; seconds += 0.3) {
      edit(`Continuous typing ${seconds.toFixed(1)}`);
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(vi.mocked(cloud.savePage).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(vi.mocked(cloud.savePage).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('saves immediately with Ctrl+S or Cmd+S without waiting for the autosave delay', async () => {
    let version = 1;
    vi.mocked(cloud.savePage).mockImplementation(async (_id, text) => ({ ...first, text, version: ++version }));
    await start(`#/p/${first.code}`);
    for (const modifier of ['ctrlKey', 'metaKey'] as const) {
      edit(`Saved with ${modifier}`);
      const press = new KeyboardEvent('keydown', { key: 'S', [modifier]: true, bubbles: true, cancelable: true });
      element('editor').dispatchEvent(press);
      await flush();
      expect(press.defaultPrevented).toBe(true);
      expect(cloud.savePage).toHaveBeenLastCalledWith(first.id, `Saved with ${modifier}`);
    }
    expect(cloud.savePage).toHaveBeenCalledTimes(2);
  });

  it('describes each save state in the status line and counts characters and lines', async () => {
    const saving = pending<TextDropPage>();
    vi.mocked(cloud.savePage).mockReturnValueOnce(saving.promise).mockRejectedValueOnce(new Error('Save failed'));
    await start(`#/p/${first.code}`);
    expect(status()).toBe('All changes saved');
    expect(element('text-count').textContent).toBe('11 characters · 1 lines');
    edit('One\nTwo');
    expect(status()).toBe('Unsaved changes…');
    expect(element('text-count').textContent).toBe('7 characters · 2 lines');
    await vi.advanceTimersByTimeAsync(650);
    expect(status()).toBe('Saving…');
    saving.resolve({ ...first, text: 'One\nTwo', version: 2 });
    await flush();
    expect(status()).toBe('All changes saved');
    expect(element('save-status').classList.contains('unsaved')).toBe(false);
    edit('Three');
    await vi.advanceTimersByTimeAsync(650);
    expect(status()).toBe('Not saved');
    expect(element('save-status').classList.contains('unsaved')).toBe(true);
    window.dispatchEvent(new Event('offline'));
    expect(status()).toBe('Offline · editing paused');
  });

  it('hides a confirmation toast after about 2.4 seconds', async () => {
    await start(`#/p/${first.code}`);
    element('copy-code').click();
    await flush();
    expect(element('toast').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(2300);
    expect(element('toast').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(element('toast').hidden).toBe(true);
  });

  it('marks device-list links unavailable for assistive technology while offline', async () => {
    new DeviceSnippets().remember(first.code);
    await start();
    const link = root.querySelector<HTMLAnchorElement>('.snippet-open')!;
    expect(link.getAttribute('aria-disabled')).toBe('false');
    expect(link.tabIndex).toBe(0);
    window.dispatchEvent(new Event('offline'));
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.tabIndex).toBe(-1);
  });
});
