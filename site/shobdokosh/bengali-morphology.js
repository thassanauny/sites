/*
 * Lookup candidates, not definitions or a claim to understand a sentence.
 * The caller must keep exact matches first, require an exact dictionary match
 * for every candidate, and identify the result as a related/base-form lookup.
 *
 * Reference points for the deliberately limited rules:
 * - Assam State Textbook, Bangla Byakaran IX–X, chapters 1 and 4 (sadhu
 *   pronouns/verbs and case endings):
 *   https://www.sebaonline.org/textbooks/class-9/Bengali%20MIL_Bangla%20Byakaran_Class%20IX-X.pdf
 * - Bangla Academy spelling rules, section 1.3 (no doubled consonant after
 *   reph), reproduced in the government's practical-Bangla handbook:
 *   https://file-dhaka.portal.gov.bd/media/847736db-e9a4-4c47-87da-e3cac601e7f5/uploaded-files/sarkarikajebaboharik-bangla090215.pdf
 * - Tagore's own literary usage of মোর/মোরে/তব and করিয়াছ forms:
 *   https://bichitra.jdvu.ac.in/manuscript/manuscript_viewer.php?manid=153&mname=RBVBMS_129
 */

const MAX_CANDIDATES = 12;
const BENGALI_WORD = /^(?=[\p{L}\p{M}]+$)[\u0980-\u09ff]+$/u;
const LETTERS = /\p{L}/gu;
const VOWEL_END = /[অআইঈউঊঋএঐওঔািীুূৃেৈোৌ]$/u;
const SHORT_NOUNS = new Set(['মা', 'পা', 'গা', 'চা', 'ঘি', 'ঘা']);

const normalizeWord = value => String(value ?? '').normalize('NFC')
  .replace(/[\u200b-\u200d\ufeff]/g, '').trim();

const literaryForms = new Map(Object.entries({
  মোর: 'আমার', মোরে: 'আমাকে', মোরা: 'আমরা', মোদের: 'আমাদের',
  তব: 'তোমার', তোমারে: 'তোমাকে', আমারে: 'আমাকে',
  তাহা: 'তা', তাহার: 'তার', তাহাকে: 'তাকে', তাহারা: 'তারা',
  তাহাদের: 'তাদের', তাহাদিগকে: 'তাদের', তাহাদিগের: 'তাদের', তাহাতে: 'তাতে',
  তাঁহার: 'তাঁর', তাঁহাকে: 'তাঁকে', তাঁহারা: 'তাঁরা', তাঁহাদের: 'তাঁদের',
  ইহা: 'এটা', ইহার: 'এর', ইহাকে: 'একে', ইহারা: 'এরা',
  ইহাদের: 'এদের', ইহাদিগের: 'এদের', ইহাদিগকে: 'এদের', ইহাতে: 'এতে',
  উহা: 'ওটা', উহার: 'ওর', উহাকে: 'ওকে', উহারা: 'ওরা', উহাদের: 'ওদের',
  যাহা: 'যা', যাহার: 'যার', যাহাকে: 'যাকে', যাহারা: 'যারা',
  যাহাদের: 'যাদের', যাহাতে: 'যাতে', কাহার: 'কার', কাহাকে: 'কাকে', কাহারা: 'কারা',
  কেহ: 'কেউ', কেহই: 'কেউ', কাহারও: 'কারও',
}).map(([word, base]) => [normalizeWord(word), normalizeWord(base)]));

