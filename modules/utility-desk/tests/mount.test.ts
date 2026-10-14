import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOLS } from '../src/application/registry';
import { mainRoot } from './helpers';

// jsdom has no Worker, which would make the media converter show its "unavailable" page instead of the tool.
vi.mock('../src/infrastructure/capabilities', () => ({ detectCapabilities: () => ['wasm', 'workers', 'pdfjs', 'ffmpeg'].map((id) => ({ id, label: id, state: 'Supported', detail: 'Test environment' })) }));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const ids = TOOLS.map((tool) => tool.id);
const load = (id: string) => TOOLS.find((tool) => tool.id === id)!.load();

describe('tool pages mount', () => {
  it.each(ids)('renders %s with shared layout', async (id) => {
    const root = mainRoot();
    const cleanup = (await load(id)).mount(root);
    expect(root.querySelector('h1')).toBeTruthy();
    expect(root.querySelector('.page-heading .tool-mark')).toBeTruthy();
    expect(root.querySelectorAll('.side-panels .panel').length).toBeGreaterThan(0);
    if (typeof cleanup === 'function') cleanup();
  });
});

type Registration = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean; once: boolean; signal?: AbortSignal };

/** Records add/removeEventListener on `target`, so a test can tell which listeners are still attached afterwards. */
function watchListeners(target: EventTarget) {
  const live: Registration[] = [];
  const add = target.addEventListener.bind(target),
    remove = target.removeEventListener.bind(target);
  const capture = (options?: boolean | EventListenerOptions) => (typeof options === 'boolean' ? options : !!options?.capture);
  const find = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => live.findIndex((entry) => entry.type === type && entry.listener === listener && entry.capture === capture(options));
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener && find(type, listener, options) < 0) live.push({ type, listener, capture: capture(options), once: typeof options === 'object' && !!options.once, signal: typeof options === 'object' ? (options.signal ?? undefined) : undefined });
    add(type, listener, options);
  });
  vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
    const index = listener ? find(type, listener, options) : -1;
    if (index >= 0) live.splice(index, 1);
    remove(type, listener, options);
  });
  /** Listeners still attached once events of the `fired` types have been dispatched (a `once` listener removes itself then). */
  return (fired: string[]) => live.filter((entry) => !(entry.once && fired.includes(entry.type)) && !entry.signal?.aborted).map((entry) => entry.type);
}

describe('keyboard use', () => {
  // Enter in a field clicks the form's first submit button, so each page needs exactly one: its main action.
  it.each(ids)('%s has one submit button, the page action', async (id) => {
    const root = mainRoot();
    const cleanup = (await load(id)).mount(root);
    const submits = [...root.querySelectorAll<HTMLButtonElement>('form button[type=submit]')].map((button) => button.textContent);
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatch(/→$/);
    if (typeof cleanup === 'function') cleanup();
  });
});

describe('leaving a tool page', () => {
  it.each(ids)('%s leaves no listeners on #main, document or window', async (id) => {
    const root = mainRoot();
    const { mount } = await load(id);
    const attached = [root, document, window].map(watchListeners);
    const cleanup = mount(root);
    // main.ts announces that the page is left, then runs the cleanup that mount returned.
    root.dispatchEvent(new Event('utility-desk:leave'));
    if (typeof cleanup === 'function') cleanup();
    expect(attached.flatMap((remaining) => remaining(['utility-desk:leave']))).toEqual([]);
  });

  it('keeps the listener count on #main flat across repeated visits', async () => {
    const root = mainRoot();
    const attached = watchListeners(root);
    for (const id of ids) {
      const cleanup = (await load(id)).mount(root);
      root.dispatchEvent(new Event('utility-desk:leave'));
      if (typeof cleanup === 'function') cleanup();
      root.replaceChildren();
    }
    expect(attached(['utility-desk:leave'])).toEqual([]);
  });
});
