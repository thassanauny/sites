/** Compact transport for source-defined dictionaries; editorial text is untouched. */
export const COMPACT_DICTIONARY_FORMAT = 'shobdokosh/dictionary-rows@1';

const SHARED_KEYS = ['language', 'sourceKind', 'sourceName', 'sourceLicense'];
const ROW_KEYS = new Set([
  'id', 'headword', 'pos', 'definitionsBn', 'sourceRevision', 'sourcePage',
  'sourceLabels', 'en', 'bn', 'sourceUrl', ...SHARED_KEYS,
]);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Match urllib.parse.urlencode, used by the pinned-source importers. Keeping
// Python's spelling of the query preserves existing per-revision URLs exactly.
function queryValue(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');
}

export function wiktionaryRevisionUrl(title, revision) {
  return `https://bn.wiktionary.org/w/index.php?title=${queryValue(title)}&oldid=${queryValue(revision)}`;
}

function sameJson(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function sourceIdPrefix(entries) {
  const prefix = entries[0]?.id?.match(/^(.*?)[0-9a-f]{16,}$/u)?.[1] || '';
  return prefix && entries.every(entry => entry.id.startsWith(prefix)) ? prefix : '';
}

/**
 * Only source-defined records with explicit headwords are packed. Legacy
 * bilingual dictionaries keep their original object representation.
 * Rows: id suffix, headword, POS, definition(s), revision, optional page,
 * optional labels, optional nonshared fields. Trailing nulls are omitted.
 */
export function packDictionary(dictionary) {
  if (dictionary?.format === COMPACT_DICTIONARY_FORMAT) return dictionary;
  if (!dictionary || !Array.isArray(dictionary.entries)) throw new TypeError('Dictionary entries must be an array.');
  const { entries } = dictionary;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.id !== 'string' || typeof entry.headword !== 'string'
        || !['en', 'bn'].includes(entry.language)
        || !Array.isArray(entry.definitionsBn)
        || !entry.definitionsBn.every(value => typeof value === 'string')
        || typeof entry.sourceRevision !== 'string'
        || typeof entry.sourcePage !== 'string') {
      throw new TypeError('Compact entries require explicit headwords, language, definitions and source revisions.');
    }
  }
  const shared = {};
  for (const key of SHARED_KEYS) {
    if (entries.length && hasOwn(entries[0], key)
        && entries.every(entry => hasOwn(entry, key) && sameJson(entry[key], entries[0][key]))) {
      shared[key] = entries[0][key];
    }
  }
  const idPrefix = sourceIdPrefix(entries);
  const rows = entries.map(entry => {
    const extra = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!ROW_KEYS.has(key) || (SHARED_KEYS.includes(key) && !hasOwn(shared, key))) extra[key] = value;
    }
    const expectedEn = entry.language === 'en' ? entry.headword : '';
    const expectedBn = entry.language === 'bn' ? [entry.headword] : [];
    if (!sameJson(entry.en, expectedEn)) extra.en = entry.en;
    if (!sameJson(entry.bn, expectedBn)) extra.bn = entry.bn;
    const expectedUrl = wiktionaryRevisionUrl(entry.sourcePage, entry.sourceRevision);
    if (entry.sourceUrl !== expectedUrl) extra.sourceUrl = entry.sourceUrl;
    // Missing and explicitly null optional fields remain distinguishable.
    if (hasOwn(entry, 'pos') && entry.pos === null) extra.pos = null;
    if (hasOwn(entry, 'sourceLabels') && entry.sourceLabels === null) extra.sourceLabels = null;
    const row = [
      entry.id.slice(idPrefix.length), entry.headword,
      entry.pos ?? null,
      entry.definitionsBn.length === 1 ? entry.definitionsBn[0] : entry.definitionsBn,
      entry.sourceRevision,
      entry.sourcePage === entry.headword ? null : entry.sourcePage,
      entry.sourceLabels ?? null,
      Object.keys(extra).length ? extra : null,
    ];
    while (row.length > 5 && row.at(-1) === null) row.pop();
    return row;
  });
  return { ...dictionary, format: COMPACT_DICTIONARY_FORMAT, shared, idPrefix, entries: rows };
}

/** Accept the established object format and the compact, source-defined format. */
export function unpackDictionary(dictionary) {
  if (dictionary?.format !== COMPACT_DICTIONARY_FORMAT) return dictionary;
  const { format, shared = {}, idPrefix = '', entries: rows, ...original } = dictionary;
  if (!Array.isArray(rows)) throw new TypeError('Compact dictionary rows must be an array.');
  const prototype = Object.assign(Object.create(Object.prototype), shared);
  Object.defineProperties(prototype, {
    sourcePage: { configurable: true, get() { return this.headword; } },
    sourceUrl: { configurable: true, get() { return wiktionaryRevisionUrl(this.sourcePage, this.sourceRevision); } },
  });
  const entries = rows.map(row => {
    if (!Array.isArray(row) || row.length < 5 || typeof row[0] !== 'string'
        || typeof row[1] !== 'string' || typeof row[4] !== 'string'
        || !(typeof row[3] === 'string' || (Array.isArray(row[3]) && row[3].every(value => typeof value === 'string')))) {
      throw new TypeError('Malformed compact dictionary row.');
    }
    const entry = Object.create(prototype);
    entry.id = idPrefix + row[0];
    entry.headword = row[1];
    if (row[2] !== null) entry.pos = row[2];
    entry.definitionsBn = typeof row[3] === 'string' ? [row[3]] : row[3];
    entry.sourceRevision = row[4];
    if (row[5] !== null && row[5] !== undefined) Object.defineProperty(entry, 'sourcePage', {
      configurable: true, enumerable: true, writable: true, value: row[5],
    });
    if (row[6] !== null && row[6] !== undefined) entry.sourceLabels = row[6];
    if (row[7]) for (const [key, value] of Object.entries(row[7])) Object.defineProperty(entry, key, {
      configurable: true, enumerable: true, writable: true, value,
    });
    if (!hasOwn(entry, 'en')) entry.en = entry.language === 'en' ? entry.headword : '';
    if (!hasOwn(entry, 'bn')) entry.bn = entry.language === 'bn' ? [entry.headword] : [];
    return entry;
  });
  return { ...original, entries };
}
