import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
import App from './App';
import { cloud, resetCloudDocuments, type BoardSnapshot } from './cloudMock';
import type { Board, Card } from '../domain/boards/types';
import { DeviceBoards, DEVICE_BOARDS_PREFIX } from '../infrastructure/storage/deviceBoards';

export const board: Board = {
  id: '22222222-2222-4222-8222-222222222222',
  invite_code: 'a'.repeat(32),
  title: 'Weekend plans',
  description: '',
  columns: [
    { id: 'todo', title: 'To do', color: 'slate' },
    { id: 'doing', title: 'In progress', color: 'amber' },
    { id: 'done', title: 'Done', color: 'emerald' },
  ],
  cards: [],
  revision: 1,
  created_at: '2026-10-10T01:00:00Z',
  updated_at: '2026-10-10T01:00:00Z',
};
export const card: Card = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Buy coffee',
  description: '',
  columnId: 'todo',
  position: 1024,
  priority: 'medium',
  assignee: 'Alex',
  dueDate: '',
  labels: [],
};
let root: Root | undefined;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
export function button(name: string, parent: ParentNode = document): HTMLButtonElement {
  const found = [...parent.querySelectorAll('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim() === name,
  );
  if (!found) throw new Error(`Button not found: ${name}`);
  return found;
}
export function field(name: string): HTMLInputElement | HTMLTextAreaElement {
  const label = [...document.querySelectorAll('label')].find((element) => {
    const caption = element.cloneNode(true) as HTMLLabelElement;
    caption.querySelectorAll('input, textarea, select').forEach((control) => {
      control.remove();
    });
    return caption.textContent?.replace(/\s+/g, ' ').trim() === name;
  });
  const input = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (!input) throw new Error(`Field not found: ${name}`);
  return input;
}
export async function click(name: string, parent?: ParentNode) {
  await act(async () => {
    button(name, parent).click();
  });
}
export async function fill(name: string, value: string) {
  const input = field(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search cards"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export async function select(name: string, value: string) {
  const element = document.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
export async function mount(
  boards: BoardSnapshot[] = [board],
  code = board.invite_code,
  strict = false,
  hash?: string,
) {
  window.history.replaceState(null, '', hash ? `/${hash}` : code ? `/#board/${code}` : '/');
  cloud.loadBoardList.mockResolvedValue(boards);
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root!.render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App));
  });
}
/** Build a valid UUID from a number so tests can create many distinct cards. */
export function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}
export async function choose(label: string, value: string) {
  const caption = [...document.querySelectorAll('label')].find((element) =>
    element.textContent?.replace(/\s+/g, ' ').trim().startsWith(label),
  );
  const element = caption?.querySelector('select');
  if (!element) throw new Error(`Menu not found: ${label}`);
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
export async function moveWithMenu(cardId: string, columnId: string) {
  const element = document.querySelector<HTMLSelectElement>(`#move-${cardId}`)!;
  await act(async () => {
    element.value = columnId;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
/** A minimal DataTransfer: jsdom has none, and React reads `types`, `setData` and `getData`. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    types: [] as string[],
    effectAllowed: '',
    dropEffect: '',
    setData(type: string, value: string) {
      data.set(type, value);
      this.types = [...data.keys()];
    },
    getData: (type: string) => data.get(type) ?? '',
  };
}
function dragEvent(type: string, transfer: ReturnType<typeof dataTransfer>, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  return event;
}
/** Drop above/below a card, including on one of its nested controls. */
export async function dragCardToCard(
  title: string,
  targetTitle: string,
  edge: 'before' | 'after',
  drop = true,
) {
  const tile = button(`Edit ${title}`).closest('article')!;
  const target = button(`Edit ${targetTitle}`);
  const transfer = dataTransfer();
  const clientY = edge === 'before' ? -1 : 1;
  await act(async () => {
    tile.dispatchEvent(dragEvent('dragstart', transfer));
    target.dispatchEvent(dragEvent('dragover', transfer, clientY));
  });
  if (drop)
    await act(async () => {
      target.dispatchEvent(dragEvent('drop', transfer, clientY));
    });
}
/** Drag a card tile over a column and optionally drop it there. */
export async function dragCard(title: string, columnTitle: string, drop = true, clientY = 0) {
  const tile = button(`Edit ${title}`).closest('article')!;
  const target = document.querySelector(`main section[aria-label="${columnTitle}"]`)!;
  const transfer = dataTransfer();
  await act(async () => {
    tile.dispatchEvent(dragEvent('dragstart', transfer));
  });
  await act(async () => {
    target.dispatchEvent(dragEvent('dragover', transfer, clientY));
  });
  if (drop) {
    await act(async () => {
      target.dispatchEvent(dragEvent('drop', transfer, clientY));
    });
  }
}
/** The top bar's connection text and the page footer's sync text. */
export const status = () => document.querySelector('.connection')?.textContent ?? '';
export const syncLabel = () => document.querySelector('.footer-sync')?.textContent ?? '';
/** Let fake time pass, running timers and the promises they start. */
export async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
export async function refresh() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
}
export async function removeInAnotherTab() {
  await act(async () => {
    new DeviceBoards().remove(board.invite_code);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: DEVICE_BOARDS_PREFIX + board.invite_code,
        storageArea: window.localStorage,
      }),
    );
  });
}
export async function navigateHash(hash: string) {
  await act(async () => {
    window.history.replaceState(null, '', `/${hash}`);
    window.dispatchEvent(new Event('hashchange'));
  });
}
export function columnTitles() {
  return [...document.querySelectorAll('main section[aria-label] h2')].map(
    (item) => item.textContent,
  );
}

export async function unmount() {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
}
export function installHarness() {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.resetAllMocks();
    resetCloudDocuments();
    cloud.configured = true;
    cloud.joinBoard.mockRejectedValue(new Error('Invitation unavailable'));
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
  });
  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}