// A closed list of verb stems prevents arbitrary nouns ending in -িল/-িবে
// from being treated as verbs. Infinitives retain their dictionary meaning;
// this module intentionally does not manufacture English tense/person glosses.
const consonantStems = {
  কর: 'করা', বল: 'বলা', চল: 'চলা', দেখ: 'দেখা', লিখ: 'লেখা', শুন: 'শোনা',
  পড়: 'পড়া', থাক: 'থাকা', আস: 'আসা', ধর: 'ধরা', রাখ: 'রাখা', উঠ: 'ওঠা',
  বস: 'বসা', হাস: 'হাসা', কাঁদ: 'কাঁদা', জান: 'জানা', মান: 'মানা',
  ভাব: 'ভাবা', বুঝ: 'বোঝা', ফির: 'ফেরা', মিল: 'মেলা', মর: 'মরা',
  হার: 'হারা', ডাক: 'ডাকা', ভাস: 'ভাসা', নাচ: 'নাচা', গড়: 'গড়া',
  সাজ: 'সাজা', ঘট: 'ঘটা', খুল: 'খোলা', ফুট: 'ফোটা', ভাঙ: 'ভাঙা',
  লাগ: 'লাগা', জাগ: 'জাগা', চাহ: 'চাওয়া', কহ: 'বলা', রহ: 'থাকা',
  দ: 'দেওয়া', ন: 'নেওয়া', গ: 'যাওয়া',
};
const independentVowelStems = {
  হ: 'হওয়া', খা: 'খাওয়া', পা: 'পাওয়া', যা: 'যাওয়া', ল: 'নেওয়া',
};
const literaryEndings = [
  'য়াছিলাম', 'য়াছিলেন', 'য়াছিলে', 'য়াছিল',
  'য়াছেন', 'য়াছিস', 'য়াছি', 'য়াছে', 'য়াছ',
  'তেছিলাম', 'তেছিলেন', 'তেছিলে', 'তেছিল',
  'তেছেন', 'তেছি', 'তেছে', 'তেছ',
  'লাম', 'লেন', 'লুম', 'লে', 'লি', 'ল',
  'তাম', 'তেন', 'তে', 'ত', 'বার', 'বেন', 'বে', 'বি', 'ব', 'য়া',
];
const literaryVerbs = new Map();
for (const [stems, vowel] of [[consonantStems, 'ি'], [independentVowelStems, 'ই']]) {
  for (const [stem, base] of Object.entries(stems)) {
    for (const ending of literaryEndings) {
      literaryVerbs.set(normalizeWord(stem + vowel + ending), normalizeWord(base));
    }
  }
}

// Common modern conjugations also occur in Tagore. These are explicit word
// lists, not suffix guesses: vowel changes differ between verb paradigms.
const modernVerbs = new Map();
const modernParadigms = {
  করা: 'করি করো করে করেন করছি করছে করছেন করেছি করেছে করেছেন করব করবে করবেন করতে করবার করল করলে করলেন করলাম করত',
  বলা: 'বলি বলো বলে বলেন বলেছে বলেছি বলছে বলছেন বলবে বলব বলতে বললে বলল বললেন',
  যাওয়া: 'যায় যাই যাও যান যাচ্ছে যাচ্ছি যাচ্ছেন গেছে গেছি গেছেন গিয়েছে গিয়েছি গিয়েছেন গিয়ে গেল গেলাম গেলে গেলেন যাব যাবে যাবেন যেতে যাবার যেত',
  হওয়া: 'হয় হই হও হন হচ্ছে হচ্ছি হচ্ছেন হয়েছে হয়েছি হয়েছেন হয়েছিল হয়ে হলো হল হলাম হলে হলেন হবে হব হবেন হতে হবার হোক হত হতো',
  দেখা: 'দেখি দেখো দেখে দেখেন দেখছে দেখছি দেখেছি দেখেছে দেখলে দেখতে দেখব দেখবে',
  জানা: 'জানি জানো জানে জানেন জেনেছি জেনেছে জানলে জানতে জানবে',
  পড়া: 'পড়ি পড়ো পড়ে পড়েন পড়ছে পড়েছি পড়েছে পড়লে পড়তে পড়বে',
  চলা: 'চলি চলো চলে চলেন চলছে চলেছে চলতে চলবে',
  ওঠা: 'উঠি ওঠো ওঠে ওঠেন উঠছে উঠেছে উঠে উঠতে উঠবে',
  চাওয়া: 'চাই চাও চায় চান চেয়েছি চেয়েছে চাইলে চাইতে চাইবে',
  বোঝা: 'বুঝি বুঝে বোঝে বুঝতে',
  ফেরা: 'ফিরে ফিরি ফিরেছে ফিরতে',
  আসা: 'এল এলো এসো এসেছে এসেছি এসেছেন আসি আসে আসেন আসতে আসবে',
  থাকা: 'থাকি থাকে থাকেন থাকতে থাকবে',
};
for (const [base, forms] of Object.entries(modernParadigms)) {
  for (const form of forms.split(' ')) modernVerbs.set(normalizeWord(form), normalizeWord(base));
}

