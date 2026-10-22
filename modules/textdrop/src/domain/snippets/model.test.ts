import { describe, expect, it, vi } from 'vitest';
import { MAX_TEXT_BYTES, countLines, exceedsLimit, exportFileName, normalizeCode, readPage, shortCode, textBytes, validateText, validateUuid } from './model';

const page = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'a'.repeat(32),
  name: null,
  text: 'A shared note\nবাংলা 😀',
  version: 1,
  updatedAt: '2026-10-10T01:02:03.123456+00:00',
};

describe('snippet data and limits', () => {
  it('normalizes uppercase complete codes with ASCII whitespace and hyphens', () => {
    expect(normalizeCode(` \t${'A'.repeat(8)}-${'A'.repeat(8)}\n${'A'.repeat(16)}\r\f\v`)).toBe(page.code);
    expect(() => normalizeCode('abcd')).toThrow('32-character');
    expect(() => normalizeCode('g'.repeat(32))).toThrow('32-character');
    expect(() => normalizeCode(null)).toThrow('32-character');
    expect(() => normalizeCode(`${page.code}\u00a0`)).toThrow('32-character');
  });

  it('normalizes UUIDs and rejects ID-like arbitrary strings', () => {
    expect(validateUuid('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(() => validateUuid('not-a-snippet')).toThrow('ID');
  });

  it('preserves blank text, indentation, line endings, markup, and Unicode literally', () => {
    const text = '\t<script>alert(1)</script>\r\nবাংলা 😀  \n';
    expect(validateText(text)).toBe(text);
    expect(validateText('')).toBe('');
    expect(textBytes('😀')).toBe(4);
    expect(textBytes('é')).toBe(2);
  });

  it('uses the UTF-8 byte limit instead of character or UTF-16 count', () => {
    expect(validateText('x'.repeat(MAX_TEXT_BYTES))).toHaveLength(MAX_TEXT_BYTES);
    expect(validateText('😀'.repeat(MAX_TEXT_BYTES / 4))).toHaveLength(MAX_TEXT_BYTES / 2);
    expect(() => validateText(`${'😀'.repeat(MAX_TEXT_BYTES / 4)}x`)).toThrow('1 MiB');
    expect(() => validateText('é'.repeat(MAX_TEXT_BYTES / 2 + 1))).toThrow('1 MiB');
  });

  it('names exported files after the snippet name or the date and never after the secret code', () => {
    const noon = new Date(2026, 9, 10, 12, 0);
    expect(exportFileName(undefined, noon)).toBe('textdrop-2026-10-10.txt');
    expect(exportFileName('', noon)).toBe('textdrop-2026-10-10.txt');
    expect(exportFileName('Travel notes', noon)).toBe('Travel notes.txt');
    expect(exportFileName('  Plans   for\tMay  ', noon)).toBe('Plans for May.txt');
    expect(exportFileName('বাংলা 😀 \u{1F468}\u200D\u{1F469}\u200D\u{1F467}', noon)).toBe('বাংলা 😀 \u{1F468}\u200D\u{1F469}\u200D\u{1F467}.txt');
    expect(exportFileName('Notes <draft>: a/b\\c|d*e?"f"', noon)).toBe('Notes draft a b c d e f.txt');
    expect(exportFileName('..hidden', noon)).toBe('hidden.txt');
    expect(exportFileName('evil\u202Egnp.exe', noon)).toBe('evilgnp.exe.txt');
    expect(exportFileName('\u0000\u001f / \\ ', noon)).toBe('textdrop-2026-10-10.txt');
    expect(exportFileName(undefined, new Date(2026, 0, 5, 23, 59))).toBe('textdrop-2026-01-05.txt');
  });

  it('shortens a code to the form shown in the snippet list', () => {
    expect(shortCode('0123456789abcdef0123456789abcdef')).toBe('012345…abcdef');
  });

  it('decides the size limit like the UTF-8 byte count while skipping encoding when length alone settles it', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    expect(exceedsLimit('')).toBe(false);
    expect(exceedsLimit('x'.repeat(MAX_TEXT_BYTES / 3))).toBe(false);
    expect(exceedsLimit('x'.repeat(MAX_TEXT_BYTES + 1))).toBe(true);
    expect(encode).not.toHaveBeenCalled();
    const cases = [
      'x'.repeat(MAX_TEXT_BYTES),
      `${'x'.repeat(MAX_TEXT_BYTES)}x`,
      '€'.repeat(349_525),
      '€'.repeat(349_526),
      '😀'.repeat(262_144),
      `${'😀'.repeat(262_144)}x`,
      'é'.repeat(524_288),
      `${'é'.repeat(524_288)}x`,
      '\ud800'.repeat(349_525),
      '\ud800'.repeat(349_526),
    ];
    for (const text of cases) expect(exceedsLimit(text), `${text.length} units`).toBe(textBytes(text) > MAX_TEXT_BYTES);
    expect(cases.map(exceedsLimit)).toEqual([false, true, false, true, false, true, false, true, false, true]);
    encode.mockRestore();
  });

  it('counts lines like splitting on line feeds', () => {
    for (const text of ['', 'one', 'one\n', '\n\n', 'a\r\nb\nc', '\n'.repeat(1000)]) {
      expect(countLines(text), JSON.stringify(text.slice(0, 12))).toBe(text.split('\n').length);
    }
  });

  it('rejects characters PostgreSQL text cannot preserve', () => {
    for (const text of ['\u0000', 'start\ud800end', '\udc00']) {
      expect(() => validateText(text)).toThrow('cannot be saved');
    }
    expect(() => validateText(42)).toThrow('must contain text');
  });

  it('reads only bounded server records with safe monotonic versions and real timestamps', () => {
    expect(readPage(page)).toEqual(page);
    expect(readPage(page)).not.toBe(page);
    for (const invalid of [
      { version: 0 },
      { version: Number.MAX_SAFE_INTEGER + 1 },
      { version: '1' },
      { name: undefined },
      { updatedAt: '2026-02-30T01:02:03Z' },
      { updatedAt: '2026-10-10' },
      { updatedAt: '2026-10-10T24:00:00Z' },
      { text: null },
      { code: 'A'.repeat(32) },
      { extra: true },
    ]) {
      expect(() => readPage({ ...page, ...invalid })).toThrow();
    }
    expect(() => readPage([page])).toThrow('object');
    expect(() => readPage(Object.create(page))).toThrow('plain object');
    const getter = Object.defineProperty({ ...page }, 'text', {
      get: () => {
        throw new Error('getter ran');
      },
    });
    expect(() => readPage(getter)).toThrow('unsupported field');
  });
});
