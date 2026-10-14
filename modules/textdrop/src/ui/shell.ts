import { MAX_SNIPPET_NAME_LENGTH } from '../domain/snippets/model';
import { icon } from './icons';

export function shell(): string {
  return `
    <div class="shell">
      <header class="site-header">
        <a class="brand" href="#/" aria-label="TextDrop home"><img src="./logo.svg" alt="" width="36" height="36" /><span>textdrop<span class="brand-dot">.</span></span></a>
        <span class="header-note">Shared text, one code away</span>
        <span class="online-indicator" id="connection"><span class="dot"></span><span id="connection-label">Online</span></span>
      </header>
      <main>
        <section id="home" class="home">
          <div class="intro">
            <span class="eyebrow"><span class="tiny-line"></span> TEXT · NOTES · SNIPPETS</span>
            <h1>Copy here.<br />Open <em>anywhere.</em></h1>
            <p class="lead">Share text with others or open it on another device. One page, one code.</p>
            <div class="hero-actions">
              <button class="button primary" id="create">${icon('plus')}Create a snippet</button>
              <button class="button secondary" id="join">${icon('link')}Open a snippet</button>
            </div>
            <p class="quiet small">No account to create. Just text to pass along.</p>
          </div>
          <div class="hero-visual">
            <div class="paper-illustration" aria-hidden="true"><div class="paper back-paper"></div><div class="paper front-paper"><span class="paper-mark">{ }</span><span class="paper-line long"></span><span class="paper-line"></span><span class="paper-line medium"></span><div class="paper-sticker">${icon('link')}</div></div><span class="illustration-spark">✳</span></div>
            <p>One code. Shared text.</p>
          </div>
          <section class="device-snippets" aria-labelledby="device-heading">
            <div class="device-heading"><h2 id="device-heading" tabindex="-1">Snippets on this device</h2><span id="device-count" class="device-count"></span></div>
            <p class="device-guidance">Give snippets a name to find them easily. Names stay on this device; share the code to share the text.</p>
            <ul class="device-list" id="device-list"></ul>
            <p class="device-empty" id="device-empty">Snippets you create or open will appear here.</p>
          </section>
          <div class="home-notes"><span>${icon('check')} Saves as you type</span><span>${icon('link')} Share one code</span><span>${icon('check')} Latest save wins</span></div>
        </section>
        <section id="workspace" class="workspace" hidden aria-label="Shared snippet">
          <div class="workspace-heading"><a class="back-link" href="#/">${icon('back')}Home</a><span class="workspace-kind">SHARED SNIPPET</span></div>
          <div class="page-header">
            <div><h1><span id="page-name">Shared snippet</span><span class="brand-dot">.</span></h1><p>A shared space for your text. Everyone with the code can edit.</p></div>
            <div class="page-actions"><button class="button primary" id="share">${icon('link')}Invite</button><button class="icon-button" id="settings" aria-label="Snippet settings" title="Snippet settings">${icon('settings')}</button></div>
          </div>
          <div class="code-strip"><span class="code-label">SNIPPET CODE</span><code id="page-code"></code><button class="icon-button" id="copy-code" aria-label="Copy snippet code" title="Copy snippet code">${icon('copy')}</button><span class="code-hint">Keep this code to open your snippet again.</span></div>
          <div class="editor-card">
            <div class="editor-toolbar"><span class="document-label"><span class="document-dot"></span>Plain text</span><div class="editor-actions"><button class="text-button" id="copy-text">${icon('copy')}Copy text</button><button class="text-button" id="download">${icon('download')}Download</button></div></div>
            <label class="sr-only" for="editor">Shared snippet text</label>
            <textarea id="editor" spellcheck="false" placeholder="Write or paste your text here…" aria-describedby="save-status editor-guidance"></textarea>
            <div class="editor-footer"><span id="save-status"></span><span id="text-count"></span><span id="save-announcement" class="sr-only" role="status" aria-live="polite"></span></div>
          </div>
          <div class="workspace-notes"><p id="editor-guidance">Changes save automatically. If two people edit, the latest saved text wins.</p><span id="updated-at"></span></div>
        </section>
        <div class="notice" id="notice" hidden><p id="notice-message" role="alert"></p><button class="button small-button" id="retry" hidden>Retry save</button><button class="button small-button" id="new-session" hidden>Start a new session</button></div>
      </main>
      <footer class="site-footer"><span>Your text, within reach.</span><span>textdrop <span id="version"></span></span></footer>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
    <dialog id="snippet-dialog" aria-labelledby="dialog-title">
      <div class="dialog-heading"><h2 id="dialog-title"></h2><button type="button" class="icon-button" id="dialog-close" aria-label="Close dialog">×</button></div>
      <form id="create-form" class="dialog-stack" hidden>
        <p>Start with a blank page, then add your text. Share its code or link with others, or open it on another device.</p>
        <div class="dialog-actions"><button type="button" class="button" id="create-cancel">Cancel</button><button type="submit" class="button primary" id="create-confirm">${icon('plus')}<span id="create-label">Create snippet</span></button></div>
      </form>
      <form id="join-form" class="dialog-stack" hidden>
        <p>Paste a snippet’s invitation code or link. No account needed.</p>
        <label for="join-code">Invitation code or link</label>
        <input id="join-code" name="code" type="text" placeholder="Paste your invitation here" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="2048" required />
        <p class="dialog-note">Anyone with the code can read and edit the text. Share it with people you trust.</p>
        <div class="dialog-actions"><button type="button" class="button" id="join-cancel">Cancel</button><button type="submit" class="button primary" id="join-confirm">${icon('arrow')}<span id="join-label">Open snippet</span></button></div>
      </form>
      <section id="invite-panel" class="dialog-stack" hidden>
        <p>Invite someone to this snippet.</p>
        <label for="invite-code">Invitation code</label><input id="invite-code" readonly />
        <button type="button" class="button primary" id="invite-copy-code">${icon('copy')}Copy invitation code</button>
        <button type="button" class="button" id="invite-copy-link">${icon('link')}Copy invite link</button>
        <p class="dialog-note">Anyone with this code can join and edit this snippet. Share it with people you trust.</p>
      </section>
      <section id="settings-panel" class="dialog-stack" hidden>
        <button type="button" class="button" id="settings-rename">${icon('rename')}Name on this device</button>
        <p>Remove this snippet from your list on this device. Everyone else keeps access.</p>
        <button type="button" class="button" id="settings-remove">${icon('remove')}Remove from this device</button>
      </section>
      <form id="rename-form" class="dialog-stack" hidden>
        <p>A name makes this snippet easier to find. Only this device sees it.</p>
        <label for="snippet-name-input">Name on this device</label>
        <input id="snippet-name-input" name="name" type="text" placeholder="e.g. Travel notes" autocomplete="off" maxlength="${MAX_SNIPPET_NAME_LENGTH}" aria-describedby="rename-guidance" />
        <p id="rename-guidance" class="dialog-note">Leave blank to clear the name. The shared text and invitation code stay the same.</p>
        <div class="dialog-actions"><button type="button" class="button" id="rename-cancel">Cancel</button><button type="submit" class="button primary" id="rename-confirm">Save name</button></div>
      </form>
      <form id="remove-form" class="dialog-stack" hidden>
        <p>This removes the snippet from your list on this device. Shared text and everyone else’s access stay available.</p>
        <label for="remove-code">Invitation code</label><input id="remove-code" readonly />
        <p class="dialog-note">Keep this code to rejoin later.</p>
        <button type="button" class="button" id="remove-copy-code">${icon('copy')}Copy invitation code</button>
        <div id="remove-unsaved" class="dialog-warning" hidden>
          <p>Your unsaved text exists only in this open page. Copy it or save it before removing the snippet.</p>
          <button type="button" class="text-button" id="remove-copy-text">${icon('copy')}Copy unsaved text</button>
          <label class="discard-label"><input id="remove-discard" type="checkbox" />Discard my unsaved text</label>
        </div>
        <p id="remove-saving" class="dialog-note" hidden>Wait for the current save to finish before removing this snippet.</p>
        <div class="dialog-actions"><button type="button" class="button" id="remove-cancel">Keep on this device</button><button type="submit" class="button primary" id="remove-confirm">Remove from this device</button></div>
      </form>
      <p id="dialog-error" class="dialog-error" role="alert" hidden></p>
      <button type="button" class="button small-button dialog-new-session" id="dialog-new-session" hidden>Start a new session</button>
    </dialog>
  `;
}

