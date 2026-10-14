import { unzipSync, strFromU8, type Unzipped } from 'fflate';
import { LIMITS } from '../../shared/limits';

/** Elements whose content is removed with them (code, embeds, forms, media, document metadata). */
const DROPPED = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'img', 'picture', 'audio', 'video', 'source', 'track', 'canvas', 'map', 'link', 'meta', 'base', 'head', 'title']);
/** Text-level and structural elements that stay. Any other element is unwrapped: its text and allowed children remain. */
const ALLOWED = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
]);
const GLOBAL_ATTRIBUTES = new Set(['id', 'title', 'lang', 'dir']);
const ELEMENT_ATTRIBUTES: Record<string, string[]> = { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] };
/** Link targets that stay: web and mail links and in-page anchors. Relative files do not exist in the output. */
const SAFE_HREF = /^(?:https?:|mailto:|#)/i;

/**
 * Allow-list sanitizer for HTML that came from a file the user opened (HTML, EPUB chapters, MOBI text) before it is
 * written into the HTML, EPUB or MOBI output. Parsing with DOMParser never runs scripts or loads resources. The result
 * keeps only allow-listed elements and attributes: no `on*` handlers, `style`, `javascript:` or `data:` URLs, frames,
 * forms, objects or SVG.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Children come after their parents in document order, so walking backwards cleans the inside first without recursion.
  const elements = [...doc.body.querySelectorAll('*')].reverse();
  for (const el of elements) {
    const tag = el.localName.toLowerCase();
    if (DROPPED.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED.has(tag)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const kept = new Set([...GLOBAL_ATTRIBUTES, ...(ELEMENT_ATTRIBUTES[tag] ?? [])]);
    for (const attribute of [...el.attributes]) {
      const name = attribute.name.toLowerCase();
      // eslint-disable-next-line no-control-regex
      const safe = kept.has(name) && (name !== 'href' || SAFE_HREF.test(attribute.value.replace(/[\u0000- ]/g, '')));
      if (!safe) el.removeAttribute(attribute.name);
    }
  }
  return doc.body.innerHTML;
}

/**
 * Unzip an EPUB with limits: at most `LIMITS.archiveEntries` entries, `LIMITS.archiveEntryBytes` inflated per entry and
 * `LIMITS.inflatedBytes` in total. The sizes come from the archive's own directory, so an oversized entry is refused
 * before anything is inflated; entries that lie about their size are stopped by fflate while inflating.
 */
export function unzipLimited(bytes: Uint8Array): Unzipped {
  let entries = 0,
    total = 0;
  return unzipSync(bytes, {
    filter(file) {
      if (file.name.endsWith('/')) return false;
      if (++entries > LIMITS.archiveEntries) throw new Error(`This archive has more than ${LIMITS.archiveEntries.toLocaleString('en-US')} entries and cannot be converted.`);
      if (file.originalSize > LIMITS.archiveEntryBytes) throw new Error(`An entry in this archive is larger than ${LIMITS.archiveEntryBytes / 1024 / 1024} MB inflated and cannot be converted.`);
      total += file.originalSize;
      if (total > LIMITS.inflatedBytes) throw new Error(`This archive inflates to more than ${LIMITS.inflatedBytes / 1024 / 1024} MB and cannot be converted.`);
      return true;
    },
  });
}

/** Font obfuscation (IDPF and Adobe) only scrambles embedded fonts; every other encryption method is DRM. */
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

/** True when `encryption.xml` encrypts content other than obfuscated fonts, so the book cannot be read. */
export function hasDrm(encryptionXml: Uint8Array | undefined): boolean {
  if (!encryptionXml) return false;
  const doc = new DOMParser().parseFromString(strFromU8(encryptionXml), 'application/xml');
  const encrypted = [...doc.getElementsByTagNameNS('*', 'EncryptedData')];
  return encrypted.some((data) => !FONT_OBFUSCATION.has(data.getElementsByTagNameNS('*', 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? ''));
}
