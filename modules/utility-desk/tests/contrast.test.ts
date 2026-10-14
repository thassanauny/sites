import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/style.css', 'utf8');

const channel = (hex: string, at: number) => {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
/** WCAG 2 contrast ratio between two #rrggbb colors. */
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const full = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex);
const token = (name: string) => full(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,6})\\b`, 'i').exec(css)![1]);

// Surfaces that hold small text: panels, the page, selected items, and the tinted rows and sidebar.
const surfaces = [token('paper'), token('background'), token('soft'), '#fafcf8', '#fbfcf8'];

describe('WCAG contrast of the shared colors', () => {
  it('keeps muted text at 4.5:1 or better on every surface', () => {
    for (const surface of surfaces) expect(contrast(token('muted'), surface), surface).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the focus outline at 3:1 or better on every surface', () => {
    const outline = /:focus-visible\s*\{[^}]*outline:\s*\d+px solid (#[0-9a-f]{6})/i.exec(css)![1];
    for (const surface of surfaces) expect(contrast(outline, surface), surface).toBeGreaterThanOrEqual(3);
  });

  it('measures the old colors as failing, so the check is meaningful', () => {
    expect(contrast('#77817a', token('background'))).toBeLessThan(4.5);
    expect(contrast('#82ac92', token('background'))).toBeLessThan(3);
  });
});