// Each complete ending is removed once. There is no recursive stripping:
// e.g. ফুলগুলোর → ফুল, rather than producing a chain of shorter fragments.
const nounEndings = [
  'সমূহের', 'সমূহকে', 'সমূহে', 'সমূহ',
  'গুলিকে', 'গুলোকে', 'গুলিতে', 'গুলোতে', 'গুলির', 'গুলোর', 'গুলি', 'গুলো',
  'দিগের', 'দিগকে', 'দিগেতে', 'দিগে', 'দেরকে', 'দের',
  'গণের', 'গণকে', 'গণে', 'গণ',
  'খানিকে', 'খানিতে', 'খানির', 'খানি', 'খানাকে', 'খানাতে', 'খানার', 'খানা',
  'টিকে', 'টিতে', 'টির', 'টি', 'টাকে', 'টাতে', 'টার', 'টা',
  'য়ের', 'য়ে', 'য়', 'ের', 'কে', 'তে', 'রে', 'র', 'ে',
].map(normalizeWord).sort((a, b) => b.length - a.length);
const vowelOnlyEndings = new Set(['য়ের', 'য়ে', 'য়', 'র', 'তে'].map(normalizeWord));

function plausibleNoun(word) {
  return BENGALI_WORD.test(word) && !word.endsWith('্')
    && ((word.match(LETTERS)?.length ?? 0) >= 2 || SHORT_NOUNS.has(word));
}

function nounBase(word) {
  for (const ending of nounEndings) {
    if (!word.endsWith(ending)) continue;
    const base = word.slice(0, -ending.length);
    if (!plausibleNoun(base)) continue;
    // A bare -র or -য় after a consonant is commonly part of the word:
    // পাথর/সাগর/হৃদয় must not become পাথ/সাগ/হৃদ.
    if (vowelOnlyEndings.has(ending) && !VOWEL_END.test(base)) continue;
    return base;
  }
  return undefined;
}

function modernSpelling(word) {
  // Restrict simplification to a repeated consonant immediately after reph.
  // Doubles elsewhere, such as উজ্জ্বল/সত্ত্ব/পল্লব, remain intact.
  return word.replace(/(র্)([ক-হ])্\2/gu, '$1$2');
}

/**
 * Return bounded, deterministic lookup candidates for one Bangla word.
 * These are hypotheses until validated against an exact dictionary headword.
 * A returned infinitive does not preserve the source verb's tense/person;
 * a possessive pronoun maps to its possessive equivalent, not its subject.
 * @returns {{word: string, kind: 'inflection'|'historical-spelling', label: string, pos?: 'verb'|'pronoun'|'noun'}[]}
 */
export function getBanglaBaseForms(value) {
  const word = normalizeWord(value);
  if (!BENGALI_WORD.test(word) || [...word].length > 80) return [];
  const candidates = [];
  const seen = new Set([word]);
  const add = (base, kind, label, pos) => {
    if (!base || seen.has(base) || candidates.length >= MAX_CANDIDATES) return;
    seen.add(base);
    candidates.push({ word: base, kind, label, ...(pos ? { pos } : {}) });
  };
  const addForms = (source, historical = false) => {
    const literary = literaryForms.get(source);
    const literaryVerb = literaryVerbs.get(source);
    const verb = literaryVerb ?? modernVerbs.get(source);
    add(literary, 'inflection', 'Literary pronoun · modern equivalent', 'pronoun');
    add(verb, 'inflection', literaryVerb
      ? 'Literary verb · dictionary base form'
      : 'Inflected verb · dictionary base form', 'verb');
    // Known verbs/pronouns take precedence over ambiguous noun stripping.
    if (!literary && !verb) {
      add(nounBase(source), 'inflection', historical
        ? 'Possible base form · historical spelling'
        : 'Possible inflected form · dictionary base form', 'noun');
    }
  };

  addForms(word);
  const modern = modernSpelling(word);
  if (modern !== word) {
    add(modern, 'historical-spelling', 'Historical spelling · modern equivalent');
    addForms(modern, true);
  }

  // A trailing emphatic ই/ও is handled only after an independently recognized
  // inflection, so ordinary headwords such as বই/চাই/অথই are not shortened.
  if (/[ইও]$/u.test(word)) {
    const withoutEmphasis = word.slice(0, -1);
    if (literaryForms.has(withoutEmphasis) || literaryVerbs.has(withoutEmphasis) || modernVerbs.has(withoutEmphasis)
      || nounBase(withoutEmphasis)) {
      add(withoutEmphasis, 'inflection', 'Possible emphatic form · related word');
      addForms(withoutEmphasis);
    }
  }
  return candidates;
}
