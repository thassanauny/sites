import { unpackDictionary } from '../dist/dictionary-format.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const path = new URL('../dist/data/native-bengali.json', import.meta.url);
const dictionary = unpackDictionary(JSON.parse(await readFile(path, 'utf8')));
const normalize = (text) => text.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g, '').trim();

test('native Bengali words have real source definitions and honest metadata', () => {
  const { entries, meta } = dictionary;
  assert.ok(entries.length > 70000);
  assert.equal(meta.entryCount, entries.length);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  const heads = new Set(entries.map((entry) => normalize(entry.headword)));
  assert.equal(meta.statistics.bengaliHeadwords, heads.size);
  assert.equal(meta.statistics.englishHeadwords, 0);
  assert.equal(meta.statistics.singleWordHeadwords + meta.statistics.multiwordHeadwords, heads.size);
  assert.equal(meta.statistics.definitionCount, entries.reduce((sum, entry) => sum + entry.definitionsBn.length, 0));
  for (const entry of entries) {
    assert.match(entry.id, /^native-bn-[a-f0-9]{20}$/);
    assert.equal(entry.language, 'bn');
    assert.equal(entry.en, '');
    assert.deepEqual(entry.bn, [entry.headword]);
    assert.equal(entry.sourceKind, 'native');
    assert.equal(entry.sourceLicense, 'CC-BY-SA-4.0');
    const source = new URL(entry.sourceUrl);
    assert.equal(source.hostname, 'bn.wiktionary.org');
    assert.equal(source.searchParams.get('oldid'), entry.sourceRevision);
    assert.equal(source.searchParams.get('title'), entry.sourcePage);
    assert.ok(entry.definitionsBn.length > 0);
    assert.equal(new Set(entry.definitionsBn).size, entry.definitionsBn.length);
    assert.equal(entry.definitionBn, undefined, 'do not duplicate all definition text');
    for (const definition of entry.definitionsBn) {
      assert.match(definition, /[\u0980-\u09ff]/);
      assert.doesNotMatch(definition, /[{}\[\]<>|]|https?:\/\//);
      assert.doesNotMatch(definition, /^[#*:;]/);
    }
  }
});

test('native dictionary includes source-attested literary and everyday meanings', () => {
  for (const word of ['নৈবেদ্য', 'সুধা', 'অভিসার', 'অনিমেষ', 'পুলক', 'তেমনি', 'পল্লব', 'কুসুম', 'কাঠমিস্ত্রি']) {
    const found = dictionary.entries.filter((entry) => normalize(entry.headword) === normalize(word));
    assert.ok(found.length, `missing ${word}`);
    assert.ok(found.every((entry) => entry.definitionsBn.length));
  }
});
