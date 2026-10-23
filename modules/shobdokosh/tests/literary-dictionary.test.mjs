import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIndex, normalize, searchDictionary } from '../dist/search.js';

const literary = JSON.parse(await readFile(new URL('../dist/data/literary-dictionary.json', import.meta.url), 'utf8'));
const index = buildIndex(literary.entries);

const exact = word => searchDictionary(index, word, 'bn').entries
  .filter(entry => entry.bn.some(spelling => normalize(spelling) === normalize(word)));

test('literary headwords omitted from the original dictionary have actual English meanings', () => {
  for (const [word, meaning] of [
    ['নৈবেদ্য', /offering/], ['নির্ঝর', /waterfall|stream/], ['সুধা', /nectar/],
    ['অভিসার', /lover/], ['পুলক', /delight|thrill/], ['অনিমেষ', /unblinking/],
    ['মরম', /heart/], ['পল্লব', /shoot|sprout/], ['মঞ্জরী', /blossoms/],
    ['ব্যাকুল', /longing/], ['মাধুরী', /sweetness|charm/], ['শ্যামল', /green|verdant/],
    ['করুণ', /sorrowful|compassionate/], ['অবগুণ্ঠন', /veil/],
  ]) {
    assert.ok(exact(word).some(entry => meaning.test(entry.en)), `${word} must have a readable meaning`);
  }
});

test('English searches find the corresponding literary Bengali word', () => {
  for (const [query, word] of [
    ['devotional offering', 'নৈবেদ্য'], ['waterfall', 'নির্ঝর'], ['nectar', 'সুধা'],
    ['unblinking', 'অনিমেষ'], ['blossoms', 'মঞ্জরী'], ['veil', 'অবগুণ্ঠন'],
    ['southern breeze', 'মলয়'], ['bamboo flute', 'বংশী'],
  ]) {
    const results = searchDictionary(index, query, 'en');
    assert.ok(results.entries.some(entry => entry.bn.includes(word.normalize('NFC'))), `${query} should find ${word}`);
  }
});

test('rustling and marble remain separate meanings of মর্মর', () => {
  const meanings = exact('মর্মর');
  assert.ok(meanings.some(entry => /rustling/.test(entry.en)));
  assert.ok(meanings.some(entry => entry.en === 'marble'));
  assert.equal(new Set(meanings.map(entry => entry.id)).size, meanings.length);
});

test('source-attested alternative spellings find their own exact meanings', () => {
  for (const [first, second] of [
    ['অনিমেষ', 'অনিমিষ'], ['মঞ্জরী', 'মঞ্জরি'], ['তরণী', 'তরণি'],
    ['অবগুণ্ঠন', 'অবগুন্ঠন'], ['মুরলী', 'মুরলি'], ['ধূলি', 'ধূলী'],
  ]) {
    assert.ok(exact(first).length > 0);
    assert.deepEqual(exact(first).map(entry => entry.id), exact(second).map(entry => entry.id));
  }
});

test('frequent reading words preserve negation and grammatical context', () => {
  assert.ok(exact('একটা').some(entry => entry.pos === 'determiner' && /one/.test(entry.en)));
  assert.ok(exact('একটি').some(entry => entry.pos === 'determiner' && /one/.test(entry.en)));
  assert.ok(exact('কোন্').some(entry => /which/.test(entry.en)));
  assert.ok(exact('তেমনি').some(entry => /same way/.test(entry.en)));
  assert.ok(exact('নি').some(entry => entry.en === 'not' && /verb/.test(entry.definition)));
  assert.ok(exact('নহে').some(entry => entry.en === 'is not' && entry.pos === 'verb'));
  assert.ok(exact('নাহি').some(entry => /not/.test(entry.en)));
  assert.ok(exact('কিছুই').some(entry => /negation/.test(entry.definition) && /nothing at all/.test(entry.definition)));
  assert.ok(exact('গো').some(entry => entry.pos === 'interjection'));
});

