import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildIndex, dailyEntry, detectDirection, matchingBangla, normalize, searchDictionary, resolveBanglaWord,
} from '../dist/search.js';
import { unpackDictionary } from '../dist/dictionary-format.js';
import { transliterate } from '../dist/transliteration.js';

const dictionary = JSON.parse(await readFile(new URL('../dist/data/dictionary.json', import.meta.url), 'utf8'));
const featured = JSON.parse(await readFile(new URL('../dist/data/featured.json', import.meta.url), 'utf8'));
const supplements = await Promise.all(['expanded-dictionary', 'literary-dictionary', 'bn-wiktionary-dictionary', 'reading-dictionary', 'native-bengali', 'english-bangla-definitions'].map(async name => unpackDictionary(JSON.parse(await readFile(new URL(`../dist/data/${name}.json`, import.meta.url), 'utf8')))));
const entries = [...featured, ...supplements[1].entries, ...dictionary.entries, ...supplements[0].entries, ...supplements[2].entries, ...supplements[3].entries, ...supplements[4].entries, ...supplements[5].entries];
const index = buildIndex(entries);

function entry(id, en, bn) {
  return { id, en, bn };
}

test('English searches ignore accidental capitalization and surrounding whitespace', () => {
  const result = searchDictionary(index, '  WaTeR\n ', 'en');
  assert.equal(result.entries[0].en.toLowerCase(), 'water');
  assert.ok(result.entries[0].bn.includes('পানি'));
  assert.ok(result.entries[0].bn.includes('জল'));
});

test('canonically equivalent Bangla spellings find the same words', () => {
  for (const [composed, decomposed] of [
    ['বাড়ি', 'বাড়ি'],
    ['সড়ক', 'সড়ক'],
    ['বিস্ময়', 'বিস্ময়'],
  ]) {
    const first = searchDictionary(index, composed, 'bn');
    const second = searchDictionary(index, decomposed, 'bn');
    assert.ok(first.total > 0, `${composed} should be available`);
    assert.deepEqual(first, second, `${composed} and ${decomposed} should have identical results`);
  }
});

test('copied Bangla text with invisible formatting characters still finds its word', () => {
  const typed = searchDictionary(index, 'ভালোবাসা', 'bn');
  for (const copied of ['\ufeffভালোবাসা', 'ভালো\u200bবাসা', 'ভালো\u200cবাসা', 'ভালো\u200dবাসা']) {
    assert.deepEqual(searchDictionary(index, copied, 'bn'), typed);
  }
});

test('accented English and repeated spaces are normalized without removing accents', () => {
  const smallIndex = buildIndex([
    entry('cafe', 'café', ['ক্যাফে']),
    entry('journey', 'good morning', ['সুপ্রভাত']),
  ]);
  assert.equal(searchDictionary(smallIndex, 'CAFE\u0301', 'en').entries[0].id, 'cafe');
  assert.equal(searchDictionary(smallIndex, 'GOOD\t\nMORNING', 'en').entries[0].id, 'journey');
  assert.equal(searchDictionary(smallIndex, 'cafe', 'en').total, 0);
});

test('exact meanings appear before prefixes, whole-word matches and incidental substrings', () => {
  const smallIndex = buildIndex([
    entry('substring', 'underwater', ['জলমগ্ন']),
    entry('word', 'cold water', ['ঠান্ডা পানি']),
    entry('long-prefix', 'watermelon', ['তরমুজ']),
    entry('short-prefix', 'watery', ['পাতলা']),
    entry('exact', 'water', ['পানি']),
  ]);
  assert.deepEqual(searchDictionary(smallIndex, 'water', 'en').entries.map(item => item.id), [
    'exact', 'short-prefix', 'long-prefix', 'word', 'substring',
  ]);
});

test('Bangla lookup searches every meaning, including a synonym beyond the first', () => {
  const smallIndex = buildIndex([
    entry('compound', 'aquatic', ['জলজ']),
    entry('water', 'water', ['পানি', 'জল']),
  ]);
  const result = searchDictionary(smallIndex, 'জল', 'bn');
  assert.equal(result.total, 2);
  assert.equal(result.entries[0].en, 'water');
});

