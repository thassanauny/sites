import test from 'node:test';
import assert from 'node:assert/strict';
import { transliterate } from '../dist/transliteration.js';

test('common Banglish dictionary queries become Bangla', () => {
  for (const [roman, bangla] of [
    ['bangla', 'বাংলা'], ['ami', 'আমি'], ['boi', 'বই'],
    ['bhalo', 'ভালো'], ['pani', 'পানি'], ['shobdo', 'শব্দ'],
    ['bhalobasha', 'ভালোবাসা'], ['bhalobashi', 'ভালোবাসি'],
    ['jatona', 'যাতনা'], ['jirno', 'জীর্ণ'], ['jIrrNo', 'জীর্ণ'],
  ]) assert.equal(transliterate(roman), bangla, roman);
});

test('familiar whole-word families accept common vowel and s/sh spellings', () => {
  for (const [roman, bangla] of [
    ['sundor', 'সুন্দর'], ['shundor', 'সুন্দর'],
    ['sundar', 'সুন্দর'], ['shundar', 'সুন্দর'],
    ['shokal', 'সকাল'], ['sakal', 'সকাল'],
    ['shomoy', 'সময়'], ['samay', 'সময়'],
    ['sobdo', 'শব্দ'], ['shabdo', 'শব্দ'], ['shabda', 'শব্দ'],
    ['sokti', 'শক্তি'], ['shakti', 'শক্তি'], ['santi', 'শান্তি'],
    ['bandhu', 'বন্ধু'], ['jibon', 'জীবন'], ['jiban', 'জীবন'],
    ['prokriti', 'প্রকৃতি'], ['prakriti', 'প্রকৃতি'],
    ['prithibi', 'পৃথিবী'], ['prithivi', 'পৃথিবী'],
    ['shopno', 'স্বপ্ন'], ['swapno', 'স্বপ্ন'], ['sopno', 'স্বপ্ন'],
    ['shiksha', 'শিক্ষা'], ['siksha', 'শিক্ষা'], ['sikkha', 'শিক্ষা'],
    ['hridoy', 'হৃদয়'], ['hriday', 'হৃদয়'], ['ridoy', 'হৃদয়'],
    ['bhasha', 'ভাষা'], ['dukkho', 'দুঃখ'], ['dukhkho', 'দুঃখ'],
    ['sishu', 'শিশু'], ['shukh', 'সুখ'], ['sotti', 'সত্যি'],
    ['shotti', 'সত্যি'], ['ananda', 'আনন্দ'], ['nodi', 'নদী'],
    ['nadi', 'নদী'], ['biraha', 'বিরহ'], ['akaash', 'আকাশ'],
    ['shomudro', 'সমুদ্র'], ['samudra', 'সমুদ্র'],
    ['maa', 'মা'], ['amaar', 'আমার'], ['koruna', 'করুণা'],
    ['karuna', 'করুণা'], ['shadhin', 'স্বাধীন'],
    ['sadhin', 'স্বাধীন'], ['shadhinota', 'স্বাধীনতা'],
    ['sadhinota', 'স্বাধীনতা'], ['jeerno', 'জীর্ণ'], ['jirna', 'জীর্ণ'],
    ['valobasha', 'ভালোবাসা'], ['valobashi', 'ভালোবাসি'],
  ]) assert.equal(transliterate(roman), bangla, roman);
});

test('natural phrases use familiar spellings while preserving punctuation and native words', () => {
  assert.equal(transliterate('amar shundor prithibi, bandhu! jibon shopno.'),
    'আমার সুন্দর পৃথিবী, বন্ধু! জীবন স্বপ্ন.');
  assert.equal(transliterate('সুন্দর: sundor / shundor / sundar / shundar!\n🙂 shomoy ১২৩'),
    'সুন্দর: সুন্দর / সুন্দর / সুন্দর / সুন্দর!\n🙂 সময় ১২৩');
});

test('familiar spellings preserve distinct words rather than globally replacing sounds', () => {
  for (const [roman, bangla] of [
    ['shob', 'শব'], ['sob', 'সব'], ['bhasa', 'ভাসা'],
    ['chad', 'ছাদ'], ['kal', 'কাল'], ['kol', 'কল'],
    ['bhalobasa', 'ভালবাসা'], ['valobasa', 'ভালবাসা'],
    ['dukho', 'দুখ'], ['shundorer', 'শুন্দরের'],
    ['sundarer', 'সুন্দারের'], ['shundorjo', 'শুন্দরজ'],
  ]) assert.equal(transliterate(roman), bangla, roman);
});

test('case-sensitive Avro and explicit controls bypass familiar spelling families', () => {
  for (const [roman, bangla] of [
    ['Shundor', 'ষুন্দর'], ['Sundar', 'শুন্দার'], ['shundOr', 'শুন্দোর'],
    ['shundor`', 'শুন্দর'], ['sundar`', 'সুন্দার'],
    ['sundar^', 'সুন্দারঁ'], ['shomoy`', 'শময়'], ['shomoy^', 'শময়ঁ'],
  ]) assert.equal(transliterate(roman), bangla, roman);
});

