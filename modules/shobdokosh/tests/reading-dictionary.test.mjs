import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIndex, normalize, searchDictionary } from '../dist/search.js';

const dictionary = JSON.parse(await readFile(new URL('../dist/data/reading-dictionary.json', import.meta.url), 'utf8'));

test('reading senses retain grouped short equivalents and sanitized context', () => {
  const ids = new Set();
  for (const entry of dictionary.entries) {
    assert.match(entry.id, /^reading-[0-9a-f]{20}$/);
    assert.ok(!ids.has(entry.id));
    ids.add(entry.id);
    assert.ok(entry.en && entry.bn.length > 0 && entry.pos);
    if (entry.sourceDirection === 'en-bn') {
      assert.ok(entry.bn.every(word => word.length <= 55 && word.split(/\s+/u).length <= 4));
    }
    assert.ok(entry.bn.every(word => /[\u0980-\u09ff]/u.test(word) && !/[{}\[\]<>]/u.test(word)));
    const context = entry.sourceDirection === 'en-bn' ? entry.definitionBn : entry.definition;
    assert.ok(context, `source context missing on ${entry.id}`);
    assert.ok(!/[{}\[\]<>]/u.test(context));
    assert.ok(entry.sourceDirection === 'en-bn' ? /[\u0980-\u09ff]/u.test(context) : !/[\u0980-\u09ff]/u.test(context));
  }
  assert.ok(dictionary.entries.some(entry => entry.bn.length > 1), 'actual source equivalents should stay grouped');
  assert.equal(dictionary.meta.entryCount, dictionary.entries.length);
});

test('every reading sense links to the source revision and retains its open license', () => {
  for (const entry of dictionary.entries) {
    assert.equal(entry.sourceLicense, 'CC-BY-SA-4.0');
    const source = new URL(entry.sourceUrl);
    assert.equal(source.origin, 'https://bn.wiktionary.org');
    assert.equal(source.searchParams.get('title'), entry.sourcePage);
    assert.equal(source.searchParams.get('oldid'), entry.sourceRevision);
    assert.match(entry.sourceRevision, /^\d+$/);
  }
});

test('reading words are searchable both ways without recounting the established dictionaries', async () => {
  const existing = new Set();
  for (const name of ['dictionary.json', 'expanded-dictionary.json', 'literary-dictionary.json', 'bn-wiktionary-dictionary.json', 'featured.json']) {
    const value = JSON.parse(await readFile(new URL(`../dist/data/${name}`, import.meta.url), 'utf8'));
    for (const entry of Array.isArray(value) ? value : value.entries) {
      for (const word of entry.bn) existing.add(`${normalize(entry.en)}\0${normalize(word)}`);
    }
  }
  const index = buildIndex(dictionary.entries);
  for (const entry of dictionary.entries) {
    for (const word of entry.bn) assert.ok(!existing.has(`${normalize(entry.en)}\0${normalize(word)}`));
  }
  for (const entry of dictionary.entries.filter((_, number) => number % 1000 === 0)) {
    assert.ok(searchDictionary(index, entry.en, 'en', Infinity).entries.some(result => result.id === entry.id));
    assert.ok(searchDictionary(index, entry.bn[0], 'bn', Infinity).entries.some(result => result.id === entry.id));
  }
});

test('reviewed misleading source mappings are omitted', () => {
  const pairs = new Set(dictionary.entries.flatMap(entry => entry.bn.map(word => `${normalize(entry.en)}\0${normalize(word)}`)));
  for (const [en, bn] of [
    ['genre', 'উপায়'], ['awesome', 'সন্ত্রস্ত'], ['happiness', 'স্বাস্থ্য'],
    ['dwindle', 'অবক্ষয়'], ['dwindle', 'ভেঙে ফেলা'], ['fly', 'মশা'], ['fly', 'মশক'],
    ['mandatory', 'আদেশ'], ['reduce', 'অনুবাদ করা'],
    ['Southeast Asia', 'পূর্ব তিমুর'], ['gnathostome', 'সরীসৃপ'], ['ironmonger', 'হার্ডওয়্যার'],
  ]) assert.ok(!pairs.has(`${normalize(en)}\0${normalize(bn)}`), `${en} should not become ${bn}`);
});

test('a source-attested uncommon adjective and ordinary dwindle verb phrases remain available', () => {
  assert.ok(dictionary.entries.some(entry => normalize(entry.en) === 'portable' && entry.bn.includes('সুবহ')));
  assert.ok(dictionary.entries.some(entry => normalize(entry.en) === 'dwindle' && entry.bn.includes('হ্রাস পাওয়া')));
});
