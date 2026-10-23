// Coverage is measured against an identified source inventory, never against
// an unverified claim that an author's complete bibliography was collected.
const BASE_LIMITATIONS = [
  'This audit measures dictionary lookups for the supplied source inventory; it does not verify completeness of Tagore’s entire bibliography.',
  'An exact match means a dictionary headword exists, not that every literary sense or contextual meaning has been verified.',
  'Inferred matches expose a related dictionary base form or modern spelling; they are not exact definitions of the literary surface form.',
  'Unresolved words can include inflections, historical spellings, Brajabuli, names, compounds and transcription errors; corpus occurrence alone supplies no verified meaning.',
  'Source records can group songs or represent introductory pieces; record counts are not counts of distinct literary works.',
];

export function normalizeCoverageWord(value) {
  return String(value ?? '').normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/gu, ' ').trim();
}

const percent = (count, total) => total ? Math.round(count / total * 10000) / 100 : 0;
const compareWords = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const emptyBuckets = () => ({
  exact: { uniqueForms: 0, tokens: 0 },
  inferred: { uniqueForms: 0, tokens: 0 },
  unresolved: { uniqueForms: 0, tokens: 0 },
});

function finalizeBuckets(buckets, uniqueForms, totalTokens) {
  return Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, {
    ...value,
    uniquePercent: percent(value.uniqueForms, uniqueForms),
    tokenPercent: percent(value.tokens, totalTokens),
  }]));
}

