import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { convertDocument, epubToHtml } from '../src/domain/documents/conversion';
import { buildMobi, mobiToHtml, palmDocDecompress } from '../src/domain/documents/mobi';
import { hasDrm, sanitizeHtml, unzipLimited } from '../src/domain/documents/sanitize';
import { LIMITS } from '../src/shared/limits';

const HOSTILE =
  '<h1 onclick="steal()">Title</h1><p style="background:url(x)" onmouseover="x()">Hello <a href="javascript:alert(1)" onclick="x()">bad</a> ' +
  '<a href=" JaVa\tScRiPt:alert(2)">tabbed</a> <a href="data:text/html,<script>1</script>">data</a> <a href="https://example.org/ok">ok</a> <a href="#note">anchor</a></p>' +
  '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><form action="https://evil.example"><input name="q"><button>Go</button></form>' +
  '<svg onload="x()"><script>1</script></svg><math><mi>x</mi></math><img src="x" onerror="x()"><script>alert(3)</script><style>p{}</style><marquee onstart="x()">kept text</marquee>' +
  '<table><tr><td colspan="2" onclick="x()">cell</td></tr></table><!-- comment -->';

describe('sanitizeHtml', () => {
  const out = sanitizeHtml(HOSTILE);
  it('removes scripts, frames, forms, embeds, SVG and images with their content', () => {
    for (const bad of ['<script', '<iframe', '<object', '<embed', '<form', '<input', '<button', '<svg', '<math', '<img', '<style', 'alert(3)', 'evil.example']) expect(out, bad).not.toContain(bad);
  });
  it('removes event handler and style attributes', () => {
    expect(out).not.toMatch(/\son[a-z]+=/i);
    expect(out).not.toContain('style=');
  });
  it('keeps only web, mail and anchor link targets, even when disguised', () => {
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toContain('data:');
    expect(out).toContain('href="https://example.org/ok"');
    expect(out).toContain('href="#note"');
  });
  it('keeps readable content: headings, text of unknown elements and allowed attributes', () => {
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('kept text');
    expect(out).toContain('<td colspan="2">cell</td>');
  });
  it('is stable when applied twice', () => {
    expect(sanitizeHtml(out)).toBe(out);
  });
});

describe('hostile documents in every conversion', () => {
  const html = `<html><head><script>1</script></head><body>${HOSTILE}</body></html>`;
  it('cleans HTML input for the HTML, EPUB and MOBI outputs', () => {
    const asHtml = convertDocument({ format: 'html', text: html, title: 't' }, 'html') as string;
    expect(asHtml).not.toMatch(/<script|<iframe|\son[a-z]+=|javascript:/i);
    const epub = convertDocument({ format: 'html', text: html, title: 't' }, 'epub') as Uint8Array;
    const chapter = new TextDecoder().decode(unzipLimited(epub)['OEBPS/content.xhtml']);
    expect(chapter).not.toMatch(/<script|<iframe|\son[a-z]+=|javascript:/i);
    const mobi = mobiToHtml(convertDocument({ format: 'html', text: html, title: 't' }, 'mobi') as Uint8Array);
    expect(mobi.html).not.toMatch(/<script|<iframe|\son[a-z]+=|javascript:/i);
    expect(mobi.html).toContain('Title');
  });
  it('cleans EPUB chapters and MOBI text on import', () => {
    const book = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
      'book.opf': strToU8('<package><metadata><title>Hostile</title></metadata><manifest><item id="c" href="c.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>'),
      'c.xhtml': strToU8(`<html><body>${HOSTILE}</body></html>`),
    });
    const result = epubToHtml(book).html;
    expect(result).not.toMatch(/<script|<iframe|<form|\son[a-z]+=|javascript:/i);
    expect(result).toContain('Title');
    const mobi = mobiToHtml(buildMobi('Hostile', `<p onclick="x()">Hi</p><script>1</script><a href="javascript:1">x</a>`));
    expect(mobi.html).not.toMatch(/<script|onclick|javascript:/i);
    expect(mobi.html).toContain('Hi');
  });
});

describe('EPUB archive limits', () => {
  it('refuses an archive with too many entries', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= LIMITS.archiveEntries; i++) files[`f${i}`] = new Uint8Array(0);
    expect(() => unzipLimited(zipSync(files, { level: 0 }))).toThrow(/more than 10,000 entries/);
  });
  it('refuses an oversized entry from the archive directory, before inflating it', () => {
    const bomb = zipSync({ 'big.txt': new Uint8Array(LIMITS.archiveEntryBytes + 1) }, { level: 9 });
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => unzipLimited(bomb)).toThrow(/larger than 32 MB/);
    expect(() => epubToHtml(bomb)).toThrow(/larger than 32 MB/);
  });
  it('refuses archives whose entries add up past the total cap', () => {
    const count = Math.floor(LIMITS.inflatedBytes / LIMITS.archiveEntryBytes) + 1;
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < count; i++) files[`part${i}`] = new Uint8Array(LIMITS.archiveEntryBytes);
    expect(() => unzipLimited(zipSync(files, { level: 9 }))).toThrow(/inflates to more than 128 MB/);
  });
  it('still reads a normal archive', () => {
    expect(Object.keys(unzipLimited(zipSync({ 'a.txt': strToU8('a'), 'dir/': new Uint8Array(0) })))).toEqual(['a.txt']);
  });
});

describe('MOBI text size', () => {
  it('stops a PalmDOC stream that expands past the cap', () => {
    // One literal byte followed by 4 million 2-byte back references (distance 1, length 10): 8 MB that inflate to 40 MB.
    const data = new Uint8Array(1 + 2 * 4_000_000);
    data[0] = 0x41;
    for (let i = 0; i < 4_000_000; i++) {
      data[1 + i * 2] = 0x80;
      data[2 + i * 2] = 0x0f;
    }
    expect(() => palmDocDecompress(data)).toThrow(/expands to more text/);
  });
});

describe('EPUB DRM detection', () => {
  const xml = (...algorithms: string[]) => strToU8(`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${algorithms.map((a) => `<enc:EncryptedData><enc:EncryptionMethod Algorithm="${a}"/></enc:EncryptedData>`).join('')}</encryption>`);
  it('accepts obfuscated fonts only', () => {
    expect(hasDrm(undefined)).toBe(false);
    expect(hasDrm(xml('http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'))).toBe(false);
  });
  it('flags real encryption even when fonts are obfuscated or the file mentions IDPF', () => {
    expect(hasDrm(xml('http://www.w3.org/2001/04/xmlenc#aes128-cbc'))).toBe(true);
    expect(hasDrm(xml('http://www.idpf.org/2008/embedding', 'http://www.w3.org/2001/04/xmlenc#aes128-cbc'))).toBe(true);
    expect(hasDrm(strToU8('<encryption><!-- IDPF fontobfuscation --><EncryptedData><EncryptionMethod Algorithm="urn:example:drm"/></EncryptedData></encryption>'))).toBe(true);
  });
});
