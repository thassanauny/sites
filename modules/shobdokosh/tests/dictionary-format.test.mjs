import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_DICTIONARY_FORMAT, packDictionary, unpackDictionary, wiktionaryRevisionUrl } from '../dist/dictionary-format.js';

function entry(language, headword, overrides = {}) {
  const value = {
    id: `${language}-def-0123456789abcdef0123`, language, headword,
    en: language === 'en' ? headword : '', bn: language === 'bn' ? [headword] : [],
    pos: 'noun', definitionsBn: ['অর্থের প্রথম সংজ্ঞা।', 'অর্থের দ্বিতীয় সংজ্ঞা।'],
    sourceKind: language === 'en' ? 'definition' : 'native',
    sourceName: 'Bengali Wiktionary contributors', sourceLicense: 'CC-BY-SA-4.0',
    sourcePage: headword, sourceRevision: '123456', ...overrides,
  };
  value.sourceUrl ??= wiktionaryRevisionUrl(value.sourcePage, value.sourceRevision);
  return value;
}

function assertEntryValues(actual, expected) {
  for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], key);
}

test('the original object format passes through unchanged', () => {
  const original = { meta: { license: 'CC BY-SA 4.0' }, entries: [{ id: 'old', en: 'word', bn: ['শব্দ'] }] };
  assert.equal(unpackDictionary(original), original);
});

test('both native languages roundtrip with metadata, definitions, IDs and source provenance', () => {
  for (const language of ['bn', 'en']) {
    const original = { meta: { attribution: 'Contributors', license: 'CC BY-SA 4.0', statistics: { entryCount: 2 } }, entries: [
      entry(language, language === 'bn' ? 'অর্ঘ্য' : 'offering'),
      entry(language, language === 'bn' ? 'জীর্ণ' : 'worn-out', { id: `${language}-def-abcdef0123456789abcd`, pos: 'adjective', definitionsBn: ['ব্যবহারে পুরোনো হয়ে গেছে।'], sourceLabels: ['সাহিত্যিক'] }),
    ] };
    const packed = packDictionary(original);
    assert.equal(packed.format, COMPACT_DICTIONARY_FORMAT);
    assert.ok(Array.isArray(packed.entries[0]));
    assert.deepEqual(packed.meta, original.meta);
    const actual = unpackDictionary(JSON.parse(JSON.stringify(packed)));
    assert.deepEqual(actual.meta, original.meta);
    original.entries.forEach((expected, index) => assertEntryValues(actual.entries[index], expected));
    assert.equal(Object.hasOwn(actual.entries[0], 'sourceUrl'), false, 'the common URL is generated lazily');
    assert.equal(Object.getPrototypeOf(actual.entries[0]), Object.getPrototypeOf(actual.entries[1]));
  }
});

test('alternate page case and punctuation preserve the exact source revision URL', () => {
  const original = entry('en', 'may', { sourcePage: 'May', sourceRevision: '0077' });
  const restored = unpackDictionary(packDictionary({ entries: [original] })).entries[0];
  assertEntryValues(restored, original);
  assert.equal(restored.sourcePage, 'May');
  assert.equal(restored.sourceRevision, '0077');
  assert.equal(wiktionaryRevisionUrl("'শব্দ * (নাম)~!", '12'),
    'https://bn.wiktionary.org/w/index.php?title=%27%E0%A6%B6%E0%A6%AC%E0%A7%8D%E0%A6%A6+%2A+%28%E0%A6%A8%E0%A6%BE%E0%A6%AE%29~%21&oldid=12');
});

test('definition text is preserved as text, including HTML characters and multiple meanings', () => {
  const original = entry('bn', 'শব্দ', { definitionsBn: ['<শব্দ> & "অর্থ" — উদাহরণ নয়।', 'দ্বিতীয়\nসংজ্ঞা'], definition: 'original extra field' });
  const restored = unpackDictionary(packDictionary({ entries: [original] })).entries[0];
  assertEntryValues(restored, original);
  assert.deepEqual(restored.definitionsBn, original.definitionsBn);
  assert.equal(restored.definitionBn, undefined, 'the codec does not synthesize duplicate joined prose');
});

test('mixed languages, uncommon source metadata, custom URLs and translation overrides roundtrip', () => {
  const originals = [
    entry('bn', 'শব্দ', { sourceUrl: 'https://example.org/pinned/source', sourceLabels: [] }),
    entry('en', 'word', { id: 'independent-id', sourceName: 'Another contributor', en: 'word variant', bn: ['শব্দ'], sourceDirection: 'en-bn' }),
  ];
  const restored = unpackDictionary(packDictionary({ entries: originals })).entries;
  originals.forEach((expected, index) => assertEntryValues(restored[index], expected));
});

test('absent optional fields remain absent, while explicit nulls remain null', () => {
  const first = entry('bn', 'শব্দ'); delete first.pos;
  const second = entry('bn', 'বাক্য', { id: 'second', pos: null, sourceLabels: null });
  const restored = unpackDictionary(packDictionary({ entries: [first, second] })).entries;
  assert.equal(Object.hasOwn(restored[0], 'pos'), false);
  assert.equal(restored[1].pos, null);
  assert.equal(restored[1].sourceLabels, null);
});

test('malformed compact records and non-source legacy entries cannot be silently packed', () => {
  assert.throws(() => packDictionary({ entries: [{ en: 'word', bn: ['শব্দ'] }] }), /explicit headwords/);
  assert.throws(() => unpackDictionary({ format: COMPACT_DICTIONARY_FORMAT, entries: [['short']] }), /Malformed/);
});