test('the separate অর্ঘ spelling retains its exact meanings before longer Bangla matches', () => {
  const results = searchDictionary(index, 'অর্ঘ', 'bn');
  assert.deepEqual(results.entries.slice(0, 4).map(item => item.en), [
    'offering', 'price', 'cost', 'worship',
  ]);
  assert.ok(results.entries.slice(0, 4).every(item => item.bn.includes('অর্ঘ')));
  assert.deepEqual(searchDictionary(index, transliterate('orrgho'), 'bn'), results);
  assert.deepEqual(searchDictionary(index, transliterate('orgho'), 'bn'), results);
});

test('orghyo finds the অর্ঘ্য offering, tribute and gift meanings', () => {
  const nativeResults = searchDictionary(index, 'অর্ঘ্য', 'bn');
  for (const roman of ['orghyo']) {
    const query = transliterate(roman);
    assert.equal(query, 'অর্ঘ্য');
    const result = searchDictionary(index, query, 'bn');
    assert.deepEqual(result, nativeResults);
    assert.equal(result.entries[0].en, 'offering');
    for (const english of ['offering', 'tribute', 'gift', 'sacrifice']) {
      assert.ok(result.entries.some(item => item.en === english && item.bn.includes('অর্ঘ্য')), english);
    }
    const lastExact = result.entries.findLastIndex(item => item.bn.includes('অর্ঘ্য'));
    assert.ok(result.entries.slice(0, lastExact + 1).every(item => item.bn.includes('অর্ঘ্য')),
      'exact অর্ঘ্য senses must rank before compound and substring matches');
  }
});

test('Bangla result titles use the exact matching synonym rather than the first spelling', () => {
  const offering = entry('offering', 'offering', ['অর্ঘ', 'অর্ঘ্য']);
  assert.equal(matchingBangla(offering, 'অর্ঘ্য'), 'অর্ঘ্য');
  assert.equal(matchingBangla(offering, 'অর্ঘ'), 'অর্ঘ');
  assert.equal(matchingBangla(offering), 'অর্ঘ');
});

test('the selected direction searches the source language only', () => {
  const smallIndex = buildIndex([entry('book', 'book', ['বই'])]);
  assert.equal(searchDictionary(smallIndex, 'বই', 'en').total, 0);
  assert.equal(searchDictionary(smallIndex, 'book', 'bn').total, 0);
  assert.equal(searchDictionary(smallIndex, 'book', 'en').entries[0].id, 'book');
  assert.equal(searchDictionary(smallIndex, 'বই', 'bn').entries[0].id, 'book');
});

test('search returns the full match count even when only a page of results is shown', () => {
  const smallIndex = buildIndex(Array.from({ length: 46 }, (_, position) => (
    entry(`term-${position}`, `test word ${position}`, ['শব্দ'])
  )));
  const result = searchDictionary(smallIndex, 'test', 'en');
  assert.equal(result.total, 46);
  assert.equal(result.entries.length, 40);
  assert.equal(searchDictionary(smallIndex, 'test', 'en', 3).entries.length, 3);
  assert.equal(searchDictionary(smallIndex, 'test', 'en', 3).total, 46);
  assert.equal(searchDictionary(smallIndex, 'test', 'en', 0).entries.length, 0);
});

test('empty queries and unknown words give an empty result without changing the index', () => {
  const smallIndex = buildIndex([entry('book', 'book', ['বই'])]);
  const before = structuredClone(smallIndex);
  for (const query of ['', ' \t\n ', '\u200b\ufeff', 'xyzzy-not-a-dictionary-word']) {
    assert.deepEqual(searchDictionary(smallIndex, query), { entries: [], total: 0 });
  }
  assert.deepEqual(smallIndex, before);
});

