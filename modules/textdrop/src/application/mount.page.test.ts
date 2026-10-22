// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { useMountHarness, first, pending, root, cloud, dispose, writeText, element, rows, flush, start, join, edit } from '../../tests/mountHarness';
import type { TextDropPage } from '../domain/snippets/model';
import { DeviceSnippets } from '../infrastructure/storage/deviceSnippets';

useMountHarness();

describe('TextDrop page controls', () => {
  it('keeps the confirmed sync time and version on Home and the editor, and stops listening on disposal', async () => {
    let synced!: (at: Date) => void;
    const stop = vi.fn();
    cloud.subscribeSync = listener => {
      synced = listener;
      return stop;
    };
    await start();
    expect(element('footer-sync').textContent).toBe('Waiting for first sync.');
    synced(new Date(2026, 9, 18, 3, 15));
    expect(element('footer-sync').textContent).toBe('Synced 03:15 AM');
    await join(first.code);
    expect(element('footer-sync').textContent).toBe('Synced 03:15 AM');
    expect(root.querySelector('.site-footer')?.textContent).toContain('textdrop · test');
    dispose!();
    expect(stop).toHaveBeenCalledOnce();
  });
  it('shows connection status and Help, keeps the draft, and restores focus after Help closes', async () => {
    await start(`#/p/${first.code}`);
    expect(element('connection-label').textContent).toBe('Connected');
    expect(root.querySelector('.site-footer')?.textContent).toContain('textdrop · test');
    edit('Keep this draft while reading Help');
    element('help').focus();
    element('help').click();
    expect(element<HTMLDialogElement>('help-dialog').open).toBe(true);
    expect(document.activeElement).toBe(element('help-close'));
    const cancel = new Event('cancel', { cancelable: true });
    element('help-dialog').dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(element<HTMLDialogElement>('help-dialog').open).toBe(false);
    expect(document.activeElement).toBe(element('help'));
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this draft while reading Help');
    window.dispatchEvent(new Event('offline'));
    expect(element('connection-label').textContent).toBe('Offline');
  });

  it('skips navigation without changing the snippet route or losing unsaved text', async () => {
    await start(`#/p/${first.code}`);
    edit('Keep this draft');
    element('skip-link').click();
    await flush();
    expect(document.activeElement).toBe(element('main-content'));
    expect(location.hash).toBe(`#/p/${first.code}`);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this draft');
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('preserves the draft when leaving is cancelled, and cancels pending autosave after confirmed navigation', async () => {
    await start(`#/p/${first.code}`);
    edit('Keep this draft');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    root.querySelector<HTMLAnchorElement>('.brand')!.click();
    await flush();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe(`#/p/${first.code}`);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this draft');
    vi.mocked(window.confirm).mockReturnValue(true);
    root.querySelector<HTMLAnchorElement>('.brand')!.click();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(element('home').hidden).toBe(false);
    expect(cloud.savePage).not.toHaveBeenCalled();
    const cleanLeaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanLeaving);
    expect(cleanLeaving.defaultPrevented).toBe(false);
  });

  it('keeps a failed-save draft through reconnect and publishes it only after Retry save', async () => {
    vi.mocked(cloud.savePage).mockRejectedValueOnce(new Error('Save failed'));
    await start(`#/p/${first.code}`);
    edit('Retry this text');
    await vi.advanceTimersByTimeAsync(650);
    expect(element('save-status').textContent).toBe('Not saved');
    window.dispatchEvent(new Event('offline'));
    expect(element<HTMLTextAreaElement>('editor').disabled).toBe(true);
    expect(element('retry').hidden).toBe(true);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Retry this text');
    expect(element('retry').hidden).toBe(false);
    expect(cloud.savePage).toHaveBeenCalledTimes(1);
    element('retry').click();
    await flush();
    expect(cloud.savePage).toHaveBeenLastCalledWith(first.id, 'Retry this text');
    expect(element('save-status').textContent).toBe('All changes saved');
    expect(element('notice').hidden).toBe(true);
  });

  it('renders shared text literally and copies the original text and static-path invitation', async () => {
    const text = '<script>window.injected = true</script>\r\nsecond line';
    vi.mocked(cloud.joinPage).mockResolvedValue({ ...first, text });
    await start(`#/p/${first.code}`);
    expect(root.querySelector('script')).toBeNull();
    expect(element<HTMLTextAreaElement>('editor').value).toBe(text.replace(/\r\n/g, '\n'));
    element('copy-text').click();
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(text);
    element('share').click();
    element('invite-copy-link').click();
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(`http://localhost/textdrop/#/p/${first.code}`);
  });

  it('clears an old copy error when the next copy succeeds', async () => {
    await start(`#/p/${first.code}`);
    writeText.mockRejectedValueOnce(new Error('Denied'));
    element('copy-text').click();
    await flush();
    expect(element('notice').hidden).toBe(false);
    element('copy-text').click();
    await flush();
    expect(element('toast').textContent).toBe('Text copied');
    expect(element('notice').hidden).toBe(true);
  });

  it('downloads the visible draft as literal UTF-8 text and releases the temporary URL', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:textdrop-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0)); // local noon, so the date does not depend on the time zone
    await start(`#/p/${first.code}`);
    const text = '<config>\nবাংলা 😀\n</config>';
    edit(text);
    element('download').click();
    const blob: Blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe('text/plain;charset=utf-8');
    const anchor = download.mock.instances[0]! as HTMLAnchorElement;
    expect(anchor.download).toBe('textdrop-2026-10-10.txt');
    expect(anchor.download).not.toContain(first.code.slice(0, 8));
    expect(anchor.href).toBe('blob:textdrop-export');
    expect(cloud.savePage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:textdrop-export');
    vi.useRealTimers();
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        resolve(String(reader.result));
      });
      reader.addEventListener('error', () => {
        reject(reader.error);
      });
      reader.readAsText(blob);
    });
    expect(contents).toBe(text);
  });

  it('names a download after the snippet name on this device', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn().mockReturnValue('blob:textdrop-export');
        static revokeObjectURL = vi.fn();
      },
    );
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const devices = new DeviceSnippets();
    devices.remember(first.code);
    devices.sharedName(first.code, 'Travel/notes: May', 1);
    vi.mocked(cloud.joinPage).mockResolvedValueOnce({ ...first, name: 'Travel/notes: May' });
    await start(`#/p/${first.code}`);
    element('download').click();
    expect((download.mock.instances[0]! as HTMLAnchorElement).download).toBe('Travel notes May.txt');
  });

  it('tears down listeners and polling and ignores late opens or copy results', async () => {
    const opening = pending<TextDropPage>();
    vi.mocked(cloud.joinPage).mockReturnValueOnce(opening.promise);
    await start();
    await join(first.code);
    dispose!();
    await start();
    opening.resolve(first);
    await flush();
    expect(element('home').hidden).toBe(false);
    expect(rows()).toEqual([]);
    await join(first.code);
    const copying = pending<void>();
    writeText.mockReturnValueOnce(copying.promise);
    element('copy-text').click();
    const oldCreate = element('create');
    dispose!();
    const loadCalls = vi.mocked(cloud.pollPage).mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('hashchange'));
    oldCreate.click();
    await vi.advanceTimersByTimeAsync(6000);
    expect(cloud.pollPage).toHaveBeenCalledTimes(loadCalls);
    expect(cloud.createPage).not.toHaveBeenCalled();
    await start();
    copying.resolve();
    await flush();
    expect(element('toast').hidden).toBe(true);
  });
});
