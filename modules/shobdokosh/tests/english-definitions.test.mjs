import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIndex, normalize, searchDictionary } from '../dist/search.js';
import { unpackDictionary } from '../dist/dictionary-format.js';

const value = unpackDictionary(JSON.parse(await readFile(new URL('../dist/data/english-bangla-definitions.json', import.meta.url), 'utf8')));

test('English headwords retain whole sourced Bengali definitions and no invented reverse headwords', () => {
  const ids = new Set();
  for (const entry of value.entries) {
    assert.match(entry.id, /^en-def-[0-9a-f]{20}$/u);
    assert.ok(!ids.has(entry.id));
    ids.add(entry.id);
    assert.equal(entry.language, 'en');
    assert.equal(entry.sourceKind, 'definition');
    assert.equal(entry.headword, entry.en);
    assert.deepEqual(entry.bn, []);
    assert.ok(entry.definitionsBn.length > 0);
    assert.ok(!Object.hasOwn(entry, 'definitionBn'), 'definition prose is stored only once');
    for (const definition of entry.definitionsBn) {
      assert.ok(/[\u0980-\u09ff]/u.test(definition));
      assert.ok(!/[{}\[\]<>|=]/u.test(definition));
      assert.ok(!definition.includes('বিষয়ক নির্দিষ্ট ধারণা, অবস্থা বা প্রক্রিয়া'));
    }
  }
  assert.equal(value.meta.entryCount, value.entries.length);
  assert.equal(value.meta.englishHeadwords, new Set(value.entries.map(entry => normalize(entry.headword))).size);
});

test('every full definition retains the actual English source title and revision license', () => {
  for (const entry of value.entries) {
    const url = new URL(entry.sourceUrl);
    assert.equal(url.origin, 'https://bn.wiktionary.org');
    assert.equal(url.searchParams.get('title'), entry.en);
    assert.equal(url.searchParams.get('title'), entry.sourcePage);
    assert.equal(url.searchParams.get('oldid'), entry.sourceRevision);
    assert.equal(entry.sourceLicense, 'CC-BY-SA-4.0');
  }
});

test('English prose lookup does not turn examples or fragment nouns into Bengali translations', () => {
  const index = buildIndex(value.entries);
  const result = searchDictionary(index, 'ironmonger', 'en').entries.find(entry => entry.en === 'ironmonger');
  assert.ok(result.definitionsBn.some(text => text.includes('বিক্রেতা')));
  assert.ok(!searchDictionary(index, 'হার্ডওয়্যার', 'bn', Infinity).entries.some(entry => entry.id === result.id));
  assert.ok(!searchDictionary(index, 'বিক্রেতা', 'bn', Infinity).entries.some(entry => entry.id === result.id));
});

test('ordinary and uncommon English narrative definitions remain available', () => {
  const meanings = word => value.entries.filter(entry => normalize(entry.en) === word).flatMap(entry => entry.definitionsBn);
  assert.ok(meanings('permaculture').some(text => text.includes('কৃষি')));
  assert.ok(meanings('overcharge').some(text => text.includes('বেশি দাম')));
  assert.ok(meanings('gnathostome').some(text => text.includes('যেমন') && text.includes('মেরুদণ্ডী প্রাণী')));
  assert.ok(!meanings('nothing').some(text => text === 'কি'));
  assert.ok(!meanings('murder').some(text => text.includes('পাচার')));
  assert.ok(meanings('felid').some(text => text.includes('Felidae') && text.includes('বিড়াল')));
});
