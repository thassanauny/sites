import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unpackDictionary } from '../dist/dictionary-format.js';
import { getVocabularyStats } from '../dist/vocabulary-stats.js';

const root = new URL('../', import.meta.url);
const summary = JSON.parse(await readFile(new URL('dist/data/vocabulary-summary.json', root), 'utf8'));

test('the displayed vocabulary total matches the shipped, defined headwords', async () => {
  const entries = [];
  for (const input of summary.meta.inputs) {
    const bytes = await readFile(new URL(input.path, root));
    assert.equal(bytes.length, input.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256,
      `${input.path}: regenerate the vocabulary summary after changing data`);
    const data = unpackDictionary(JSON.parse(bytes));
    const values = Array.isArray(data) ? data : data.entries;
    assert.equal(values.length, input.entryCount);
    entries.push(...values);
  }
  assert.equal(summary.meta.inputs.length, 8);
  assert.deepEqual(summary.stats, getVocabularyStats(entries));
  assert.ok(summary.stats.lexicalHeadwordCount >= 100000);
  assert.equal(summary.stats.lexicalSingleWordCount + summary.stats.lexicalPhraseCount,
    summary.stats.lexicalHeadwordCount);
  assert.ok(summary.stats.definitionOnlySenseCount > 0);
});
