import { shortCode, type DeviceSnippet } from '../domain/snippets/model';
import { icon } from './icons';
import type { ShellElements } from './shell';

type SnippetAction = 'snippet-open' | 'snippet-rename';

/** Which action of a list row an element is, so focus can return to the same kind of control. */
export function snippetAction(item: Element | null | undefined): SnippetAction {
  return item?.classList.contains('snippet-rename') ? 'snippet-rename' : 'snippet-open';
}

/** Redraws "Your snippets". Keyboard focus stays on the same action of the same snippet, or the nearest row. */
export function renderDeviceList(ui: Pick<ShellElements, 'deviceList' | 'deviceEmpty' | 'deviceCount' | 'deviceHeading'>, snippets: DeviceSnippet[], hrefFor: (code: string) => string): void {
  const list = ui.deviceList;
  const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
  const focusedAction = snippetAction(focused);
  const focusedIndex = focused ? [...list.children].findIndex(row => row.contains(focused)) : -1;
  list.replaceChildren();
  ui.deviceEmpty.hidden = snippets.length > 0;
  ui.deviceCount.textContent = snippets.length ? String(snippets.length) : '';
  for (const snippet of snippets) {
    const row = document.createElement('li');
    row.className = 'device-row';
    const mark = document.createElement('span');
    mark.className = 'snippet-mark';
    mark.innerHTML = icon('document');
    const details = document.createElement('div');
    details.className = 'snippet-details';
    const name = document.createElement('span');
    name.className = 'snippet-name';
    name.textContent = snippet.name || 'Untitled snippet';
    name.title = name.textContent;
    // Labels and tooltips name a snippet by its device name, else by the short code: the full code is the credential.
    const label = snippet.name || `snippet ${shortCode(snippet.code)}`;
    const code = document.createElement('code');
    code.textContent = shortCode(snippet.code);
    const opened = document.createElement('time');
    opened.dateTime = snippet.openedAt;
    opened.textContent = `Last opened ${new Date(snippet.openedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    const metadata = document.createElement('span');
    metadata.className = 'snippet-metadata';
    metadata.append(code, opened);
    details.append(name, metadata);
    const open = document.createElement('a');
    open.className = 'snippet-open';
    open.href = hrefFor(snippet.code);
    open.dataset.code = snippet.code;
    open.title = `Open ${label}`;
    open.setAttribute('aria-label', `Open ${label}`);
    const action = document.createElement('span');
    action.className = 'snippet-cta';
    action.innerHTML = `Open ${icon('arrow')}`;
    open.append(mark, details, action);
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'icon-button snippet-rename';
    rename.dataset.code = snippet.code;
    rename.innerHTML = icon('rename');
    rename.title = 'Snippet name (optional)';
    rename.setAttribute('aria-label', `Rename ${label}`);
    const actions = document.createElement('div');
    actions.className = 'snippet-actions';
    actions.append(rename);
    row.append(open, actions);
    list.append(row);
  }
  if (focused) {
    const actions = [...list.querySelectorAll<HTMLElement>(`.${focusedAction}`)];
    const matching = actions.find(action => action.dataset.code === focused.dataset.code);
    (matching ?? actions[Math.min(focusedIndex, actions.length - 1)] ?? ui.deviceHeading).focus();
  }
}
