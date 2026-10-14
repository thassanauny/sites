// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceSnippet } from '../domain/snippets/model';
import { renderDeviceList, snippetAction } from './deviceList';
import { shell, shellElements } from './shell';

const first: DeviceSnippet = { code: 'a'.repeat(32), openedAt: '2026-10-10T03:00:00.000Z', name: 'Travel notes <draft>' };
const second: DeviceSnippet = { code: 'b'.repeat(32), openedAt: '2026-10-10T02:00:00.000Z' };
const third: DeviceSnippet = { code: 'c'.repeat(32), openedAt: '2026-10-10T01:00:00.000Z' };
const hrefFor = (code: string) => `#/p/${code}`;

let root: HTMLDivElement;
function draw(snippets: DeviceSnippet[]) {
  const ui = shellElements(root);
  renderDeviceList(ui, snippets, hrefFor);
  return ui;
}

function setup(): void {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector<HTMLDivElement>('#app')!;
  root.innerHTML = shell();
}
afterEach(() => {
  document.body.innerHTML = '';
});

describe('snippets on this device', () => {
  it('lists each snippet with its name or a placeholder, the short code, a link and two actions', () => {
    setup();
    const ui = draw([first, second]);
    const rows = [...ui.deviceList.children];
    expect(rows).toHaveLength(2);
    expect(ui.deviceCount.textContent).toBe('2');
    expect(ui.deviceEmpty.hidden).toBe(true);
    expect(rows.map(row => row.querySelector('.snippet-name')!.textContent)).toEqual(['Travel notes <draft>', 'Untitled snippet']);
    expect(rows.map(row => row.querySelector('code')!.textContent)).toEqual(['aaaaaa…aaaaaa', 'bbbbbb…bbbbbb']);
    expect(rows[0]!.querySelector('.snippet-name draft')).toBeNull();
    const link = rows[1]!.querySelector<HTMLAnchorElement>('.snippet-open')!;
    expect(link.getAttribute('href')).toBe(`#/p/${second.code}`);
    expect(link.dataset.code).toBe(second.code);
    expect(rows[1]!.querySelectorAll('.snippet-rename, .snippet-remove')).toHaveLength(2);
    expect(rows[0]!.querySelector('time')!.dateTime).toBe(first.openedAt);
  });

  it('labels links and actions by name, or by short code, and never by the full code', () => {
    setup();
    draw([first, second]);
    const labels = [...root.querySelectorAll('.snippet-open, .snippet-rename, .snippet-remove')].map(control => control.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Open Travel notes <draft>',
      'Rename Travel notes <draft>',
      'Remove Travel notes <draft> from this device',
      'Open snippet bbbbbb…bbbbbb',
      'Rename snippet bbbbbb…bbbbbb',
      'Remove snippet bbbbbb…bbbbbb from this device',
    ]);
    const attributes = [...root.querySelectorAll('#device-list *')]
      .flatMap(item => [...item.attributes])
      .filter(attribute => !['href', 'data-code'].includes(attribute.name) && /[a-f\d]{32}/.test(attribute.value));
    expect(attributes).toEqual([]);
  });

  it('shows the empty message and no count for an empty list and replaces earlier rows', () => {
    setup();
    const ui = draw([first]);
    expect(ui.deviceList.children).toHaveLength(1);
    draw([]);
    expect(ui.deviceList.children).toHaveLength(0);
    expect(ui.deviceEmpty.hidden).toBe(false);
    expect(ui.deviceCount.textContent).toBe('');
  });

  it('keeps focus on the same action of the same snippet when the list is drawn again', () => {
    setup();
    draw([first, second, third]);
    const rename = root.querySelectorAll<HTMLButtonElement>('.snippet-rename')[1]!;
    rename.focus();
    draw([first, second, third]);
    expect(document.activeElement).not.toBe(rename);
    expect(document.activeElement?.classList.contains('snippet-rename')).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.code).toBe(second.code);
    const link = root.querySelectorAll<HTMLAnchorElement>('.snippet-open')[2]!;
    link.focus();
    draw([third, second, first]);
    expect(document.activeElement?.classList.contains('snippet-open')).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.code).toBe(third.code);
  });

  it('moves focus to the nearest row when the focused snippet disappears, or to the heading when none is left', () => {
    setup();
    const ui = draw([first, second, third]);
    root.querySelectorAll<HTMLButtonElement>('.snippet-remove')[1]!.focus();
    draw([first, third]);
    expect((document.activeElement as HTMLElement).dataset.code).toBe(third.code);
    expect(document.activeElement?.classList.contains('snippet-remove')).toBe(true);
    root.querySelectorAll<HTMLButtonElement>('.snippet-remove')[1]!.focus();
    draw([first]);
    expect((document.activeElement as HTMLElement).dataset.code).toBe(first.code);
    root.querySelector<HTMLButtonElement>('.snippet-rename')!.focus();
    draw([]);
    expect(document.activeElement).toBe(ui.deviceHeading);
  });

  it('does not take focus from elsewhere on the page', () => {
    setup();
    const ui = draw([first]);
    ui.create.focus();
    draw([first, second]);
    expect(document.activeElement).toBe(ui.create);
  });

  it('tells the three kinds of row action apart', () => {
    setup();
    draw([first]);
    expect(snippetAction(root.querySelector('.snippet-open'))).toBe('snippet-open');
    expect(snippetAction(root.querySelector('.snippet-rename'))).toBe('snippet-rename');
    expect(snippetAction(root.querySelector('.snippet-remove'))).toBe('snippet-remove');
    expect(snippetAction(null)).toBe('snippet-remove');
  });
});
