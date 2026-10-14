import { renderDeviceList } from '../ui/deviceList';
import { shell, shellElements } from '../ui/shell';
import { countLines, exceedsLimit, exportFileName, type DeviceSnippet } from '../domain/snippets/model';
import { DialogController } from './dialogs';
import { errorMessage } from './errorMessage';
import { PageSession } from './PageSession';
import type { Cloud, DeviceList } from './ports';
import { RefreshScheduler } from './refreshScheduler';
import { invitationLink, joinCode, pageHash, readRoute } from './routes';

const DEVICE_READ_FAILED = 'Could not read snippets saved on this device.';

/** Redrawing happens at every keystroke, so text that did not change is left alone. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function mountTextDrop(root: HTMLElement, cloud: Cloud, deviceSnippets: DeviceList, options: { configured: boolean; version: string }): () => void {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  root.innerHTML = shell();
  const ui = shellElements(root);
  const editor = ui.editor;
  const codeInput = ui.joinCode;
  const { configured, version } = options;
  const session = new PageSession(cloud);
  const refreshes = new RefreshScheduler(
    () => session.refresh(),
    () => document.visibilityState === 'visible',
  );
  let rememberedSnippets: DeviceSnippet[] = [];
  let deviceReadError = '';
  let deviceWriteError = '';
  let uiError = '';
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let currentHash = location.hash;
  let loadingLink = false;
  const dialog = ui.dialog;
  const dialogs = new DialogController({
    ui,
    root,
    session,
    nameOf: code => rememberedSnippets.find(snippet => snippet.code === code)?.name ?? '',
    render: () => {
      render();
    },
    clearNotice: () => {
      uiError = '';
    },
    showHomeAddress,
  });

  ui.version.textContent = `v${version}`;

  /** Puts Home in the address bar without adding a history entry. */
  function showHomeAddress(): void {
    currentHash = '#/';
    history.replaceState(null, '', currentHash);
  }

  function showToast(message: string): void {
    clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    toastTimer = setTimeout(() => {
      ui.toast.hidden = true;
    }, 2400);
  }

  function renderDeviceSnippets(): void {
    renderDeviceList(ui, rememberedSnippets, pageHash);
  }

  function updateDeviceSnippets(action: () => DeviceSnippet[], writing = false): boolean {
    try {
      const next = action();
      deviceReadError = '';
      if (writing) deviceWriteError = '';
      if (JSON.stringify(next) !== JSON.stringify(rememberedSnippets)) {
        rememberedSnippets = next;
        renderDeviceSnippets();
      }
      render();
      return true;
    } catch (error) {
      const message = errorMessage(error, 'This browser could not update your snippet list.');
      if (writing) deviceWriteError = `${message} Keep the snippet code to open it again.`;
      else deviceReadError = message;
      render();
      return false;
    }
  }

  function rememberCurrentSnippet(expected?: string | null): boolean {
    const page = session.state.page;
    return page ? updateDeviceSnippets(() => deviceSnippets.remember(page.code, expected), true) : false;
  }

  /** Counting is O(text), so remember the result until the text changes. */
  let measured: { text: string; lines: number; tooLarge: boolean } | undefined;
  function measure(text: string): { lines: number; tooLarge: boolean } {
    if (measured?.text !== text) measured = { text, lines: countLines(text), tooLarge: exceedsLimit(text) };
    return measured;
  }

  /**
   * The visible status changes at every step, so it is not a live region. Screen readers hear
   * only a finished save here; failures reach them through the alert notice.
   */
  let lastStatus = '';
  function announceSave(status: string): void {
    const announcement = ui.saveAnnouncement;
    if (status !== 'All changes saved') {
      if (announcement.textContent) announcement.textContent = '';
    } else if (lastStatus === 'Saving…') {
      announcement.textContent = status;
    }
    lastStatus = status;
  }

  /** Formatting a time is slow next to the rest of a redraw, so keep the label until the page is saved again. */
  let savedLabel: { updatedAt: string; text: string } | undefined;
  function lastSaved(updatedAt: string): string {
    if (savedLabel?.updatedAt !== updatedAt) {
      savedLabel = { updatedAt, text: `Last saved ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` };
    }
    return savedLabel.text;
  }

  function render(): void {
    const { page, draft, phase, dirty, error, online, sessionDamaged } = session.state;
    const opening = phase === 'opening';
    ui.home.hidden = Boolean(page);
    ui.workspace.hidden = !page;
    ui.connection.classList.toggle('disconnected', !online);
    setText(ui.connectionLabel, online ? 'Online' : 'Offline');
    ui.create.disabled = opening || !online || !configured;
    ui.join.disabled = opening || !online || !configured;
    const openingDialog = dialogs.opening;
    codeInput.disabled = opening;
    for (const button of [ui.createConfirm, ui.joinConfirm]) button.disabled = opening || !online || !configured;
    for (const button of [ui.createCancel, ui.joinCancel, ui.dialogClose]) button.disabled = openingDialog && opening;
    setText(ui.createLabel, opening && !loadingLink ? 'Creating…' : 'Create snippet');
    setText(ui.joinLabel, opening && loadingLink ? 'Opening…' : 'Open snippet');
    if (!page) {
      // The snippet list is hidden while a snippet is open; showing Home draws again.
      for (const open of root.querySelectorAll<HTMLAnchorElement>('.snippet-open')) {
        const disabled = opening || !online || !configured;
        open.setAttribute('aria-disabled', String(disabled));
        open.tabIndex = disabled ? -1 : 0;
      }
      for (const action of root.querySelectorAll<HTMLButtonElement>('.snippet-remove, .snippet-rename')) action.disabled = opening;
    }

    if (page) {
      const name = rememberedSnippets.find(snippet => snippet.code === page.code)?.name || 'Shared snippet';
      setText(ui.pageName, name);
      if (document.title !== `${name} — TextDrop`) document.title = `${name} — TextDrop`;
      setText(ui.pageCode, page.code);
      if (editor.value !== draft) editor.value = draft;
      editor.disabled = !online;
      const { lines, tooLarge } = measure(draft);
      setText(ui.textCount, `${draft.length.toLocaleString()} characters · ${lines.toLocaleString()} lines${tooLarge ? ' · over 1 MiB limit' : ''}`);
      ui.textCount.classList.toggle('over-limit', tooLarge);
      const status = !online ? 'Offline · editing paused' : phase === 'saving' ? 'Saving…' : dirty ? (error ? 'Not saved' : 'Unsaved changes…') : error ? 'Sync unavailable' : 'All changes saved';
      setText(ui.saveStatus, status);
      announceSave(status);
      ui.saveStatus.classList.toggle('unsaved', dirty || Boolean(error) || !online);
      setText(ui.updatedAt, lastSaved(page.updatedAt));
    } else {
      if (document.title !== 'TextDrop — share text') document.title = 'TextDrop — share text';
      announceSave('');
    }
    const notice =
      uiError ||
      (!openingDialog ? error : '') ||
      deviceWriteError ||
      deviceReadError ||
      (!configured ? 'Sharing needs Supabase settings. Add the public project settings, then restart this app.' : '') ||
      (!online ? 'Reconnect to create, open, or edit a page. Text is not stored on this device.' : '');
    ui.notice.hidden = !notice;
    ui.noticeMessage.textContent = notice;
    ui.retry.hidden = !page || !dirty || !online || phase === 'saving' || measure(draft).tooLarge;
    ui.newSession.hidden = !(sessionDamaged && notice === error);
    dialogs.render({ page, dirty, phase, sessionError: error, sessionDamaged, online, configured });
  }

  renderDeviceSnippets();
  updateDeviceSnippets(() => deviceSnippets.list());
  session.subscribe(render);
  session.setOnline(navigator.onLine);

  function navigateToPage(expected?: string | null): void {
    if (!session.state.page) return;
    if (dialogs.opening) dialogs.close(true, false);
    const remembered = rememberCurrentSnippet(expected);
    try {
      if (deviceSnippets.isRemoved(session.state.page.code)) {
        codeInput.value = session.state.page.code;
        session.home();
        showHomeAddress();
        uiError = remembered ? 'This snippet was removed from this device while opening. Choose Open a snippet to open it again.' : deviceWriteError || deviceReadError;
        render();
        ui.join.focus();
        return;
      }
    } catch (error) {
      deviceReadError = errorMessage(error, DEVICE_READ_FAILED);
      render();
    }
    // Create and Open add a history entry so Back returns to the list. Links and invitations already have one.
    const fromHome = readRoute(currentHash).kind === 'home';
    currentHash = pageHash(session.state.page.code);
    if (fromHome) history.pushState(null, '', currentHash);
    else history.replaceState(null, '', currentHash);
    refreshes.activity();
    editor.focus();
  }

  ui.create.addEventListener(
    'click',
    () => {
      dialogs.show('create');
    },
    { signal },
  );
  ui.join.addEventListener(
    'click',
    () => {
      dialogs.show('join');
    },
    { signal },
  );
  ui.createForm.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      if (dialogs.kind !== 'create' || session.state.phase === 'opening' || !session.state.online || !configured) return;
      uiError = '';
      dialogs.error = '';
      loadingLink = false;
      void session.create().then(opened => {
        if (opened) navigateToPage();
      });
    },
    { signal },
  );

  ui.joinForm.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      if (dialogs.kind !== 'join' || session.state.phase === 'opening' || !session.state.online || !configured) return;
      uiError = '';
      dialogs.error = '';
      try {
        const code = joinCode(codeInput.value);
        const expected = deviceSnippets.snapshot(code);
        loadingLink = true;
        void session.join(code).then(opened => {
          if (opened) navigateToPage(expected);
        });
      } catch (error) {
        dialogs.error = errorMessage(error, 'Check the invitation code and try again.');
        render();
        codeInput.focus();
      }
    },
    { signal },
  );

  ui.deviceList.addEventListener(
    'click',
    event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const rename = target.closest<HTMLButtonElement>('.snippet-rename');
      if (rename?.dataset.code && !rename.disabled) {
        dialogs.show('rename', rename.dataset.code);
        return;
      }
      const open = target.closest<HTMLAnchorElement>('.snippet-open');
      if (open && (session.state.phase === 'opening' || !session.state.online || !configured)) {
        event.preventDefault();
        return;
      }
      if (open && new URL(open.href).hash === location.hash && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        void route();
        return;
      }
      const remove = target.closest<HTMLButtonElement>('.snippet-remove');
      const code = remove?.dataset.code;
      if (!code) return;
      dialogs.show('remove', code);
    },
    { signal },
  );

  editor.addEventListener(
    'input',
    () => {
      uiError = '';
      refreshes.activity();
      session.edit(editor.value);
    },
    { signal },
  );
  editor.addEventListener(
    'keydown',
    event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void session.save();
      }
    },
    { signal },
  );
  ui.retry.addEventListener(
    'click',
    () => {
      uiError = '';
      void session.save();
    },
    { signal },
  );
  for (const button of [ui.newSession, ui.dialogNewSession]) {
    button.addEventListener(
      'click',
      () => {
        void session.startNewSession().then(started => {
          if (signal.aborted) return;
          if (!started) {
            (dialogs.opening ? ui.dialogNewSession : ui.newSession).focus();
            return;
          }
          showToast('New session ready. Try again.');
          (dialogs.kind === 'join' ? codeInput : dialogs.kind === 'create' ? ui.createConfirm : session.state.page ? editor : ui.create).focus();
        });
      },
      { signal },
    );
  }

  async function copy(value: string, message: string): Promise<void> {
    const attempt = dialogs.startCopy();
    const pageId = session.state.page?.id;
    const current = () => !signal.aborted && dialogs.isCurrentCopy(attempt) && pageId === session.state.page?.id;
    uiError = '';
    dialogs.error = '';
    render();
    try {
      await navigator.clipboard.writeText(value);
      if (current()) showToast(message);
    } catch {
      if (!current()) return;
      uiError = 'Your browser could not copy automatically. Select the text or snippet code and copy it manually.';
      if (dialogs.kind) dialogs.error = uiError;
      render();
    }
  }
  ui.share.addEventListener(
    'click',
    () => {
      dialogs.show('invite');
    },
    { signal },
  );
  ui.settings.addEventListener(
    'click',
    () => {
      dialogs.show('settings');
    },
    { signal },
  );
  ui.settingsRename.addEventListener(
    'click',
    () => {
      dialogs.show('rename');
    },
    { signal },
  );
  ui.settingsRemove.addEventListener(
    'click',
    () => {
      dialogs.show('remove');
    },
    { signal },
  );
  ui.renameForm.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      if (dialogs.kind !== 'rename') return;
      if (!updateDeviceSnippets(() => deviceSnippets.rename(dialogs.code, ui.snippetNameInput.value), true)) {
        dialogs.error = deviceWriteError;
        render();
        return;
      }
      dialogs.close();
      showToast('Name saved on this device');
    },
    { signal },
  );
  for (const button of [ui.dialogClose, ui.createCancel, ui.joinCancel, ui.removeCancel, ui.renameCancel])
    button.addEventListener(
      'click',
      () => {
        dialogs.close();
      },
      { signal },
    );
  dialog.addEventListener(
    'cancel',
    event => {
      event.preventDefault();
      dialogs.close();
    },
    { signal },
  );
  dialog.addEventListener(
    'click',
    event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialogs.close();
    },
    { signal },
  );
  for (const input of [ui.inviteCode, ui.removeCode])
    input.addEventListener(
      'focus',
      event => {
        (event.currentTarget as HTMLInputElement).select();
      },
      { signal },
    );
  for (const button of [ui.inviteCopyCode, ui.removeCopyCode])
    button.addEventListener(
      'click',
      () => {
        void copy(dialogs.code, 'Invitation code copied');
      },
      { signal },
    );
  ui.inviteCopyLink.addEventListener(
    'click',
    () => {
      void copy(invitationLink(dialogs.code, location.href), 'Invite link copied');
    },
    { signal },
  );
  ui.removeCopyText.addEventListener(
    'click',
    () => {
      void copy(session.state.draft, 'Text copied');
    },
    { signal },
  );
  ui.removeDiscard.addEventListener('change', render, { signal });
  ui.removeForm.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      if (dialogs.kind !== 'remove' || ui.removeConfirm.disabled) return;
      const index = rememberedSnippets.findIndex(snippet => snippet.code === dialogs.code);
      if (!updateDeviceSnippets(() => deviceSnippets.remove(dialogs.code), true)) {
        dialogs.error = deviceWriteError;
        render();
        return;
      }
      const removingCurrent = session.state.page?.code === dialogs.code;
      dialogs.close();
      if (removingCurrent) {
        showHomeAddress();
        session.home();
      }
      const remaining = ui.deviceList.querySelectorAll<HTMLButtonElement>('.snippet-remove');
      (remaining[Math.min(index, remaining.length - 1)] ?? ui.deviceHeading).focus();
      showToast('Snippet removed from this device');
    },
    { signal },
  );
  ui.copyCode.addEventListener(
    'click',
    () => {
      if (session.state.page) void copy(session.state.page.code, 'Snippet code copied');
    },
    { signal },
  );
  ui.copyText.addEventListener(
    'click',
    () => {
      void copy(session.state.draft, 'Text copied');
    },
    { signal },
  );
  ui.download.addEventListener(
    'click',
    () => {
      const page = session.state.page;
      if (!page) return;
      const url = URL.createObjectURL(new Blob([session.state.draft], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFileName(rememberedSnippets.find(snippet => snippet.code === page.code)?.name, new Date());
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    },
    { signal },
  );

  async function route(): Promise<void> {
    const nextHash = location.hash;
    if (session.state.dirty) {
      if (!window.confirm('This page has unsaved changes. Leave and discard them?')) {
        history.replaceState(null, '', currentHash || '#/');
        return;
      }
    }
    currentHash = nextHash;
    uiError = '';
    if (dialogs.kind) dialogs.close(true, false);
    const next = readRoute(nextHash);
    if (next.kind === 'home') {
      updateDeviceSnippets(() => deviceSnippets.list());
      session.home();
      ui.create.focus();
    } else if (next.kind === 'page') {
      let expected: string | null;
      try {
        expected = deviceSnippets.snapshot(next.code);
        if (deviceSnippets.isRemoved(next.code)) {
          session.home();
          codeInput.value = next.code;
          uiError = 'This snippet was removed from this device. Choose Open a snippet to open it again with its code.';
          render();
          ui.join.focus();
          return;
        }
      } catch (error) {
        session.home();
        uiError = errorMessage(error, DEVICE_READ_FAILED);
        render();
        return;
      }
      loadingLink = true;
      codeInput.value = next.code;
      if (await session.join(next.code)) {
        navigateToPage(expected);
      }
    } else if (next.kind === 'join') {
      session.home();
      codeInput.value = next.code;
      dialogs.show('join');
    } else {
      session.home();
      uiError = 'That invitation link is invalid. Paste a complete snippet code to open it.';
      render();
    }
  }

  window.addEventListener(
    'hashchange',
    () => {
      void route();
    },
    { signal },
  );
  window.addEventListener(
    'offline',
    () => {
      session.setOnline(false);
    },
    { signal },
  );
  window.addEventListener(
    'online',
    () => {
      session.setOnline(true);
      void refreshes.wake();
    },
    { signal },
  );
  function refreshDeviceSnippets(): void {
    if (!updateDeviceSnippets(() => deviceSnippets.list())) return;
    const page = session.state.page;
    if (!page) return;
    try {
      if (!deviceSnippets.isRemoved(page.code)) return;
      if (session.state.dirty) {
        uiError = 'This snippet was removed from this device in another tab. Your unsaved text stays in this open page; copy or save it before leaving.';
        render();
      } else {
        if (dialogs.kind) dialogs.close();
        session.home();
        showHomeAddress();
        ui.join.focus();
      }
    } catch (error) {
      deviceReadError = errorMessage(error, DEVICE_READ_FAILED);
      render();
    }
  }
  window.addEventListener(
    'focus',
    () => {
      refreshDeviceSnippets();
      void refreshes.wake();
    },
    { signal },
  );
  window.addEventListener(
    'storage',
    event => {
      if (deviceSnippets.changedBy(event.key)) refreshDeviceSnippets();
    },
    { signal },
  );
  window.addEventListener(
    'beforeunload',
    event => {
      if (session.state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
    { signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') {
        refreshDeviceSnippets();
        void refreshes.wake();
      } else {
        void session.flush();
      }
    },
    { signal },
  );
  // Phones often skip `beforeunload`; send what is still waiting for the autosave timer.
  window.addEventListener(
    'pagehide',
    () => {
      void session.flush();
    },
    { signal },
  );
  refreshes.start();
  void route();

  return () => {
    lifecycle.abort();
    refreshes.stop();
    clearTimeout(toastTimer);
    session.dispose();
    if (dialog.open) dialog.close();
    root.replaceChildren();
  };
}
