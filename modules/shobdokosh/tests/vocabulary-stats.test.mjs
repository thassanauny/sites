import test from 'node:test';
import assert from 'node:assert/strict';
import { getVocabularyStats } from '../dist/vocabulary-stats.js';

test('native Bangla and English definitions count actual heads without a translation', () => {
  const stats = getVocabularyStats([
    { headword: 'কুহেলি', language: 'bn', en: '', bn: ['কুহেলি'], pos: 'noun', definitionBn: 'কুয়াশা।' },
    { headword: 'serendipity', language: 'en', en: 'serendipity', bn: [], pos: 'noun', definitionsBn: ['সৌভাগ্যক্রমে কিছু খুঁজে পাওয়া।'] },
    { headword: 'শূন্য', language: 'bn', en: '', bn: ['শূন্য'], pos: 'adjective', definitionBn: '  ' },
  ]);
  assert.equal(stats.senseCount, 3);
  assert.equal(stats.usableSenseCount, 2);
  assert.equal(stats.definedHeadwordCount, 2);
  assert.equal(stats.lexicalHeadwordCount, 2);
  assert.equal(stats.definitionOnlySenseCount, 2);
  assert.equal(stats.bilingualSenseCount, 0);
  assert.equal(stats.bilingualPairCount, 0);
  assert.equal(stats.languages.bn.lexicalHeadwordCount, 1);
  assert.equal(stats.languages.en.lexicalHeadwordCount, 1);
});

test('duplicate senses and zero-width spelling variants do not inflate headword counts', () => {
  const stats = getVocabularyStats([
    { en: ' Beauty ', bn: ['সৌন্দর্য'], pos: 'noun', sourceKind: 'community' },
    { en: 'beauty', bn: ['সৌন্\u200dদর্য'], pos: 'noun', sourceKind: 'community' },
    { en: 'beauty', bn: ['সৌন্দর্য'], pos: 'noun', sourceKind: 'community' },
  ]);
  assert.equal(stats.senseCount, 3);
  assert.equal(stats.definedHeadwordCount, 2);
  assert.equal(stats.englishLookupStringCount, 1);
  assert.equal(stats.bengaliLookupStringCount, 1);
  assert.equal(stats.bilingualPairCount, 1);
});

test('searchable English gloss descriptions never become counted English headwords', () => {
  const stats = getVocabularyStats([
    { en: 'a feeling of deep sadness caused by separation', bn: ['বিরহ'], sourceKind: 'gloss', pos: 'noun' },
    { en: 'cupped hands; offering', bn: ['অঞ্জলি'], sourceKind: 'curated', pos: 'noun' },
    { en: 'fog', bn: ['কুহেলি'], sourceKind: 'direct', sourcePage: 'কুহেলি', pos: 'noun' },
  ]);
  assert.equal(stats.englishLookupStringCount, 3);
  assert.equal(stats.languages.en.definedHeadwordCount, 0);
  assert.equal(stats.languages.bn.definedHeadwordCount, 3);
});

test('legacy actual English source titles and editorial heads remain counted', () => {
  const stats = getVocabularyStats([
    { en: 'beautiful', bn: ['সুন্দর'], sourceKind: 'direct', pos: 'adjective' },
    { en: 'all right', bn: ['ঠিক আছে'], sourceKind: 'community' },
    { en: 'come', bn: ['আসা'], sourceDirection: 'en-bn', sourcePage: 'come', pos: 'verb' },
    { id: 'featured-wonder', en: 'wonder', bn: ['বিস্ময়'], pos: 'noun' },
  ]);
  assert.equal(stats.definedHeadwordCount, 8);
  assert.equal(stats.lexicalSingleWordCount, 6);
  assert.equal(stats.lexicalPhraseCount, 2);
  assert.equal(stats.unknownPartOfSpeechHeadwordCount, 2);
});

test('proper names and nonlexical entries do not pad the lexical target', () => {
  const make = (headword, pos) => ({ headword, language: 'en', en: headword, bn: [], pos, definitionBn: 'উৎসে থাকা একটি অর্থ।' });
  const stats = getVocabularyStats([
    make('London', 'proper noun'), make('A', 'letter'), make('un-', 'prefix'),
    { en: 'London', bn: ['লন্ডন'], sourceKind: 'community' },
    make('May', 'proper noun'), make('may', 'verb'),
    make('suffix-name', 'proper noun'), make('suffix-name', 'suffix'),
    make('well-being', 'noun'), make('look up', 'verb'),
  ]);
  assert.equal(stats.definedHeadwordCount, 8);
  assert.equal(stats.lexicalHeadwordCount, 4);
  assert.equal(stats.lexicalSingleWordCount, 3);
  assert.equal(stats.lexicalPhraseCount, 1);
  assert.equal(stats.properNameOnlyHeadwordCount, 1);
  assert.equal(stats.nonLexicalOnlyHeadwordCount, 3);
});

test('an explicit Bangla headword does not convert its English explanation into a headword', () => {
  const stats = getVocabularyStats([
    { language: 'bn', headword: 'নির্ঝর', en: 'a small flowing stream', bn: ['নির্ঝর'], sourceKind: 'community', pos: 'noun' },
  ]);
  assert.equal(stats.definedHeadwordCount, 1);
  assert.equal(stats.languages.en.definedHeadwordCount, 0);
});
