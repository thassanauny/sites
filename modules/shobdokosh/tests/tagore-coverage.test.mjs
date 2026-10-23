import assert from 'node:assert/strict';
import test from 'node:test';
import { auditTagoreCoverage, groupCoverageWords } from '../dist/coverage-core.js';
import { buildIndex, resolveBanglaWord } from '../dist/search.js';

const dictionary = [
  { id: 'book', en: 'book', bn: ['বই'], pos: 'noun' },
  { id: 'house', en: 'house', bn: ['বাড়ি'], pos: 'noun' },
  { id: 'deed', en: 'deed', bn: ['কর্ম'], pos: 'noun' },
  { id: 'do', en: 'do', bn: ['করা'], pos: 'verb' },
  { id: 'tax', en: 'tax', bn: ['কর'], pos: 'noun' },
];
const index = buildIndex(dictionary);
const works = [
  { id: 'poem', title: 'Example poem', collection: 'Example collection', genre: 'poetry', url: 'https://example.org/poem', sha256: 'a', tokenCount: 16, sourceId: 'test' },
  { id: 'prose', title: 'Example prose', collection: 'Example collection', genre: 'prose', url: 'https://example.org/prose', sha256: 'b', tokenCount: 5, sourceId: 'test' },
];
const corpus = {
  meta: { coverageScope: 'These two test records only.', limitations: ['Source limitation.'] },
  words: [
    { word: 'বই', count: 5, exampleSources: ['poem'], countsByGenre: { poetry: 5 } },
    { word: 'বাড়ি', count: 2, exampleSources: ['poem'], countsByGenre: { poetry: 2 } },
    { word: 'বাড়ি', count: 3, exampleSources: ['prose'], countsByGenre: { prose: 3 } },
    { word: 'কর্ম্ম', count: 4, exampleSources: ['poem'], countsByGenre: { poetry: 4 } },
    { word: 'করিয়াছি', count: 2, exampleSources: ['poem'], countsByGenre: { poetry: 2 } },
    { word: 'অচেনাশব্দ', count: 3, exampleSources: ['poem'], countsByGenre: { poetry: 3 } },
    { word: 'অন্যঅচেনাশব্দ', count: 2, exampleSources: ['prose'], countsByGenre: { prose: 2 } },
  ], works,
};
const run = (overrides = {}) => auditTagoreCoverage({ corpus, resolve: word => resolveBanglaWord(index, word), ...overrides });

test('coverage denominators group canonical and invisible-format variants before counting', () => {
  const grouped = groupCoverageWords([
    { word: 'বাড়ি', count: 2, exampleSources: ['one'] },
    { word: '\ufeffবাড়ি\u200d', count: 3, exampleSources: ['two'] },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].word, 'বাড়ি'.normalize('NFC'));
  assert.equal(grouped[0].count, 5);
  assert.deepEqual(grouped[0].exampleSources, ['one', 'two']);
});

test('every form and token belongs to exactly one exact/inferred/unresolved bucket', () => {
  const { report } = run();
  assert.equal(report.stats.rawVocabularyRecords, 7);
  assert.equal(report.stats.uniqueForms, 6);
  assert.equal(report.stats.totalTokens, 21);
  assert.equal(report.stats.exact.uniqueForms, 2);
  assert.equal(report.stats.exact.tokens, 10);
  assert.equal(report.stats.inferred.uniqueForms, 2);
  assert.equal(report.stats.inferred.tokens, 6);
  assert.equal(report.stats.unresolved.uniqueForms, 2);
  assert.equal(report.stats.unresolved.tokens, 5);
  assert.equal(['exact', 'inferred', 'unresolved'].reduce((sum, key) => sum + report.stats[key].uniqueForms, 0), report.stats.uniqueForms);
  assert.equal(['exact', 'inferred', 'unresolved'].reduce((sum, key) => sum + report.stats[key].tokens, 0), report.stats.totalTokens);
});

test('historical spellings and literary verb bases are inferred, never exact meanings', () => {
  assert.equal(resolveBanglaWord(index, 'কর্ম্ম').exact, false);
  const verb = resolveBanglaWord(index, 'করিয়াছি');
  assert.equal(verb.exact, false);
  assert.ok(verb.entries.some(entry => entry.id === 'do'));
  assert.ok(!verb.entries.some(entry => entry.id === 'tax'));
  assert.equal(resolveBanglaWord(index, 'অচেনাশব্দ').entries.length, 0);
  const { unresolved } = run();
  assert.deepEqual(unresolved.map(entry => entry.word), ['অচেনাশব্দ', 'অন্যঅচেনাশব্দ']);
});

test('an exact dictionary headword takes precedence over a conjugation candidate', () => {
  const withExact = buildIndex([...dictionary, { id: 'exact-kore', en: 'by hand', bn: ['করে'], pos: 'noun' }]);
  const match = resolveBanglaWord(withExact, 'করে');
  assert.equal(match.exact, true);
  assert.deepEqual(match.entries.map(entry => entry.id), ['exact-kore']);
  assert.ok(!match.entries[0].lookup);
});

