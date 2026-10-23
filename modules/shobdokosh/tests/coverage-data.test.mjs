import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const report = JSON.parse(await readFile(new URL('resources/tagore/coverage.json', root), 'utf8'));

test('the development coverage report fingerprints every dictionary used by the app', async () => {
  const expected = [
    'featured', 'dictionary', 'expanded-dictionary', 'literary-dictionary', 'bn-wiktionary-dictionary', 'reading-dictionary', 'native-bengali', 'english-bangla-definitions',
  ].map(name => `dist/data/${name}.json`).sort();
  assert.deepEqual(report.meta.dictionaryFingerprints.map(item => item.path).sort(), expected);
  let senses = 0;
  for (const fingerprint of report.meta.dictionaryFingerprints) {
    const bytes = await readFile(new URL(fingerprint.path, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fingerprint.sha256, `${fingerprint.path}: rerun npm run audit after changing meanings`);
    const data = JSON.parse(bytes);
    const entries = Array.isArray(data) ? data : data.entries;
    assert.equal(entries.length, fingerprint.entryCount);
    senses += entries.length;
  }
  assert.equal(report.dictionary.entryCount, senses);
});

test('the development occurrence and genre totals include every unresolved form', () => {
  const { stats } = report;
  assert.equal(stats.exact.tokens + stats.inferred.tokens + stats.unresolved.tokens, stats.totalTokens);
  assert.equal(stats.exact.uniqueForms + stats.inferred.uniqueForms + stats.unresolved.uniqueForms, stats.uniqueForms);
  assert.equal(report.works.reduce((sum, work) => sum + work.tokenCount, 0), stats.totalTokens);
  assert.equal(report.perGenre.reduce((sum, item) => sum + item.lexicalCoverage.totalTokens, 0), stats.totalTokens);
  assert.equal(report.meta.fullAuthorCoverageVerified, false);
  assert.equal(report.sourceInventory.distinctLiteraryWorkCountVerified, false);
});
