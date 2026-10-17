import { afterEach, beforeEach, vi } from 'vitest';
import { readRoute } from '../src/application/routes';
import { RecoveryDrafts } from '../src/infrastructure/storage/recoveryDrafts';
import { mountTextDrop } from '../src/application/mount';
import type { Cloud } from '../src/application/ports';
import type { TextDropPage } from '../src/domain/snippets/model';
import { DEVICE_SNIPPETS_KEY, DeviceSnippets } from '../src/infrastructure/storage/deviceSnippets';

// Shared setup of the `src/application/mount.*.test.ts` files: a fake cloud, the real device list on jsdom storage,
// fake timers and the <dialog> methods jsdom lacks. A test file calls `useMountHarness()` once at its top level.
// `root`, `cloud`, `dispose` and `writeText` are replaced before every test; importing files always read the current value.

export const first: TextDropPage = { id: '00000000-0000-4000-8000-000000000001', code: 'a'.repeat(32), text: 'Shared text', version: 1, updatedAt: '2026-10-10T01:00:00.000Z' };
export const second: TextDropPage = { ...first, id: '00000000-0000-4000-8000-000000000002', code: 'b'.repeat(32), text: 'Another snippet' };
export const key = (code: string) => `${DEVICE_SNIPPETS_KEY}:${code}`;

export function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export let root: HTMLDivElement;
export let cloud: Cloud;
export let dispose: (() => void) | undefined;
export let writeText: ReturnType<typeof vi.fn>;

export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return root.querySelector<T>(`#${id}`)!;
}
export const rows = () => [...root.querySelectorAll<HTMLAnchorElement>('.device-row .snippet-open')].map(row => row.dataset.code);
export const flush = () => vi.advanceTimersByTimeAsync(1);

export async function start(hash = '#/', configured = true, listed = true): Promise<void> {
  // Ordinary-page fixtures represent snippets already listed on this device.
  // Unlisted invitations pass listed=false; removed entries are never restored by setup.
  const route = readRoute(hash);
  if (listed && route.kind === 'page') {
    try {
      const device = new DeviceSnippets();
      if (!device.isRemoved(route.code)) device.remember(route.code);
    } catch {
      /* The app reports blocked browser storage. */
    }
  }
  history.replaceState(null, '', `/textdrop/${hash}`);
  dispose = mountTextDrop(root, cloud, new DeviceSnippets(), { configured, version: 'test', recovery: new RecoveryDrafts() });
  await flush();
}

export async function join(code: string): Promise<void> {
  if (!element<HTMLDialogElement>('snippet-dialog').open || element('join-form').hidden) element('join').click();
  element<HTMLInputElement>('join-code').value = code;
  element('join-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

export async function create(): Promise<void> {
  element('create').click();
  element('create-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

export function edit(text: string): void {
  element<HTMLTextAreaElement>('editor').value = text;
  element('editor').dispatchEvent(new Event('input', { bubbles: true }));
}

export function useMountHarness(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(first.updatedAt));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLDivElement>('#app')!;
    let nameVersion = 1;
    cloud = {
      createPage: vi.fn().mockResolvedValue(first),
      joinPage: vi.fn(async code => (code === second.code ? second : first)),
      pollPage: vi.fn().mockResolvedValue(first),
      savePage: vi.fn(async (_id, text) => ({ ...first, text, version: 2 })),
      renamePage: vi.fn(async (id, name) => ({ ...(id === second.id ? second : first), name, version: ++nameVersion })),
      startNewSession: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
}