test('ordinary nouns remain exact and are not reinterpreted as new verb candidates', () => {
  const nouns = buildIndex([{ id: 'abroad', en: 'abroad', bn: ['বিদেশ'], pos: 'noun' }]);
  const result = resolveBanglaWord(nouns, 'বিদেশ');
  assert.equal(result.exact, true);
  assert.deepEqual(result.entries.map(entry => entry.id), ['abroad']);
  assert.ok(!result.entries[0].lookup);
  assert.deepEqual(resolveBanglaWord(nouns, 'বুঝি').entries, []);
});

test('an unknown form stays unresolved even when a resolver erroneously flags it exact', () => {
  const { report } = run({ resolve: () => ({ entries: [], exact: true }) });
  assert.equal(report.stats.exact.tokens, 0);
  assert.equal(report.stats.inferred.tokens, 0);
  assert.equal(report.stats.unresolved.tokens, 21);
  assert.equal(report.stats.unresolved.uniqueForms, 6);
});

test('source records never imply a complete author bibliography or distinct literary-work count', () => {
  const declaredComplete = { ...corpus, meta: { ...corpus.meta, coverageStatus: 'complete', fullAuthorCoverageVerified: true } };
  const { report } = run({ corpus: declaredComplete });
  assert.equal(report.meta.fullAuthorCoverageVerified, false);
  assert.equal(report.meta.coverageStatus, 'source-corpus-audit-not-complete-author-bibliography');
  assert.equal(report.meta.sourceCoverageScope, 'These two test records only.');
  assert.equal(report.sourceInventory.distinctLiteraryWorkCount, null);
  assert.equal(report.sourceInventory.distinctLiteraryWorkCountVerified, false);
  assert.equal(report.sourceInventory.recordCount, 2);
  assert.equal(report.sourceInventory.uniqueRecordIdCount, 2);
  assert.equal(report.sourceInventory.uniqueContentHashCount, 2);
  assert.ok(report.meta.limitations.includes('Source limitation.'));
});

test('per-genre coverage uses full occurrence counts and sums correctly', () => {
  const { report } = run();
  const poetry = report.perGenre.find(row => row.genre === 'poetry');
  const prose = report.perGenre.find(row => row.genre === 'prose');
  assert.equal(poetry.lexicalCoverage.totalTokens, 16);
  assert.equal(poetry.lexicalCoverage.exact.tokens, 7);
  assert.equal(poetry.lexicalCoverage.inferred.tokens, 6);
  assert.equal(poetry.lexicalCoverage.unresolved.tokens, 3);
  assert.equal(prose.lexicalCoverage.totalTokens, 5);
  assert.equal(prose.lexicalCoverage.exact.tokens, 3);
  assert.equal(prose.lexicalCoverage.unresolved.tokens, 2);
});

test('limited example records are never substituted for per-genre occurrence counts', () => {
  const withoutGenreCounts = {
    ...corpus,
    words: corpus.words.map(({ countsByGenre, ...word }) => word),
  };
  const { report } = run({ corpus: withoutGenreCounts });
  assert.ok(report.perGenre.every(row => row.lexicalCoverage === null));
  assert.ok(report.perGenre.every(row => /examples are not/u.test(row.limitation)));
  assert.equal(report.perGenre.reduce((sum, row) => sum + row.tokenCount, 0), 21);
});

test('reports include deterministic source examples and supplied reproducibility fingerprints', () => {
  const fingerprints = [{ path: 'dictionary.json', sha256: 'abc123', entryCount: 5 }];
  const { report, unresolved } = run({ dictionaryFingerprints: fingerprints });
  assert.deepEqual(report.meta.dictionaryFingerprints, fingerprints);
  assert.equal(report.meta.auditDate, '2026-10-23');
  assert.equal(report.topUnresolved[0].word, unresolved[0].word);
  assert.equal(report.topUnresolved[0].examples[0].title, 'Example poem');
  assert.equal(report.topUnresolved[0].examples[0].url, 'https://example.org/poem');
  assert.deepEqual(run({ dictionaryFingerprints: fingerprints }), { report, unresolved });
});

test('invalid occurrence counts fail instead of silently shrinking the coverage denominator', () => {
  for (const count of [0, -1, 1.5, NaN, '3']) {
    assert.throws(() => groupCoverageWords([{ word: 'বই', count }]), /positive safe integer/u);
  }
  assert.throws(() => groupCoverageWords([{ word: '\ufeff', count: 1 }]), /empty/u);
  assert.throws(() => groupCoverageWords([{ word: 'বই', count: 3, countsByGenre: { poetry: 2 } }]), /do not sum/u);
});
