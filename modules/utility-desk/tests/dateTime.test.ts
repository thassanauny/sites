import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/features/datetime/dateTime';
import { mainRoot } from './helpers';

let root: HTMLElement;
let cleanup: void | (() => void);
beforeEach(() => {
  localStorage.clear();
  root = mainRoot();
  cleanup = mount(root);
});
afterEach(() => {
  root.dispatchEvent(new Event('utility-desk:leave'));
  if (typeof cleanup === 'function') cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tabs = () => [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
const selectedTab = () => tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')!;
const chooseTab = (label: string) =>
  tabs()
    .find((tab) => tab.textContent === label)!
    .click();
const calculate = () => root.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
const result = () => root.querySelector('.datetime-output')!.textContent ?? '';
const type = (name: string, value: string) => {
  const control = root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
};
const toasts = () => [...document.querySelectorAll('.toast')].map((toast) => toast.textContent);
const press = (key: string) => selectedTab().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('timestamp conversion', () => {
  it('asks for a number instead of showing 1970-01-01 when the field is blank or invalid', () => {
    chooseTab('From timestamp');
    type('timestamp', '');
    calculate();
    expect(result()).toContain('Enter a Unix timestamp.');
    expect(result()).not.toContain('1970');
    type('timestamp', 'abc');
    calculate();
    expect(result()).toContain('Enter a valid number');
    type('timestamp', '0');
    calculate();
    expect(result()).toContain('1970-01-01');
  });
});

describe('copying a result', () => {
  const copyButton = () => [...root.querySelectorAll<HTMLButtonElement>('.datetime-result button')].find((button) => button.textContent === 'Copy')!;

  it('says so when the Clipboard API is missing', () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    copyButton().click();
    expect(toasts()).toEqual(['Copy not available']);
  });

  it('says so when the browser refuses or throws', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } });
    copyButton().click();
    await vi.waitFor(() => expect(toasts()).toEqual(['Copy not available']));
    document.querySelector('.toasts')!.replaceChildren();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: () => {
          throw new Error('blocked');
        },
      },
    });
    copyButton().click();
    expect(toasts()).toEqual(['Copy not available']);
  });

  it('confirms a copy', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    copyButton().click();
    await vi.waitFor(() => expect(toasts()).toEqual(['Copied']));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
});

describe('tab pattern', () => {
  it('labels the tabs, the panel and their relationship', () => {
    expect(root.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('Date and time utilities');
    const panel = root.querySelector('[role=tabpanel]')!;
    expect(panel.id).toBe('datetime-panel');
    expect(tabs()).toHaveLength(5);
    for (const tab of tabs()) expect(tab.getAttribute('aria-controls')).toBe('datetime-panel');
    expect(panel.getAttribute('aria-labelledby')).toBe(selectedTab().id);
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toEqual([selectedTab()]);
    chooseTab('World clocks');
    expect(root.querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe('datetime-tab-world');
    expect(
      tabs()
        .filter((tab) => tab.tabIndex === 0)
        .map((tab) => tab.textContent),
    ).toEqual(['World clocks']);
  });

  it('moves between tabs with the arrow, Home and End keys, wrapping at the ends, and focuses the new tab', () => {
    const order = ['Add or subtract', 'Date difference', 'From timestamp', 'To timestamp', 'World clocks'];
    expect(selectedTab().textContent).toBe(order[0]);
    const visit = (key: string, expected: string) => {
      press(key);
      expect(selectedTab().textContent).toBe(expected);
      expect(document.activeElement).toBe(selectedTab());
    };
    visit('ArrowRight', order[1]);
    visit('ArrowDown', order[2]);
    visit('End', order[4]);
    visit('ArrowRight', order[0]);
    visit('ArrowLeft', order[4]);
    visit('ArrowUp', order[3]);
    visit('Home', order[0]);
  });

  it('leaves other keys alone', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    selectedTab().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(selectedTab().textContent).toBe('Add or subtract');
  });
});
