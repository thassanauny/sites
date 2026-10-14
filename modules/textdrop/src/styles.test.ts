import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map(start => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const tokens = new Map([...css.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(match => [match[1]!, match[2]!.toLowerCase()]));
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
  selectors: match[1]!.split(',').map(selector => selector.trim()),
  declarations: match[2]!,
}));

/** Colour used for text, with the background it sits on. The default is the darkest of the page, panel and card backgrounds. */
const PAGE = '#f6f5f0';
const PANEL = '#eeeee6';
const CARD = '#fffefa';
const backgrounds = new Map([
  ['.device-count', '#e9ecdf'],
  ['.notice', '#fff2dc'],
  ['textarea:disabled', '#f2f2eb'],
  ['.snippet-remove:hover', '#f8eee8'],
  ['.snippet-rename:hover', '#eef1e7'],
  ['.disconnected', PAGE],
  ['#save-status', CARD],
  ['#save-status.unsaved', CARD],
  ['.over-limit', CARD],
  ['.dialog-error', CARD],
]);
/** White text on a dark fill, and decorations that assistive technology skips. Neither is checked against the light backgrounds. */
const skipped = new Set(['.primary', '.toast', '.paper-mark', '.illustration-spark', '.home-notes svg']);

function resolve(value: string): string | undefined {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) return tokens.get(reference[1]!);
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

describe('TextDrop colours', () => {
  it('gives every text colour at least 4.5:1 contrast on its background', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { selectors, declarations } of rules) {
      const value = /(?:^|[;\s])color:\s*([^;]+)/.exec(declarations)?.[1]?.trim();
      const colour = value ? resolve(value) : undefined;
      if (!colour) continue;
      for (const selector of selectors) {
        if (skipped.has(selector)) continue;
        const background = backgrounds.get(selector) ?? PANEL;
        checked += 1;
        const ratio = contrast(colour, background);
        if (ratio < 4.5) failures.push(`${selector} ${colour} on ${background} is ${ratio.toFixed(2)}:1`);
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(failures).toEqual([]);
  });

  it('draws the keyboard focus ring with at least 3:1 contrast on every light background', () => {
    const ring = /:focus-visible\s*\{[^}]*outline:\s*\d+px solid (#[0-9a-f]{6}|var\(--[\w-]+\))/i.exec(css)?.[1];
    const colour = ring ? resolve(ring) : undefined;
    expect(colour).toBeDefined();
    for (const background of [PAGE, PANEL, CARD, '#fff2dc', '#eef1e7']) {
      expect(contrast(colour!, background), background).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps white text on the green button and the toast readable', () => {
    expect(contrast('#ffffff', tokens.get('--green')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', '#174a38')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', '#273e30')).toBeGreaterThanOrEqual(4.5);
  });
});