function positiveCount(value, description) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${description} must be a positive safe integer`);
  }
  return value;
}

/** Merge canonical/formatting variants before calculating either denominator. */
export function groupCoverageWords(records) {
  if (!Array.isArray(records)) throw new TypeError('Corpus words must be an array');
  const grouped = new Map();
  for (const record of records) {
    const word = normalizeCoverageWord(record.word);
    if (!word) throw new TypeError('Corpus word must not be empty after normalization');
    const count = positiveCount(record.count, `Count for ${word}`);
    if (!grouped.has(word)) {
      grouped.set(word, { word, count: 0, exampleSources: new Set(), countsByGenre: {}, hasGenreCounts: true });
    }
    const current = grouped.get(word);
    current.count += count;
    for (const id of record.exampleSources ?? []) current.exampleSources.add(String(id));
    if (record.countsByGenre && typeof record.countsByGenre === 'object') {
      let genreTotal = 0;
      for (const [genre, occurrences] of Object.entries(record.countsByGenre)) {
        positiveCount(occurrences, `Genre count for ${word} / ${genre}`);
        current.countsByGenre[genre] = (current.countsByGenre[genre] ?? 0) + occurrences;
        genreTotal += occurrences;
      }
      if (genreTotal !== count) throw new RangeError(`Genre counts do not sum to count for ${word}`);
    } else {
      current.hasGenreCounts = false;
    }
  }
  return [...grouped.values()].map(record => ({
    ...record, exampleSources: [...record.exampleSources].sort(compareWords),
  })).sort((a, b) => compareWords(a.word, b.word));
}

/**
 * `resolve(word)` must perform exact headword lookup first and dictionary/POS
 * validation for any inferred base-form candidate. Substring hits do not count.
 * Every form belongs to exactly one bucket, and a resolver with no entries
 * always counts as unresolved, regardless of an erroneous `exact` flag.
 */
export function auditTagoreCoverage({
  corpus, resolve, dictionaryFingerprints = [], corpusFingerprint = null,
  auditDate = '2026-10-23', unresolvedLimit = 100,
}) {
  if (typeof resolve !== 'function') throw new TypeError('An exact/base-form resolver is required');
  const words = groupCoverageWords(corpus.words);
  const works = Array.isArray(corpus.works) ? corpus.works : [];
  const worksById = new Map(works.map(work => [String(work.id), work]));
  const buckets = emptyBuckets();
  const unknown = [];
  const byGenre = new Map();
  const bySource = new Map();
  for (const work of works) {
    const genre = String(work.genre ?? 'Unspecified');
    if (!byGenre.has(genre)) byGenre.set(genre, { genre, recordCount: 0, tokenCount: 0, buckets: emptyBuckets() });
    const row = byGenre.get(genre);
    row.recordCount += 1;
    row.tokenCount += work.tokenCount ?? 0;
    const sourceId = String(work.sourceId ?? 'unspecified');
    bySource.set(sourceId, (bySource.get(sourceId) ?? 0) + 1);
  }
  let totalTokens = 0;
  const hasFullGenreCounts = words.every(word => word.hasGenreCounts);
  for (const record of words) {
    const result = resolve(record.word);
    const found = Array.isArray(result?.entries) && result.entries.length > 0;
    const status = found ? result.exact === true ? 'exact' : 'inferred' : 'unresolved';
    buckets[status].uniqueForms += 1;
    buckets[status].tokens += record.count;
    totalTokens += record.count;
    if (status === 'unresolved') unknown.push(record);
    if (hasFullGenreCounts) {
      for (const [genre, count] of Object.entries(record.countsByGenre)) {
        if (!byGenre.has(genre)) byGenre.set(genre, { genre, recordCount: 0, tokenCount: 0, buckets: emptyBuckets() });
        const row = byGenre.get(genre);
        row.buckets[status].uniqueForms += 1;
        row.buckets[status].tokens += count;
      }
    }
  }
  unknown.sort((a, b) => b.count - a.count || compareWords(a.word, b.word));
  const unresolved = unknown.map(({ word, count, exampleSources, countsByGenre, hasGenreCounts }) => ({
    word, count, exampleSources, ...(hasGenreCounts ? { countsByGenre } : {}),
  }));
  const sourceMeta = corpus.meta ?? {};
  const limitations = [...new Set([...(sourceMeta.limitations ?? []), ...BASE_LIMITATIONS])];
  const topUnresolved = unresolved.slice(0, unresolvedLimit).map(record => ({
    word: record.word, count: record.count,
    examples: record.exampleSources.map(id => {
      const work = worksById.get(id);
      return work ? {
        id, title: work.title, collection: work.collection, genre: work.genre,
        url: work.url, ...(work.collectionUrl ? { collectionUrl: work.collectionUrl } : {}),
        ...(work.sourceRow ? { sourceRow: work.sourceRow } : {}),
      } : { id, title: 'Source record unavailable', url: null };
    }),
  }));
  const report = {
    meta: {
      schemaVersion: 1, auditDate, author: sourceMeta.author ?? 'Rabindranath Tagore', language: 'bn',
      title: 'Tagore source-corpus dictionary lookup coverage',
      sourceCoverageScope: sourceMeta.coverageScope ?? 'Only the supplied source records.',
      sourceDeclaredCoverageStatus: sourceMeta.coverageStatus ?? 'Not specified by source inventory',
      coverageStatus: 'source-corpus-audit-not-complete-author-bibliography',
      fullAuthorCoverageVerified: false,
      normalization: 'Unicode NFC; zero-width characters and BOM removed; repeated whitespace collapsed; duplicate normalized forms grouped.',
      exactMethod: 'At least one exact indexed Bangla dictionary headword exists.',
      inferredMethod: 'No exact headword; a labelled related base form or modern spelling has an exact dictionary match after resolver validation.',
      denominator: 'All normalized surface forms and their occurrence counts in the supplied corpus; unresolved forms remain in both denominators.',
      sourceUrls: sourceMeta.sourceUrls ?? [], limitations,
      ...(sourceMeta.contextualReferenceUrls ? { contextualReferenceUrls: sourceMeta.contextualReferenceUrls } : {}),
      dictionaryFingerprints, corpusFingerprint,
    },
    stats: {
      rawVocabularyRecords: corpus.words.length, uniqueForms: words.length, totalTokens,
      ...finalizeBuckets(buckets, words.length, totalTokens),
    },
    sourceInventory: {
      recordCount: works.length,
      tokenCountFromRecords: works.reduce((sum, work) => sum + (work.tokenCount ?? 0), 0),
      uniqueRecordIdCount: new Set(works.map(work => work.id)).size,
      uniqueContentHashCount: new Set(works.map(work => work.sha256).filter(Boolean)).size,
      collectionCount: new Set(works.map(work => work.collection).filter(Boolean)).size,
      distinctLiteraryWorkCount: null,
      distinctLiteraryWorkCountVerified: false,
      recordCountsBySource: Object.fromEntries([...bySource].sort(([a], [b]) => compareWords(a, b))),
    },
    perGenre: [...byGenre.values()].sort((a, b) => compareWords(a.genre, b.genre)).map(row => {
      const uniqueForms = Object.values(row.buckets).reduce((sum, bucket) => sum + bucket.uniqueForms, 0);
      const tokens = Object.values(row.buckets).reduce((sum, bucket) => sum + bucket.tokens, 0);
      return {
        genre: row.genre, recordCount: row.recordCount, tokenCount: row.tokenCount,
        lexicalCoverage: hasFullGenreCounts ? {
          uniqueForms, totalTokens: tokens, ...finalizeBuckets(row.buckets, uniqueForms, tokens),
        } : null,
        ...(!hasFullGenreCounts ? { limitation: 'Per-word genre occurrence counts were not supplied; examples are not a genre coverage denominator.' } : {}),
      };
    }),
    works, topUnresolved,
  };
  return { report, unresolved };
}