test('editing a familiar word always recomputes the complete Roman composition', () => {
  assert.equal(transliterate('shundor'), 'সুন্দর');
  assert.equal(transliterate('shundar'), 'সুন্দর');
  assert.equal(transliterate('shund'), 'শুন্দ');
  assert.equal(transliterate('shundor`'), 'শুন্দর');
  assert.equal(transliterate('shundorer'), 'শুন্দরের');
  assert.equal(transliterate('shundor'), 'সুন্দর');
});

test('complete phrases retain whitespace and punctuation', () => {
  assert.equal(transliterate('ami bangla bhalobashi'), 'আমি বাংলা ভালোবাসি');
  assert.equal(transliterate('ami banglay gan gai'), 'আমি বাংলায় গান গাই');
  assert.equal(transliterate('ami, tumi!\nboi? 123.45: $5 — pani'),
    'আমি, তুমি!\nবই? 123.45: $5 — পানি');
});

test('familiar orgho and orghyo retain their distinct complete-word spellings', () => {
  assert.equal(transliterate('orgho'), 'অর্ঘ');
  assert.equal(transliterate('orghyo'), 'অর্ঘ্য');
  assert.equal(transliterate('ami orgho, orghyo!'), 'আমি অর্ঘ, অর্ঘ্য!');
  assert.equal(transliterate('অর্ঘ্য — orgho\nঅর্ঘ'), 'অর্ঘ্য — অর্ঘ\nঅর্ঘ');
});

test('the orgho convenience retains Avro case distinctions and explicit controls', () => {
  for (const [roman, bangla] of [
    ['orrgho', 'অর্ঘ'], ['Orgho', 'ওরঘ'], ['argho', 'আরঘ'],
    ['orgho`', 'অরঘ'], ['or`gho', 'অরঘ'], ['orgho^', 'অরঘঁ'],
  ]) assert.equal(transliterate(roman), bangla, roman);
});

test('existing Bangla and other scripts survive mixed composition exactly', () => {
  assert.equal(transliterate('বাংলা boi — পানি bhalo!'), 'বাংলা বই — পানি ভালো!');
  assert.equal(transliterate('আমি বই পড়ি। ১২৩'), 'আমি বই পড়ি। ১২৩');
  assert.equal(transliterate('é 漢字 🙂'), 'é 漢字 🙂');
});

test('Avro case distinctions and contextual vowel rules are retained', () => {
  for (const [roman, bangla] of [
    ['a', 'আ'], ['ka', 'কা'], ['i', 'ই'], ['ki', 'কি'],
    ['t', 'ত'], ['T', 'ট'], ['n', 'ন'], ['N', 'ণ'],
    ['sh', 'শ'], ['Sh', 'ষ'], ['bhalO', 'ভালো'],
    ['bhalObasa', 'ভালোবাসা'], ['bhalObasi', 'ভালোবাসি'],
  ]) assert.equal(transliterate(roman), bangla, roman);
});

test('real words use consonant conjuncts rather than letter substitution', () => {
  for (const [roman, bangla] of [
    ['shikSha', 'শিক্ষা'], ['bidya', 'বিদ্যা'], ['shokti', 'শক্তি'],
    ['bondhu', 'বন্ধু'], ['shobdo', 'শব্দ'], ['sundor', 'সুন্দর'],
    ['kSh', 'ক্ষ'], ['jNG', 'জ্ঞ'], ['krriShok', 'কৃষক'],
  ]) assert.equal(transliterate(roman), bangla, roman);
});

test('full recomputation remains correct through insert, replace and delete edits', () => {
  const source = 'bangla';
  assert.deepEqual(Array.from({ length: source.length + 1 }, (_, index) =>
    transliterate(source.slice(0, index))), ['', 'ব', 'বা', 'বান', 'বাং', 'বাংল', 'বাংলা']);
  assert.equal(transliterate('shikSha'), 'শিক্ষা');
  assert.equal(transliterate('shikSh'), 'শিক্ষ');
  assert.equal(transliterate('shikha'), 'শিখা');
  assert.equal(transliterate('ami bhalo'), 'আমি ভালো');
  assert.equal(transliterate('ami boi'), 'আমি বই');
  assert.equal(transliterate('ami'), 'আমি');
});

test('empty, native and repeated input remain stable', () => {
  assert.equal(transliterate(''), '');
  assert.equal(transliterate(null), '');
  const bangla = transliterate('ami bangla bhalobashi');
  assert.equal(transliterate(bangla), bangla);
  assert.equal(transliterate('ami bangla bhalobashi'), bangla);
});

test('shoil and shoilo share the existing Avro spelling for শৈল', () => {
  for (const word of ['shoil', 'shoilo', 'shOIl']) assert.equal(transliterate(word), 'শৈল');
  assert.equal(transliterate('shoil, shoilo! শৈল'), 'শৈল, শৈল! শৈল');
});
