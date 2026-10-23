import assert from 'node:assert/strict';
import test from 'node:test';
import { getBanglaBaseForms } from '../dist/bengali-morphology.js';

const words = value => getBanglaBaseForms(value).map(item => item.word);
const normalized = value => value.normalize('NFC');

test('sadhu verb forms point to known infinitives without inventing a tense gloss', () => {
  for (const [source, base] of [
    ['করিয়াছি', 'করা'], ['করিল', 'করা'], ['করিতেছেন', 'করা'],
    ['করিবার', 'করা'], ['হইবে', 'হওয়া'], ['হইয়াছিল', 'হওয়া'],
    ['আসিয়াছি', 'আসা'], ['গিয়াছিলেন', 'যাওয়া'], ['যাইবে', 'যাওয়া'],
    ['খাইয়াছে', 'খাওয়া'], ['পাইয়াছি', 'পাওয়া'], ['লইয়া', 'নেওয়া'],
    ['দিয়াছেন', 'দেওয়া'], ['শুনিল', 'শোনা'], ['লিখিয়াছে', 'লেখা'],
    ['চাহিয়া', 'চাওয়া'], ['কহিল', 'বলা'], ['কহিলেন', 'বলা'], ['রহিয়াছে', 'থাকা'],
  ]) {
    const candidate = getBanglaBaseForms(source)[0];
    assert.equal(candidate?.word, normalized(base), source);
    assert.equal(candidate.kind, 'inflection');
    assert.equal(candidate.pos, 'verb');
    assert.match(candidate.label, /base form/u);
    assert.equal(getBanglaBaseForms(source).length, 1, `${source} should not get spurious noun stems`);
  }
});

test('explicit modern conjugations point to verb lemmas with no fabricated tense/person gloss', () => {
  for (const [source, base] of [
    ['যায়', 'যাওয়া'], ['গেল', 'যাওয়া'], ['গেছে', 'যাওয়া'], ['গিয়েছে', 'যাওয়া'],
    ['হবে', 'হওয়া'], ['হয়েছে', 'হওয়া'], ['হচ্ছে', 'হওয়া'], ['হোক', 'হওয়া'],
    ['করি', 'করা'], ['করেন', 'করা'], ['করো', 'করা'], ['করে', 'করা'], ['করবার', 'করা'],
    ['জানি', 'জানা'], ['দেখি', 'দেখা'], ['দেখে', 'দেখা'], ['দেখতে', 'দেখা'],
    ['পড়ে', 'পড়া'], ['চলে', 'চলা'], ['বললে', 'বলা'], ['উঠে', 'ওঠা'], ['চাই', 'চাওয়া'],
    ['বুঝি', 'বোঝা'], ['বুঝে', 'বোঝা'], ['বোঝে', 'বোঝা'], ['বুঝতে', 'বোঝা'],
    ['ফিরে', 'ফেরা'], ['ফিরি', 'ফেরা'], ['ফিরেছে', 'ফেরা'], ['ফিরতে', 'ফেরা'],
    ['এল', 'আসা'], ['এলো', 'আসা'], ['এসো', 'আসা'], ['এসেছে', 'আসা'],
    ['এসেছি', 'আসা'], ['এসেছেন', 'আসা'], ['আসি', 'আসা'], ['আসে', 'আসা'],
    ['আসেন', 'আসা'], ['আসতে', 'আসা'], ['আসবে', 'আসা'],
    ['থাকি', 'থাকা'], ['থাকে', 'থাকা'], ['থাকেন', 'থাকা'], ['থাকতে', 'থাকা'], ['থাকবে', 'থাকা'],
    ['গিয়ে', 'যাওয়া'], ['হয়ে', 'হওয়া'],
  ]) {
    const candidates = getBanglaBaseForms(source);
    assert.equal(candidates.length, 1, source);
    assert.equal(candidates[0].word, normalized(base), source);
    assert.equal(candidates[0].pos, 'verb');
    assert.match(candidates[0].label, /verb · dictionary base form/u);
  }
});

test('literary pronouns retain possessive/object distinctions', () => {
  for (const [source, equivalent] of [
    ['মোর', 'আমার'], ['তব', 'তোমার'], ['মোরে', 'আমাকে'], ['মোদের', 'আমাদের'],
    ['তাহার', 'তার'], ['তাহাকে', 'তাকে'], ['তাঁহার', 'তাঁর'],
    ['ইহাদের', 'এদের'], ['যাহারা', 'যারা'], ['কাহার', 'কার'], ['কেহ', 'কেউ'],
  ]) {
    const candidate = getBanglaBaseForms(source)[0];
    assert.equal(candidate?.word, normalized(equivalent), source);
    assert.match(candidate.label, /pronoun/u);
    assert.equal(candidate.pos, 'pronoun');
  }
  assert.ok(!words('মোর').includes('আমি'));
  assert.ok(!words('তাহার').includes('সে'));
});

