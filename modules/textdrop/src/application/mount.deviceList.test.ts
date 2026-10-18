// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { useMountHarness, first, second, key, pending, root, cloud, dispose, element, rows, flush, start, join, create, edit } from '../../tests/mountHarness';
import type { TextDropPage } from '../domain/snippets/model';
import { DEVICE_SNIPPETS_KEY, DeviceSnippets } from '../infrastructure/storage/deviceSnippets';

useMountHarness();

describe('TextDrop device list', () => {
  it('reports storage recovery when a removed snippet cannot be recorded after rejoining', async () => {
    const history = new DeviceSnippets();
    history.remember(first.code);
    history.remove(first.code);
    const removed = history.snapshot(first.code);
    await start();
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await join(first.code);
    expect(cloud.joinPage).toHaveBeenCalledWith(first.code);
    expect(history.snapshot(first.code)).toBe(removed);
    expect(history.isRemoved(first.code)).toBe(true);
    expect(element('home').hidden).toBe(false);
    expect(element('notice-message').textContent).toContain('Could not save the snippet on this device');
    expect(element('notice-message').textContent).toContain('available space');
    expect(element('notice-message').textContent).not.toContain('removed from this device while opening');
    expect(element<HTMLInputElement>('join-code').value).toBe(first.code);
    writes.mockRestore();
    await join(first.code);
    expect(element('home').hidden).toBe(false);
    expect(rows()).toEqual([first.code]);
    expect(element('notice').hidden).toBe(true);
    expect(history.isRemoved(first.code)).toBe(false);
  });

  it('does not let an earlier opening restore a snippet removed in another tab', async () => {
    new DeviceSnippets().remember(first.code);
    const opening = pending<TextDropPage>();
    vi.mocked(cloud.joinPage).mockReturnValueOnce(opening.promise);
    await start(`#/p/${first.code}`);
    new DeviceSnippets().remove(first.code);
    window.dispatchEvent(new StorageEvent('storage', { key: key(first.code) }));
    opening.resolve(first);
    await flush();
    expect(rows()).toEqual([]);
    expect(new DeviceSnippets().isRemoved(first.code)).toBe(true);
    expect(element('home').hidden).toBe(false);
    expect(element('notice-message').textContent).toContain('removed from this device while opening');
    expect(document.activeElement).toBe(element('join'));
  });

  it('honors cross-tab removal without discarding an unsaved editor', async () => {
    await start(`#/p/${first.code}`);
    edit('Keep this unsaved draft');
    window.dispatchEvent(new Event('offline'));
    new DeviceSnippets().remove(first.code);
    window.dispatchEvent(new StorageEvent('storage', { key: key(first.code) }));
    expect(rows()).toEqual([]);
    expect(element('workspace').hidden).toBe(false);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this unsaved draft');
    expect(element('notice-message').textContent).toContain('unsaved text stays');
    expect(cloud.savePage).not.toHaveBeenCalled();
    dispose!();
    await start('#/');
    await join(first.code);
    expect(element('home').hidden).toBe(false);
    history.replaceState(null, '', `/textdrop/#/p/${first.code}`);
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this unsaved draft');
    expect(element('notice-message').textContent).toContain('Recovered unsaved text');
    element('retry').click();
    await flush();
    new DeviceSnippets().remove(first.code);
    window.dispatchEvent(new StorageEvent('storage', { key: key(first.code) }));
    expect(element('home').hidden).toBe(false);
    expect(rows()).toEqual([]);
    expect(location.hash).toBe('#/');
  });

  it('remembers created, joined, and direct-link snippets and restores the list after remounting', async () => {
    await start();
    await create();
    expect(location.hash).toBe(`#/p/${first.code}`);
    expect(rows()).toEqual([first.code]);
    root.querySelector<HTMLAnchorElement>('.brand')!.click();
    await flush();
    vi.setSystemTime(new Date('2026-10-10T02:00:00.000Z'));
    await join(second.code);
    expect(rows()).toEqual([second.code, first.code]);
    expect(JSON.parse(localStorage.getItem(key(second.code))!)).toEqual({ code: second.code, openedAt: '2026-10-10T02:00:00.000Z' });
    dispose!();
    await start();
    expect(rows()).toEqual([second.code, first.code]);
    expect(element('home').hidden).toBe(false);
    dispose!();
    await start(`#/p/${first.code}`);
    expect(cloud.joinPage).toHaveBeenLastCalledWith(first.code);
    expect(element<HTMLTextAreaElement>('editor').value).toBe(first.text);
    expect(rows().filter(code => code === first.code)).toHaveLength(1);
  });

  it('retries a failed recent-snippet opening even when the hash already matches', async () => {
    new DeviceSnippets().remember(first.code);
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(new Error('Connection failed'));
    await start();
    root.querySelector<HTMLAnchorElement>('.snippet-open')!.click();
    await flush();
    expect(location.hash).toBe(`#/p/${first.code}`);
    expect(element('home').hidden).toBe(false);
    expect(element('notice-message').textContent).toBe('Connection failed');
    root.querySelector<HTMLAnchorElement>('.snippet-open')!.click();
    await flush();
    expect(cloud.joinPage).toHaveBeenCalledTimes(2);
    expect(element('workspace').hidden).toBe(false);
    expect(element('notice').hidden).toBe(true);
  });

  it('adds only successful openings and disables removal while an opening is pending', async () => {
    new DeviceSnippets().remember(first.code);
    const opening = pending<TextDropPage>();
    vi.mocked(cloud.joinPage).mockReturnValueOnce(opening.promise);
    await start();
    const joining = join(first.code);
    await flush();
    expect(root.querySelector('.snippet-remove')).toBeNull();
    const rename = root.querySelector<HTMLButtonElement>('.snippet-rename')!;
    expect(rename.disabled).toBe(true);
    expect(localStorage.getItem(key(first.code))).not.toBeNull();
    opening.resolve(first);
    await joining;
    await flush();
    expect(element('workspace').hidden).toBe(false);
    dispose!();
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(new Error('Invalid snippet'));
    await start();
    await join(second.code);
    expect(rows()).toEqual([first.code]);
    expect(localStorage.getItem(key(second.code))).toBeNull();
  });

  it('keeps failed removals visible and removes only local metadata after a retry', async () => {
    new DeviceSnippets().remember(first.code);
    new DeviceSnippets().remember(second.code);
    await start(`#/p/${first.code}`);
    element('settings').click();
    const removal = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    element('settings-remove').click();
    element('remove-confirm').click();
    expect(rows()).toEqual([first.code, second.code]);
    expect(element('toast').hidden).toBe(true);
    expect(element('notice-message').textContent).toContain('Could not remove');
    removal.mockRestore();
    element('remove-confirm').click();
    expect(rows()).toEqual([second.code]);
    expect(new DeviceSnippets().isRemoved(first.code)).toBe(true);
    expect(element('toast').textContent).toBe('Snippet removed from this device');
    expect(document.activeElement).toBe(root.querySelector('.snippet-open'));
    expect(cloud.createPage).not.toHaveBeenCalled();
    expect(cloud.joinPage).toHaveBeenCalledTimes(1);
    expect(cloud.pollPage).not.toHaveBeenCalled();
    expect(cloud.savePage).not.toHaveBeenCalled();
    await join(first.code);
    expect(element<HTMLTextAreaElement>('editor').value).toBe(first.text);
    expect(rows()).toContain(first.code);
  });

  it('keeps a failed history-write warning through successful reads without blocking the shared page', async () => {
    await start();
    const saving = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Full');
    });
    await create();
    expect(element('workspace').hidden).toBe(false);
    expect(element('notice-message').textContent).toContain('Keep the snippet code');
    root.querySelector<HTMLAnchorElement>('.brand')!.click();
    await flush();
    window.dispatchEvent(new Event('focus'));
    expect(rows()).toEqual([]);
    expect(element('notice-message').textContent).toContain('Could not save');
    saving.mockRestore();
    await join(first.code);
    expect(rows()).toEqual([first.code]);
    expect(element('notice').hidden).toBe(true);
  });

  it('updates another tab history without losing keyboard focus or restoring removed codes', async () => {
    new DeviceSnippets().remember(first.code);
    await start();
    root.querySelector<HTMLAnchorElement>('.snippet-open')!.focus();
    new DeviceSnippets().remember(second.code);
    window.dispatchEvent(new StorageEvent('storage', { key: key(second.code) }));
    expect(rows()).toEqual([second.code, first.code]);
    expect((document.activeElement as HTMLElement).dataset.code).toBe(first.code);
    localStorage.removeItem(key(first.code));
    window.dispatchEvent(new StorageEvent('storage', { key: key(first.code) }));
    expect(rows()).toEqual([second.code]);
    expect((document.activeElement as HTMLElement).dataset.code).toBe(second.code);
    window.dispatchEvent(new Event('focus'));
    expect(rows()).toEqual([second.code]);
  });

  it('shares optional snippet names, keeps the code underneath, and restores the name after remounting', async () => {
    new DeviceSnippets().remember(first.code);
    await start();
    const rename = root.querySelector<HTMLButtonElement>('.snippet-rename')!;
    rename.focus();
    rename.click();
    expect(element('dialog-title').textContent).toBe('Name this snippet');
    expect(document.activeElement).toBe(element('snippet-name-input'));
    element<HTMLInputElement>('snippet-name-input').value = 'Travel notes <draft>';
    element('rename-confirm').click();
    await flush();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(false);
    expect(root.querySelector('.snippet-name')!.textContent).toBe('Travel notes <draft>');
    expect(root.querySelector('.snippet-name draft')).toBeNull();
    expect(root.querySelector('.snippet-metadata code')!.textContent).toBe('aaaaaa…aaaaaa');
    expect(document.activeElement).toBe(root.querySelector('.snippet-rename'));
    expect(cloud.renamePage).toHaveBeenCalledWith(first.id, 'Travel notes <draft>');
    expect(cloud.savePage).not.toHaveBeenCalled();
    dispose!();
    await start();
    expect(root.querySelector('.snippet-name')!.textContent).toBe('Travel notes <draft>');
    root.querySelector<HTMLButtonElement>('.snippet-rename')!.click();
    expect(element<HTMLInputElement>('snippet-name-input').value).toBe('Travel notes <draft>');
    element<HTMLInputElement>('snippet-name-input').value = '';
    element('rename-confirm').click();
    await flush();
    expect(root.querySelector('.snippet-name')!.textContent).toBe('Untitled snippet');
  });

  it('accepts an opening response after another tab names the snippet without discarding the name', async () => {
    new DeviceSnippets().remember(first.code);
    const opening = pending<TextDropPage>();
    vi.mocked(cloud.joinPage).mockReturnValueOnce(opening.promise);
    await start(`#/p/${first.code}`);
    new DeviceSnippets().rename(first.code, 'Travel notes');
    window.dispatchEvent(new StorageEvent('storage', { key: `${DEVICE_SNIPPETS_KEY}:name:${first.code}` }));
    opening.resolve(first);
    await flush();
    expect(element('workspace').hidden).toBe(false);
    expect(element('page-name').textContent).toBe('Travel notes');
    expect(element<HTMLTextAreaElement>('editor').value).toBe(first.text);
    expect(new DeviceSnippets().list()[0]!.name).toBe('Travel notes');
  });

  it('keeps the full code out of the labels and tooltips of the snippet list', async () => {
    const devices = new DeviceSnippets();
    devices.remember(first.code);
    devices.remember(second.code);
    devices.rename(second.code, 'Travel notes');
    await start();
    const labels = [...root.querySelectorAll<HTMLElement>('#device-list .snippet-open, #device-list .snippet-rename')].map(control => [control.getAttribute('aria-label'), control.title]);
    expect(labels).toEqual([
      ['Open snippet aaaaaa…aaaaaa', 'Open snippet aaaaaa…aaaaaa'],
      ['Rename snippet aaaaaa…aaaaaa', 'Snippet name (optional)'],
      ['Open Travel notes', 'Open Travel notes'],
      ['Rename Travel notes', 'Snippet name (optional)'],
    ]);
    const leaks = [...root.querySelectorAll('*')].flatMap(item =>
      [...item.attributes]
        .filter(attribute => (attribute.value.includes(first.code) || attribute.value.includes(second.code)) && !['href', 'data-code'].includes(attribute.name))
        .map(attribute => `${item.tagName.toLowerCase()}[${attribute.name}]`),
    );
    expect(leaks).toEqual([]);
    dispose!();
    await start(`#/p/${first.code}`);
    expect(root.querySelector('[aria-label*="aaaaaaaa"]')).toBeNull();
  });
});
