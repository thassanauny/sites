// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { useMountHarness, first, second, pending, root, cloud, dispose, element, rows, flush, start, join, create } from '../../tests/mountHarness';
import type { TextDropPage } from '../domain/snippets/model';
import { DeviceSnippets } from '../infrastructure/storage/deviceSnippets';

useMountHarness();

describe('TextDrop opening snippets', () => {
  it('creates only after confirmation and closes the dialog before focusing the opened editor', async () => {
    await start();
    element('create').click();
    expect(cloud.createPage).not.toHaveBeenCalled();
    element('create-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(cloud.createPage).toHaveBeenCalledTimes(1);
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(false);
    expect(element('workspace').hidden).toBe(false);
    expect(location.hash).toBe(`#/p/${first.code}`);
    expect(document.activeElement).toBe(element('editor'));
  });

  it('explains a malformed pasted link in the Open dialog and sends nothing', async () => {
    await start();
    element('join').click();
    element<HTMLInputElement>('join-code').value = 'http://';
    element('join-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(element('dialog-error').textContent).toBe('That link does not contain a snippet code. Copy the invitation link again.');
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(cloud.joinPage).not.toHaveBeenCalled();
  });

  it('retains a failed Create confirmation for retry without creating a second page', async () => {
    vi.mocked(cloud.createPage).mockRejectedValueOnce(new Error('Create response lost'));
    await start();
    await create();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('dialog-error').textContent).toBe('Create response lost');
    expect(element('workspace').hidden).toBe(true);
    expect(rows()).toEqual([]);
    expect(element<HTMLButtonElement>('create-confirm').disabled).toBe(false);
    element('create-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    const calls = vi.mocked(cloud.createPage).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe(calls[1]![0]);
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(false);
    expect(rows()).toEqual([first.code]);
  });

  it('keeps invalid codes and opening failures inside Join with the entered value available to retry', async () => {
    await start();
    await join('wrong');
    expect(cloud.joinPage).not.toHaveBeenCalled();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('dialog-error').hidden).toBe(false);
    expect(element<HTMLInputElement>('join-code').value).toBe('wrong');
    expect(document.activeElement).toBe(element('join-code'));
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(new Error('Snippet could not be opened'));
    await join(first.code);
    expect(element('dialog-error').textContent).toBe('Snippet could not be opened');
    expect(element<HTMLInputElement>('join-code').value).toBe(first.code);
    expect(element('workspace').hidden).toBe(true);
    expect(rows()).toEqual([]);
    await join(first.code);
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(false);
    expect(element('workspace').hidden).toBe(false);
    expect(element('notice').hidden).toBe(true);
    expect(document.activeElement).toBe(element('editor'));
  });

  it('opens a prefilled Join dialog for an invitation without requesting the shared text until submitted', async () => {
    await start(`#/join/${first.code}`);
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('join-form').hidden).toBe(false);
    expect(element<HTMLInputElement>('join-code').value).toBe(first.code);
    expect(document.activeElement).toBe(element('join-code'));
    expect(cloud.joinPage).not.toHaveBeenCalled();
    element('join-cancel').click();
    expect(cloud.joinPage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    await join(`http://localhost/textdrop/#/join/${first.code}`);
    expect(cloud.joinPage).toHaveBeenCalledExactlyOnceWith(first.code);
    expect(location.hash).toBe(`#/p/${first.code}`);
  });

  it('explains unavailable sharing inside an unconfigured invitation dialog without allowing a request', async () => {
    await start(`#/join/${first.code}`, false);
    const dialog = element<HTMLDialogElement>('snippet-dialog');
    expect(dialog.open).toBe(true);
    expect(element<HTMLInputElement>('join-code').value).toBe(first.code);
    expect(element('dialog-error').hidden).toBe(false);
    expect(element('dialog-error').textContent).toBe('Sharing is unavailable. Please try again later.');
    expect(element<HTMLButtonElement>('join-confirm').disabled).toBe(true);
    expect(element<HTMLButtonElement>('join-cancel').disabled).toBe(false);
    element('join-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(cloud.joinPage).not.toHaveBeenCalled();
    expect(cloud.createPage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    element('join-cancel').click();
    expect(dialog.open).toBe(false);
    expect(element('home').hidden).toBe(false);
    expect(location.hash).toBe('#/');
  });

  it('keeps Join input available across an offline interruption and blocks requests until reconnected', async () => {
    await start();
    element('join').click();
    element<HTMLInputElement>('join-code').value = first.code;
    window.dispatchEvent(new Event('offline'));
    expect(element<HTMLButtonElement>('join-confirm').disabled).toBe(true);
    element('join-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(cloud.joinPage).not.toHaveBeenCalled();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element<HTMLInputElement>('join-code').value).toBe(first.code);
    window.dispatchEvent(new Event('online'));
    expect(element<HTMLButtonElement>('join-confirm').disabled).toBe(false);
    await join(first.code);
    expect(cloud.joinPage).toHaveBeenCalledExactlyOnceWith(first.code);
    expect(element('workspace').hidden).toBe(false);
  });

  it('blocks duplicate submissions and dismissal while Create or Join is pending', async () => {
    for (const kind of ['create', 'join'] as const) {
      const opening = pending<TextDropPage>();
      if (kind === 'create') vi.mocked(cloud.createPage).mockReturnValueOnce(opening.promise);
      else vi.mocked(cloud.joinPage).mockReturnValueOnce(opening.promise);
      await start();
      element(kind).focus();
      element(kind).click();
      if (kind === 'join') element<HTMLInputElement>('join-code').value = first.code;
      const form = element(`${kind}-form`);
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const request = kind === 'create' ? cloud.createPage : cloud.joinPage;
      expect(request).toHaveBeenCalledTimes(1);
      expect(element<HTMLButtonElement>(`${kind}-confirm`).disabled).toBe(true);
      expect(element<HTMLButtonElement>(`${kind}-cancel`).disabled).toBe(true);
      expect(element<HTMLButtonElement>('dialog-close').disabled).toBe(true);
      if (kind === 'join') expect(element<HTMLInputElement>('join-code').disabled).toBe(true);
      const dialog = element<HTMLDialogElement>('snippet-dialog');
      element(`${kind}-cancel`).click();
      element('dialog-close').click();
      const cancel = new Event('cancel', { cancelable: true });
      dialog.dispatchEvent(cancel);
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 500, bottom: 400 } as DOMRect);
      dialog.dispatchEvent(new MouseEvent('click', { clientX: 90, clientY: 110, bubbles: true }));
      expect(cancel.defaultPrevented).toBe(true);
      expect(dialog.open).toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
      opening.resolve(first);
      await flush();
      expect(dialog.open).toBe(false);
      expect(document.activeElement).toBe(element('editor'));
      dispose!();
      vi.mocked(cloud.createPage).mockClear();
      vi.mocked(cloud.joinPage).mockClear();
      localStorage.clear();
    }
  });

  it('ignores a pending Create after navigation to a newer invitation', async () => {
    const opening = pending<TextDropPage>();
    vi.mocked(cloud.createPage).mockReturnValueOnce(opening.promise);
    await start();
    element('create').click();
    element('create-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    history.replaceState(null, '', `/textdrop/#/join/${second.code}`);
    window.dispatchEvent(new Event('hashchange'));
    expect(element('join-form').hidden).toBe(false);
    expect(element<HTMLInputElement>('join-code').value).toBe(second.code);
    opening.resolve(first);
    await flush();
    expect(element('workspace').hidden).toBe(true);
    expect(rows()).toEqual([]);
    expect(location.hash).toBe(`#/join/${second.code}`);
    expect(element<HTMLInputElement>('join-code').value).toBe(second.code);
    await join(second.code);
    expect(element('page-code').textContent).toBe(second.code);
    expect(rows()).toEqual([second.code]);
  });

  it('ignores an old opening after navigation to a different invitation and keeps the new code prefilled', async () => {
    const opening = pending<TextDropPage>();
    vi.mocked(cloud.joinPage).mockReturnValueOnce(opening.promise);
    await start();
    await join(first.code);
    history.replaceState(null, '', `/textdrop/#/join/${second.code}`);
    window.dispatchEvent(new Event('hashchange'));
    expect(element('home').hidden).toBe(false);
    expect(element<HTMLInputElement>('join-code').value).toBe(second.code);
    opening.resolve(first);
    await flush();
    expect(location.hash).toBe(`#/join/${second.code}`);
    expect(element('workspace').hidden).toBe(true);
    expect(element<HTMLInputElement>('join-code').value).toBe(second.code);
    expect(rows()).toEqual([]);
    await join(second.code);
    expect(element('page-code').textContent).toBe(second.code);
    expect(rows()).toEqual([second.code]);
  });

  it('does not issue actions without configuration or when Home is offline', async () => {
    await start('#/', false);
    expect(element<HTMLButtonElement>('create').disabled).toBe(true);
    expect(element<HTMLButtonElement>('join').disabled).toBe(true);
    expect(element('notice-message').textContent).toContain('Supabase settings');
    element('create').click();
    expect(cloud.createPage).not.toHaveBeenCalled();
    dispose!();
    new DeviceSnippets().remember(first.code);
    await start();
    window.dispatchEvent(new Event('offline'));
    root.querySelector<HTMLAnchorElement>('.snippet-open')!.click();
    await flush();
    expect(cloud.joinPage).not.toHaveBeenCalled();
    expect(element<HTMLButtonElement>('create').disabled).toBe(true);
    expect(root.querySelector('.snippet-remove')).toBeNull();
  });
});

describe('TextDrop browser history', () => {
  /** Puts one earlier entry in front of the app so a Back that leaves the app is visible. */
  async function startAfterEarlierPage(hash: string): Promise<void> {
    history.replaceState(null, '', '/textdrop/#/earlier-page');
    history.pushState(null, '', '/textdrop/#/');
    await start(hash);
  }
  async function goBack(): Promise<void> {
    history.back();
    await vi.advanceTimersByTimeAsync(10);
  }

  it('keeps Home one Back step away after Create or Open from Home', async () => {
    await startAfterEarlierPage('#/');
    const entries = history.length;
    await create();
    expect(location.hash).toBe(`#/p/${first.code}`);
    expect(history.length).toBe(entries + 1);
    await goBack();
    expect(location.hash).toBe('#/');
    expect(element('home').hidden).toBe(false);
    expect(element('workspace').hidden).toBe(true);
    expect(rows()).toEqual([first.code]);

    await join(second.code);
    expect(location.hash).toBe(`#/p/${second.code}`);
    expect(history.length).toBe(entries + 1);
    await goBack();
    expect(location.hash).toBe('#/');
    expect(element('home').hidden).toBe(false);
  });

  it('adds no extra entry when a snippet opens from an invitation link or a list link', async () => {
    await startAfterEarlierPage(`#/join/${second.code}`);
    const entries = history.length;
    await join(second.code);
    expect(location.hash).toBe(`#/p/${second.code}`);
    expect(history.length).toBe(entries);

    dispose!();
    await startAfterEarlierPage('#/');
    const home = history.length;
    root.querySelector<HTMLAnchorElement>('.snippet-open')!.click();
    await flush();
    expect(location.hash).toBe(`#/p/${second.code}`);
    expect(history.length).toBe(home + 1);
  });
});