/** The template elements the app code uses, looked up once so a mistyped id fails at start-up, not on first use. */
export function shellElements(root: HTMLElement) {
  const get = <T extends HTMLElement>(id: string): T => {
    const found = root.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`The TextDrop page is missing #${id}.`);
    return found;
  };
  return {
    connection: get<HTMLElement>('connection'),
    connectionLabel: get<HTMLElement>('connection-label'),
    home: get<HTMLElement>('home'),
    create: get<HTMLButtonElement>('create'),
    join: get<HTMLButtonElement>('join'),
    deviceHeading: get<HTMLElement>('device-heading'),
    deviceCount: get<HTMLElement>('device-count'),
    deviceList: get<HTMLElement>('device-list'),
    deviceEmpty: get<HTMLElement>('device-empty'),
    workspace: get<HTMLElement>('workspace'),
    pageName: get<HTMLElement>('page-name'),
    share: get<HTMLButtonElement>('share'),
    settings: get<HTMLButtonElement>('settings'),
    pageCode: get<HTMLElement>('page-code'),
    copyCode: get<HTMLButtonElement>('copy-code'),
    copyText: get<HTMLButtonElement>('copy-text'),
    download: get<HTMLButtonElement>('download'),
    editor: get<HTMLTextAreaElement>('editor'),
    saveStatus: get<HTMLElement>('save-status'),
    textCount: get<HTMLElement>('text-count'),
    saveAnnouncement: get<HTMLElement>('save-announcement'),
    updatedAt: get<HTMLElement>('updated-at'),
    notice: get<HTMLElement>('notice'),
    noticeMessage: get<HTMLElement>('notice-message'),
    retry: get<HTMLButtonElement>('retry'),
    newSession: get<HTMLButtonElement>('new-session'),
    dialogNewSession: get<HTMLButtonElement>('dialog-new-session'),
    version: get<HTMLElement>('version'),
    toast: get<HTMLElement>('toast'),
    dialog: get<HTMLDialogElement>('snippet-dialog'),
    dialogTitle: get<HTMLElement>('dialog-title'),
    dialogClose: get<HTMLButtonElement>('dialog-close'),
    createForm: get<HTMLFormElement>('create-form'),
    createCancel: get<HTMLButtonElement>('create-cancel'),
    createConfirm: get<HTMLButtonElement>('create-confirm'),
    createLabel: get<HTMLElement>('create-label'),
    joinForm: get<HTMLFormElement>('join-form'),
    joinCode: get<HTMLInputElement>('join-code'),
    joinCancel: get<HTMLButtonElement>('join-cancel'),
    joinConfirm: get<HTMLButtonElement>('join-confirm'),
    joinLabel: get<HTMLElement>('join-label'),
    invitePanel: get<HTMLElement>('invite-panel'),
    inviteCode: get<HTMLInputElement>('invite-code'),
    inviteCopyCode: get<HTMLButtonElement>('invite-copy-code'),
    inviteCopyLink: get<HTMLButtonElement>('invite-copy-link'),
    settingsPanel: get<HTMLElement>('settings-panel'),
    settingsRename: get<HTMLButtonElement>('settings-rename'),
    settingsRemove: get<HTMLButtonElement>('settings-remove'),
    renameForm: get<HTMLFormElement>('rename-form'),
    snippetNameInput: get<HTMLInputElement>('snippet-name-input'),
    renameCancel: get<HTMLButtonElement>('rename-cancel'),
    renameConfirm: get<HTMLButtonElement>('rename-confirm'),
    removeForm: get<HTMLFormElement>('remove-form'),
    removeCode: get<HTMLInputElement>('remove-code'),
    removeCopyCode: get<HTMLButtonElement>('remove-copy-code'),
    removeUnsaved: get<HTMLElement>('remove-unsaved'),
    removeCopyText: get<HTMLButtonElement>('remove-copy-text'),
    removeDiscard: get<HTMLInputElement>('remove-discard'),
    removeSaving: get<HTMLElement>('remove-saving'),
    removeCancel: get<HTMLButtonElement>('remove-cancel'),
    removeConfirm: get<HTMLButtonElement>('remove-confirm'),
    dialogError: get<HTMLElement>('dialog-error'),
  };
}
export type ShellElements = ReturnType<typeof shellElements>;