test('direction detection follows Bangla or English typing and retains the selected language for punctuation', () => {
  assert.equal(detectDirection('বই'), 'bn');
  assert.equal(detectDirection('BOOK', 'bn'), 'en');
  assert.equal(detectDirection('hello বাংলা'), 'bn');
  assert.equal(detectDirection('', 'bn'), 'bn');
  assert.equal(detectDirection('123 …', 'bn'), 'bn');
  assert.equal(detectDirection('123 …', 'en'), 'en');
});

test('daily discovery is stable within a local calendar day and advances after midnight', () => {
  const words = ['one', 'two', 'three'];
  const morning = new Date(2026, 9, 23, 0, 0, 0);
  const night = new Date(2026, 9, 23, 23, 59, 59);
  const tomorrow = new Date(2026, 9, 24, 0, 0, 0);
  const first = dailyEntry(words, morning);
  assert.equal(dailyEntry(words, night), first);
  assert.equal(dailyEntry(words, tomorrow), words[(words.indexOf(first) + 1) % words.length]);
  assert.equal(dailyEntry(words, new Date(2026, 9, 26, 12)), first);
  assert.equal(dailyEntry([], morning), undefined);
  assert.equal(dailyEntry(['only'], morning), 'only');
  assert.deepEqual(words, ['one', 'two', 'three']);
});

test('every shipped record has a stable identity and a usable translation or definition', () => {
  const ids = new Set();
  for (const item of entries) {
    assert.equal(typeof item.id, 'string');
    assert.ok(item.id.length > 0);
    assert.ok(!ids.has(item.id), `duplicate entry ID: ${item.id}`);
    ids.add(item.id);
    const nativeDefinitions = (item.definitionsBn || [item.definitionBn]).filter(value => typeof value === 'string' && value.trim());
    assert.ok(Array.isArray(item.bn), `Bangla headword list missing for ${item.id}`);
    assert.ok(normalize(item.en) || item.bn.length, `Headword missing for ${item.id}`);
    assert.ok(normalize(item.en) && item.bn.length || nativeDefinitions.length, `Meaning missing for ${item.id}`);
    if (!item.en || !item.bn.length) assert.ok(item.headword && item.language && nativeDefinitions.length, `Native definition metadata missing for ${item.id}`);
    assert.ok(item.bn.every(meaning => typeof meaning === 'string' && /[\u0980-\u09ff]/u.test(meaning)), `Invalid Bangla meaning for ${item.id}`);
  }
  for (const data of [dictionary, ...supplements]) assert.equal(data.meta.entryCount, data.entries.length);
});

test('common English words and their Bangla translations are discoverable in both directions', () => {
  for (const [en, bn] of [
    ['water', 'পানি'], ['love', 'ভালোবাসা'], ['hello', 'নমস্কার'],
    ['cat', 'বিড়াল'], ['dog', 'কুকুর'], ['food', 'খাবার'],
    ['book', 'বই'], ['home', 'বাড়ি'], ['sun', 'সূর্য'],
    ['moon', 'চাঁদ'], ['mother', 'মা'], ['father', 'বাবা'],
    ['road', 'সড়ক'], ['morning', 'সকাল'], ['rain', 'বৃষ্টি'],
  ]) {
    const englishResults = searchDictionary(index, en, 'en');
    assert.equal(normalize(englishResults.entries[0]?.en), normalize(en), `${en} should rank ahead of partial matches`);
    assert.ok(englishResults.entries.some(item => normalize(item.en) === normalize(en) && item.bn.some(meaning => normalize(meaning) === normalize(bn))), `${en} should include ${bn}`);
    const banglaResults = searchDictionary(index, bn, 'bn');
    assert.ok(banglaResults.entries.some(item => normalize(item.en) === normalize(en) && item.bn.some(meaning => normalize(meaning) === normalize(bn))), `${bn} should include ${en}`);
  }
});