test('noun case and plural endings yield one conservative base candidate', () => {
  for (const [source, base] of [
    ['ফুলের', 'ফুল'], ['নদীতে', 'নদী'], ['মানুষকে', 'মানুষ'], ['হৃদয়ে', 'হৃদয়'],
    ['আকাশে', 'আকাশ'], ['বইয়ের', 'বই'], ['বইয়ে', 'বই'], ['কথায়', 'কথা'],
    ['মায়ের', 'মা'], ['নদীর', 'নদী'], ['শীতে', 'শীত'], ['হাতে', 'হাত'],
    ['ফুলগুলোর', 'ফুল'], ['মানুষদেরকে', 'মানুষ'], ['কবিদিগের', 'কবি'],
    ['কবিতাখানির', 'কবিতা'], ['কবিতাটিকে', 'কবিতা'], ['শিশুরে', 'শিশু'],
  ]) {
    assert.deepEqual(words(source), [normalized(base)], source);
    assert.match(getBanglaBaseForms(source)[0].label, /Possible/u);
    assert.equal(getBanglaBaseForms(source)[0].pos, 'noun');
  }
});

test('historical doubled consonants after reph get a separately labelled spelling', () => {
  for (const [source, equivalent] of [
    ['সর্ব্ব', 'সর্ব'], ['ধর্ম্ম', 'ধর্ম'], ['কর্ম্ম', 'কর্ম'],
    ['মূর্ত্তি', 'মূর্তি'], ['কার্য্য', 'কার্য'], ['সূর্য্য', 'সূর্য'],
  ]) {
    const match = getBanglaBaseForms(source).find(item => item.word === normalized(equivalent));
    assert.ok(match, source);
    assert.equal(match.kind, 'historical-spelling');
  }
  const historicalCase = getBanglaBaseForms('কর্ম্মের');
  assert.ok(historicalCase.some(item => item.word === 'কর্মের' && item.kind === 'historical-spelling'));
  assert.ok(historicalCase.some(item => item.word === 'কর্ম' && item.kind === 'inflection'));
});

test('normalization handles canonical equivalents and invisible copied formatting', () => {
  for (const source of ['বাড়ির', 'করিয়াছি', 'হৃদয়ে']) {
    const result = getBanglaBaseForms(source);
    assert.deepEqual(getBanglaBaseForms(source.normalize('NFD')), result);
    assert.deepEqual(getBanglaBaseForms(` \ufeff${source.slice(0, 1)}\u200d${source.slice(1)} `), result);
  }
});

test('ordinary short words, lexical endings and non-reph doubles remain intact', () => {
  for (const word of [
    'বই', 'মা', 'কে', 'যে', 'তার', 'ঘর', 'পাথর', 'সাগর', 'অমর',
    'হৃদয়', 'আলয়', 'অথই', 'উজ্জ্বল', 'সত্ত্ব', 'পল্লব', 'কলম', 'বিদেশ',
  ]) assert.deepEqual(getBanglaBaseForms(word), [], word);
});

test('unknown verb stems do not get fabricated infinitives', () => {
  for (const word of ['বনিয়াছি', 'তালিল', 'কম্পিউটারিয়াছি', 'অচেনািবে']) {
    assert.ok(!getBanglaBaseForms(word).some(item => /Literary verb/u.test(item.label)), word);
  }
});

test('emphatic suffixes are considered only after a recognized inflection', () => {
  assert.ok(words('ফুলেরও').includes('ফুল'));
  assert.ok(words('মোরই').includes('আমার'));
  assert.deepEqual(words('বই'), []);
  assert.deepEqual(words('চাই'), [normalized('চাওয়া')]);
  assert.ok(!words('চাই').includes('চা'));
});

test('candidates require dictionary validation and never assert an unknown meaning', () => {
  const result = getBanglaBaseForms('অচেনাশব্দের');
  assert.equal(result[0]?.word, 'অচেনাশব্দ');
  assert.match(result[0].label, /Possible/u);
  assert.equal(Object.hasOwn(result[0], 'meaning'), false);
  assert.equal(Object.hasOwn(result[0], 'definition'), false);
});

test('only single Bangla words are considered and results are deterministic and bounded', () => {
  for (const query of [null, '', ' ', 'flower', 'ফুলের মালা', 'ফুলের!', '১২৩', 'aফুলের', 'ফুলের-ফুল']) {
    assert.deepEqual(getBanglaBaseForms(query), [], String(query));
  }
  assert.deepEqual(getBanglaBaseForms('ক'.repeat(81) + 'ের'), []);
  for (const word of ['করিয়াছি', 'কর্ম্মেরও', 'ফুলগুলোর', 'তাহার', 'হৃদয়ে']) {
    const result = getBanglaBaseForms(word);
    assert.deepEqual(getBanglaBaseForms(word), result);
    assert.ok(result.length <= 12);
    assert.equal(new Set(result.map(item => item.word)).size, result.length);
    assert.ok(!result.some(item => item.word === normalized(word)));
    assert.ok(result.every(item => ['inflection', 'historical-spelling'].includes(item.kind)));
  }
});
