import { normalize } from './search.js';

const PROPER_NAMES = new Set(['proper noun', 'proper name', 'name']);
const NON_LEXICAL = new Set([
  'letter', 'character', 'symbol', 'punctuation', 'punctuation mark',
  'prefix', 'suffix', 'affix', 'infix', 'circumfix', 'interfix', 'combining form',
]);

function hasText(value) {
  return typeof value === 'string' && Boolean(normalize(value));
}

function hasDefinition(entry) {
  return hasText(entry.definition) || hasText(entry.definitionBn)
    || (Array.isArray(entry.definitionsBn) && entry.definitionsBn.some(hasText))
    || (Array.isArray(entry.definitions) && entry.definitions.some(hasText));
}

function partOfSpeech(value) {
  return normalize(value).replace(/[_-]+/g, ' ');
}

/**
 * Count attested, defined headwords separately from senses and search strings.
 * English gloss sentences are searchable but never become English headwords.
 * A headword with an ordinary sense remains lexical even when it has another
 * proper-name or affix sense. Missing POS is reported separately, not inferred.
 */
export function getVocabularyStats(entries) {
  const englishLookups = new Set();
  const bengaliLookups = new Set();
  const bilingualPairs = new Set();
  const headwords = { en: new Map(), bn: new Map() };
  let usableSenseCount = 0;
  let bilingualSenseCount = 0;
  let definitionOnlySenseCount = 0;

  function addHeadword(language, value, pos) {
    const word = normalize(value);
    if (!word || !/\p{L}/u.test(word)) return;
    if (language === 'bn' && !/[\u0980-\u09ff]/u.test(word)) return;
    if (language === 'en' && /[\u0980-\u09ff]/u.test(word)) return;
    const records = headwords[language];
    if (!records.has(word)) records.set(word, new Set());
    records.get(word).add(partOfSpeech(pos));
  }

  for (const entry of entries) {
    const en = normalize(entry.en);
    const bn = Array.isArray(entry.bn) ? entry.bn.map(normalize).filter(Boolean) : [];
    if (en) englishLookups.add(en);
    for (const word of bn) bengaliLookups.add(word);
    const bilingual = Boolean(en && bn.length);
    const usable = bilingual || hasDefinition(entry);
    if (bilingual) {
      bilingualSenseCount += 1;
      for (const word of bn) bilingualPairs.add(`${en}\0${word}`);
    }
    if (!usable) continue;
    usableSenseCount += 1;
    if (!bilingual) definitionOnlySenseCount += 1;

    if (entry.language === 'en' || entry.language === 'bn') {
      if (hasText(entry.headword)) addHeadword(entry.language, entry.headword, entry.pos);
    }
    // Existing bilingual records contain source-attested Bangla headwords or
    // equivalents. A Bangla-only record must carry its own usable definition.
    for (const word of bn) addHeadword('bn', word, entry.pos);

    // Legacy imports mix actual English source heads with descriptive glosses
    // in the same `en` field. Include only origins that establish source heads.
    if (entry.language !== 'bn' && en) {
      if (entry.enKind === 'headword') addHeadword('en', en, entry.pos);
      else if (entry.sourceDirection === 'en-bn') addHeadword('en', entry.sourcePage || en, entry.pos);
      else if (entry.sourceKind === 'community') addHeadword('en', en, entry.pos);
      else if (entry.sourceKind === 'direct' && !entry.sourcePage && !entry.sourceDirection) addHeadword('en', en, entry.pos);
      else if (typeof entry.id === 'string' && entry.id.startsWith('featured-')) addHeadword('en', en, entry.pos);
    }
  }

  function summarize(records) {
    const stats = {
      definedHeadwordCount: records.size,
      lexicalHeadwordCount: 0,
      lexicalSingleWordCount: 0,
      lexicalPhraseCount: 0,
      properNameOnlyHeadwordCount: 0,
      nonLexicalOnlyHeadwordCount: 0,
      unknownPartOfSpeechHeadwordCount: 0,
    };
    for (const [word, parts] of records) {
      const knownParts = [...parts].filter(Boolean);
      // A missing POS does not invent an ordinary sense for a headword whose
      // only attested parts of speech are names, characters or affixes.
      const onlyNames = knownParts.length > 0 && knownParts.every(pos => PROPER_NAMES.has(pos));
      const onlyExcluded = knownParts.length > 0
        && knownParts.every(pos => PROPER_NAMES.has(pos) || NON_LEXICAL.has(pos));
      if (onlyNames) stats.properNameOnlyHeadwordCount += 1;
      else if (onlyExcluded) stats.nonLexicalOnlyHeadwordCount += 1;
      else {
        stats.lexicalHeadwordCount += 1;
        if (/\s/u.test(word)) stats.lexicalPhraseCount += 1;
        else stats.lexicalSingleWordCount += 1;
        if (parts.has('')) stats.unknownPartOfSpeechHeadwordCount += 1;
      }
    }
    return stats;
  }

  const languages = { en: summarize(headwords.en), bn: summarize(headwords.bn) };
  const combined = Object.fromEntries(Object.keys(languages.en)
    .map(key => [key, languages.en[key] + languages.bn[key]]));
  return {
    senseCount: entries.length,
    usableSenseCount,
    bilingualSenseCount,
    definitionOnlySenseCount,
    englishLookupStringCount: englishLookups.size,
    bengaliLookupStringCount: bengaliLookups.size,
    bilingualPairCount: bilingualPairs.size,
    ...combined,
    languages,
  };
}