test('literary verb lookup preserves its verb base and does not return a similar noun', () => {
  const smallIndex = buildIndex([
    { id: 'tax', en: 'tax', bn: ['কর'], pos: 'noun' },
    { id: 'do', en: 'do', bn: ['করা'], pos: 'verb' },
  ]);
  const result = resolveBanglaWord(smallIndex, 'করিয়াছি');
  assert.equal(result.exact, false);
  assert.deepEqual(result.entries.map(item => item.en), ['do']);
  assert.equal(result.entries[0].lookup.baseForm, 'করা');
  assert.equal(result.entries[0].lookup.query, 'করিয়াছি');
  assert.equal(result.entries[0].lookup.kind, 'inflection');
});

test('exact literary meanings take priority and uncertain stems stay unresolved', () => {
  const smallIndex = buildIndex([
    { id: 'exact', en: 'his', bn: ['তাহার'], pos: 'pronoun' },
    { id: 'modern', en: 'her', bn: ['তার'], pos: 'determiner' },
  ]);
  const result = resolveBanglaWord(smallIndex, 'তাহার');
  assert.equal(result.exact, true);
  assert.deepEqual(result.entries.map(item => item.id), ['exact']);
  assert.equal(result.entries[0].lookup, undefined);
  assert.deepEqual(resolveBanglaWord(smallIndex, 'অজানাশব্দের'), { entries: [], exact: false });
});

test('inflected noun results are labelled and rank ahead of unrelated prefix matches', () => {
  const smallIndex = buildIndex([
    { id: 'prefix', en: 'unrelated prefix', bn: ['ফুলেরকিছু'], pos: 'noun' },
    { id: 'flower', en: 'flower', bn: ['ফুল'], pos: 'noun' },
  ]);
  const result = searchDictionary(smallIndex, 'ফুলের', 'bn');
  assert.deepEqual(result.entries.map(item => item.id), ['flower', 'prefix']);
  assert.equal(result.entries[0].lookup.baseForm, 'ফুল');
  assert.equal(result.entries[1].lookup, undefined);
});


test('the complete dictionary finds the requested phonetic words and their meanings', () => {
  for (const [roman, bangla, meaning] of [
    ['jatona', 'যাতনা', 'agony'], ['jirno', 'জীর্ণ', 'worn-out'],
    ['jIrrNo', 'জীর্ণ', 'dilapidated'], ['orghyo', 'অর্ঘ্য', 'offering'],
  ]) {
    const query = transliterate(roman);
    assert.equal(normalize(query), normalize(bangla));
    assert.ok(searchDictionary(index, query, 'bn').entries.some(item => item.en === meaning && item.bn.some(word => normalize(word) === normalize(bangla))));
  }
});


test('all familiar sundor spellings find the same real সুন্দর meanings', () => {
  const expected = searchDictionary(index, 'সুন্দর', 'bn');
  assert.ok(expected.entries.some(entry => entry.en === 'beautiful'));
  for (const roman of ['sundor', 'shundor', 'sundar', 'shundar']) {
    assert.deepEqual(searchDictionary(index, transliterate(roman), 'bn'), expected, roman);
  }
});


test('definition-only headwords are searchable without inventing bilingual pairs', () => {
  const native = {id:'native',en:'',bn:['অকিঞ্চন'],language:'bn',headword:'অকিঞ্চন',definitionsBn:['দরিদ্র; যার কিছুই নেই।'],pos:'adjective'};
  const english = {id:'english',en:'gnathostome',bn:[],language:'en',headword:'gnathostome',definitionsBn:['চোয়ালযুক্ত মেরুদণ্ডী প্রাণী; মাছ ও সরীসৃপ এর উদাহরণ।'],pos:'noun'};
  const own = buildIndex([native, english]);
  assert.equal(searchDictionary(own,'অকিঞ্চন','bn').entries[0].id,'native');
  assert.equal(searchDictionary(own,'gnathostome','en').entries[0].id,'english');
  assert.equal(searchDictionary(own,'সরীসৃপ','bn').total,0,'examples inside definitions are not reverse translations');
  assert.equal(searchDictionary(own,'gnathostome','bn').total,0);
  assert.equal(resolveBanglaWord(own,'অকিঞ্চন').exact,true);
});