test('broader literary vocabulary has useful meanings in both search directions', () => {
  for (const [word, meaning, query] of [
    ['অলক', /curl|ringlet/, 'ringlet'],
    ['অরুণিমা', /rosy/, 'rosy colour'],
    ['অন্তরীক্ষ', /sky/, 'space above the earth'],
    ['অমল', /pure|spotless/, 'spotless'],
    ['উন্মেষ', /unfolding|emergence/, 'emergence'],
    ['কুহেলি', /mist|fog/, 'mist'],
    ['খঞ্জন', /wagtail/, 'wagtail'],
    ['নিদাঘ', /summer heat/, 'summer heat'],
    ['নিকুঞ্জ', /bower/, 'leafy retreat'],
    ['পান্থ', /wayfarer/, 'wayfarer'],
    ['বিহঙ্গ', /^bird$/, 'bird'],
    ['যবনিকা', /curtain/, 'stage curtain'],
    ['ঊর্মি', /wave/, 'surge'],
  ]) {
    assert.ok(exact(word).some(entry => meaning.test(entry.en)), `${word} must have a checked meaning`);
    assert.ok(searchDictionary(index, query, 'en').entries.some(entry => entry.bn.includes(word.normalize('NFC'))), `${query} should find ${word}`);
  }
});

test('additional distinct senses and gendered forms preserve their context', () => {
  for (const [word, first, second] of [
    ['প্রবাল', /^coral$/, /young shoot/],
    ['উদাস', /detached/, /melancholy/],
    ['মলিন', /soiled/, /sorrowful/],
    ['অনাহত', /unhurt/, /unstruck/],
    ['চৈতালী', /spring breeze/, /of Chaitra/],
  ]) {
    const entries = exact(word);
    const a = entries.find(entry => first.test(entry.en));
    const b = entries.find(entry => second.test(entry.en));
    assert.ok(a && b, `${word} needs both checked senses`);
    assert.notEqual(a.id, b.id, `${word} senses must retain separate identities`);
  }
  for (const word of ['বিরহিণী', 'মহীয়সী']) {
    assert.ok(exact(word).some(entry => /feminine/.test(entry.en) && /feminine/.test(entry.definition)));
  }
  assert.ok(exact('কঙ্কণ').some(entry => /bangle/.test(entry.en) && entry.referenceUrls?.length));
  assert.ok(exact('অনন্তর').some(entry => /afterwards/.test(entry.en)));
  assert.ok(exact('শেফালি').every(entry => !/Vitex|negundo/.test(`${entry.en} ${entry.definition}`)));
});

test('new alternatives are source-attested rather than guessed spellings', () => {
  for (const [first, second] of [
    ['অন্তরীক্ষ', 'অন্তরিক্ষ'], ['কুহেলি', 'কুহেলিকা'], ['কুহেলি', 'কুহেলী'],
    ['বিহঙ্গ', 'বিহঙ্গম'], ['রজনী', 'রজনি'], ['মৃন্ময়', 'মৃন্ময়ী'],
  ]) {
    assert.ok(exact(first).length > 0);
    assert.deepEqual(exact(first).map(entry => entry.id), exact(second).map(entry => entry.id));
  }
});

test('every curated meaning has stable identity, original explanation and primary-source attribution', () => {
  const allowedSources = new Set(['accessibledictionary.gov.bd', 'en.wiktionary.org']);
  const ids = new Set();
  for (const entry of literary.entries) {
    assert.match(entry.id, /^literary-[0-9a-f]{16}$/);
    assert.ok(!ids.has(entry.id), `duplicate ID ${entry.id}`);
    ids.add(entry.id);
    assert.equal(entry.sourceKind, 'curated');
    assert.ok(entry.en.length > 0 && entry.definition.length > 15);
    assert.ok(entry.bn.length > 0 && entry.bn.every(word => /[\u0980-\u09ff]/u.test(word)));
    assert.ok(entry.bn.every(word => word === word.normalize('NFC')));
    assert.equal(new Set(entry.bn).size, entry.bn.length);
    const source = new URL(entry.sourceUrl);
    assert.equal(source.protocol, 'https:');
    assert.ok(allowedSources.has(source.hostname), `unexpected reference: ${source.hostname}`);
    assert.ok(entry.sourceName.length > 0);
  }
  assert.equal(literary.meta.entryCount, literary.entries.length);
  assert.equal(literary.meta.statistics.bengaliHeadwords, new Set(literary.entries.flatMap(entry => entry.bn)).size);
});
