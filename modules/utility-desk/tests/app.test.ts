import { describe, it, expect, vi } from 'vitest';
import { Store, MAX_ACTIVITY } from '../src/infrastructure/storage';
import { detectCapabilities } from '../src/infrastructure/capabilities';
import { parseHash, hrefFor, ROUTES } from '../src/application/router';
import { resolveBase } from '../src/shared/base';
import { convertDocument, markdownToHtml } from '../src/domain/documents/conversion';
import { strFromU8 } from 'fflate';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('state persistence', () => {
  it('keeps drafts within the page session while persisting prefs and capped activity', () => {
    const kv = mem();
    const s = new Store(kv);
    s.setPrefs({ lastTool: 'split-pdf' }); s.setDraft('t', { a: '1' });
    expect(s.getDraft('t')).toEqual({ a: '1' });
    expect(kv.getItem('utility-desk:v1:draft:t')).toBeNull();
    for (let i = 0; i < MAX_ACTIVITY + 5; i++) s.addActivity({ tool: 't', message: `m${i}`, status: 'done' });
    const s2 = new Store(kv);
    expect(s2.getPrefs().lastTool).toBe('split-pdf');
    expect(s2.getDraft('t')).toEqual({});
    expect(s2.getActivity()).toHaveLength(MAX_ACTIVITY);
    expect(s2.getActivity()[0].message).toBe(`m${MAX_ACTIVITY + 4}`);
    s2.clearActivity(); expect(s2.getActivity()).toEqual([]);
  });
  it('ignores old persistent tool drafts after reload without clearing activity or preferences', () => {
    const kv = mem();
    for (const tool of ['compress-image', 'image-workshop', 'images-to-pdf', 'date-time']) {
      kv.setItem(`utility-desk:v1:draft:${tool}`, JSON.stringify({ maxSize: '12', quality: '1', contrast: '25', date: '2000-01-01' }));
    }
    const reloaded = new Store(kv);
    for (const tool of ['compress-image', 'image-workshop', 'images-to-pdf', 'date-time']) {
      expect(reloaded.getDraft(tool)).toEqual({});
      expect(kv.getItem(`utility-desk:v1:draft:${tool}`)).toBeNull();
    }
  });
  it('survives corrupt or unavailable storage', () => {
    const kv = mem(); kv.setItem('utility-desk:v1:prefs', '{bad');
    expect(new Store(kv).getPrefs()).toEqual({});
    expect(new Store(null).getActivity()).toEqual([]);
    const throwing = { getItem: () => { throw new Error('x'); }, setItem: vi.fn(() => { throw new Error('quota'); }), removeItem: () => {} };
    expect(() => new Store(throwing).addActivity({ tool: 't', message: 'm', status: 'failed' })).not.toThrow();
  });
});

describe('unsupported browser states', () => {
  const state = (caps: ReturnType<typeof detectCapabilities>, id: string) => caps.find((c) => c.id === id)!.state;
  it('reports Unavailable in an empty environment', () => {
    const c = detectCapabilities({});
    expect(state(c, 'wasm')).toBe('Unavailable'); expect(state(c, 'workers')).toBe('Unavailable');
    expect(state(c, 'ffmpeg')).toBe('Unavailable'); expect(state(c, 'pdfjs')).toBe('Unavailable');
    expect(state(c, 'idb')).toBe('Limited');
  });
  it('reports Supported / Limited correctly', () => {
    const full = { WebAssembly: { instantiate() {} }, Worker: class {}, indexedDB: {}, document: {}, showDirectoryPicker() {} };
    const c = detectCapabilities(full);
    expect(c.every((x) => x.state === 'Supported')).toBe(true);
    const c2 = detectCapabilities({ ...full, showDirectoryPicker: undefined, HTMLInputElement: { prototype: { webkitdirectory: '' } }, navigator: { deviceMemory: 2 } });
    expect(state(c2, 'ffmpeg')).toBe('Limited');
    expect(state(detectCapabilities({ ...full, Worker: undefined }), 'pdfjs')).toBe('Limited');
  });
});

describe('GitHub Pages routing', () => {
  it.each(['folder-sync', 'media-downloader', 'secure-copy'])('rejects the removed %s route', (route) => {
    expect(parseHash(`#/${route}`)).toBe('notfound');
  });
  it('parses hash routes', () => {
    expect(parseHash('')).toBe('dashboard'); expect(parseHash('#/')).toBe('dashboard');
    expect(parseHash('#/merge-pdfs')).toBe('merge-pdfs'); expect(parseHash('#/split-pdf?x=1')).toBe('split-pdf');
    expect(parseHash('#/nope')).toBe('notfound');
    for (const r of ROUTES) expect(parseHash(hrefFor(r))).toBe(r);
  });
  it('resolves project-site base paths', () => {
    expect(resolveBase(undefined)).toBe('./'); expect(resolveBase('')).toBe('./');
    expect(resolveBase('/utility-desk')).toBe('/utility-desk/'); expect(resolveBase('repo/')).toBe('/repo/');
  });
});

describe('document conversion', () => {
  it('escapes HTML and unsafe links in Markdown', () => {
    const html = markdownToHtml('# Hi <script>\n\n[x](javascript:alert(1)) **b**');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('javascript:'); expect(html).toContain('<strong>b</strong>');
  });
  it('round-trips through EPUB', () => {
    const epub = convertDocument({ format: 'md', text: '# Title\n\nHello world', title: 'Book' }, 'epub') as Uint8Array;
    const txt = convertDocument({ format: 'epub', bytes: epub, title: 'x' }, 'txt') as string;
    expect(txt).toContain('Title'); expect(txt).toContain('Hello world');
    expect(strFromU8(epub.slice(0, 4))).toBe('PK\u0003\u0004');
  });
});

import { palmDocDecompress, buildMobi, mobiToHtml } from '../src/domain/documents/mobi';
describe('MOBI', () => {
  it('decompresses PalmDOC', () => {
    expect(new TextDecoder().decode(palmDocDecompress(Uint8Array.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x80, 0x32])))).toBe('hello hello');
    expect(new TextDecoder().decode(palmDocDecompress(Uint8Array.from([0x61, 0xe1])))).toBe('a a');
  });
  it('round-trips MOBI ⇄ EPUB', () => {
    const body = '<h1>Ünïcode title</h1><p>' + 'word '.repeat(2000) + '</p>';
    const mobi = convertDocument({ format: 'html', text: body, title: 'T' }, 'mobi') as Uint8Array;
    expect(strFromU8(mobi.slice(60, 68))).toBe('BOOKMOBI');
    const r = mobiToHtml(mobi);
    expect(r.title).toBe('T'); expect(r.html).toContain('Ünïcode title'); expect(r.html.match(/word/g)).toHaveLength(2000);
    const epub = convertDocument({ format: 'mobi', bytes: mobi, title: 'x' }, 'epub') as Uint8Array;
    const back = convertDocument({ format: 'epub', bytes: epub, title: 'x' }, 'mobi') as Uint8Array;
    expect(mobiToHtml(back).html).toContain('Ünïcode title');
    expect(mobiToHtml(buildMobi('E', '<p>x</p>')).title).toBe('E');
  });
  it('rejects non-MOBI input', () => { expect(() => mobiToHtml(new Uint8Array(200))).toThrow(/MOBI/); });
});
