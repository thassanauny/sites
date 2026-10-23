import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIndex, normalize, searchDictionary } from '../dist/search.js';

const dataset = JSON.parse(await readFile(new URL('../dist/data/bn-wiktionary-dictionary.json', import.meta.url), 'utf8'));
const index = buildIndex(dataset.entries);

test('the official Bengali-edition supplement adds actual literary meanings in both directions', () => {
  for (const [word, expected] of [
    ['গোধূলি', /dusk|twilight/], ['পারাবার', /sea|ocean/], ['বলাকা', /crane/],
    ['লাবণ্য', /beauty|grace|charm/], ['মৃণাল', /lotus/], ['শাশ্বত', /eternal|everlasting/],
  ]) {
    const meanings = searchDictionary(index, word, 'bn').entries.filter(entry => entry.bn.includes(word));
    assert.ok(meanings.some(entry => expected.test(entry.en)), `${word} must have its actual sourced meaning`);
    for (const entry of meanings) {
      assert.ok(searchDictionary(index, entry.en, 'en').entries.some(result => result.id === entry.id));
    }
  }
});

test('every imported pair retains its original page revision and CC BY-SA attribution', () => {
  const ids = new Set();
  for (const entry of dataset.entries) {
    assert.match(entry.id, /^bn-wikt-[0-9a-f]{20}$/);
    assert.ok(!ids.has(entry.id));
    ids.add(entry.id);
    assert.equal(entry.sourceKind, 'direct');
    assert.equal(entry.sourceLicense, 'CC-BY-SA-4.0');
    assert.match(entry.sourceRevision, /^\d+$/);
    const source = new URL(entry.sourceUrl);
    assert.equal(source.origin, 'https://bn.wiktionary.org');
    assert.equal(source.searchParams.get('oldid'), entry.sourceRevision);
    assert.equal(source.searchParams.get('title'), entry.sourcePage);
    assert.equal(normalize(entry.sourcePage), normalize(entry.bn[0]));
  }
  assert.equal(dataset.meta.sourceSha1, '632e9b8b684f8386b4e37e645303febb21509337');
  assert.equal(dataset.meta.entryCount, dataset.entries.length);
});

test('the supplement does not recount pairs already in the other four dictionaries', async () => {
  const known = new Set();
  for (const name of ['dictionary.json', 'expanded-dictionary.json', 'literary-dictionary.json', 'featured.json']) {
    const data = JSON.parse(await readFile(new URL(`../dist/data/${name}`, import.meta.url), 'utf8'));
    for (const entry of Array.isArray(data) ? data : data.entries) {
      for (const word of entry.bn) known.add(`${normalize(entry.en)}\0${normalize(word)}`);
    }
  }
  for (const entry of dataset.entries) {
    assert.ok(!known.has(`${normalize(entry.en)}\0${normalize(entry.bn[0])}`));
  }
});
