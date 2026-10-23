import test from 'node:test';
import assert from 'node:assert/strict';
import { banglaDefinitions, entryView, meaningPreview } from '../dist/entry-view.js';

const native = { id: 'native', en: '', bn: ['অকিঞ্চন'], headword: 'অকিঞ্চন', language: 'bn', definitionsBn: ['যার কিছুই নেই; দরিদ্র।', 'যার কিছুই নেই; দরিদ্র।'], pos: 'adjective' };
const english = { id: 'english', en: 'gnathostome', bn: [], headword: 'gnathostome', language: 'en', definitionsBn: ['চোয়ালযুক্ত মেরুদণ্ডী প্রাণী; এর উদাহরণ মাছ ও সরীসৃপ।'], pos: 'noun' };
const bilingual = { id: 'bilingual', en: 'beautiful', bn: ['সুন্দর'], sourceKind: 'direct' };

test('a Bangla definition is labelled in Bangla and never shown as an English translation', () => {
  const view = entryView(native, 'bn');
  assert.equal(view.title, 'অকিঞ্চন');
  assert.equal(view.titleLanguage, 'bn');
  assert.equal(view.label, 'বাংলা সংজ্ঞা');
  assert.equal(view.meaningLanguage, 'bn');
  assert.equal(view.englishUnavailable, true);
  assert.deepEqual(view.meaningValues, ['যার কিছুই নেই; দরিদ্র।']);
  assert.equal(entryView(native, 'en').titleLanguage, 'bn', 'saved native entries remain readable in English mode');
});

test('English entries retain complete Bengali definitions without inventing reverse headwords', () => {
  const view = entryView(english, 'en');
  assert.equal(view.title, 'gnathostome');
  assert.equal(view.titleLanguage, 'en');
  assert.equal(view.label, 'বাংলা সংজ্ঞা');
  assert.deepEqual(view.meaningValues, english.definitionsBn);
  assert.equal(view.englishUnavailable, false);
  assert.deepEqual(english.bn, []);
});

test('existing translations retain their meaning and correct display languages', () => {
  assert.deepEqual(entryView(bilingual, 'bn').meaningValues, ['beautiful']);
  assert.equal(entryView(bilingual, 'bn').label, 'ENGLISH MEANING');
  assert.deepEqual(entryView(bilingual, 'en').meaningValues, ['সুন্দর']);
  assert.equal(entryView(bilingual, 'en').label, 'বাংলা অর্থ · BANGLA MEANING');
});

test('phonetic previews prefer actual English meanings and label native-only fallback', () => {
  assert.deepEqual(meaningPreview([native, bilingual]), { language: 'en', values: ['beautiful'] });
  const preview = meaningPreview([native]);
  assert.equal(preview.language, 'bn');
  assert.match(preview.values[0], /^বাংলা সংজ্ঞা:/);
  assert.deepEqual(meaningPreview([]), { language: 'bn', values: [] });
});

test('native definition arrays preserve senses and support legacy definitionBn', () => {
  assert.deepEqual(banglaDefinitions({definitionBn: 'একটি সংজ্ঞা।'}), ['একটি সংজ্ঞা।']);
  assert.deepEqual(banglaDefinitions(native), ['যার কিছুই নেই; দরিদ্র।']);
  assert.deepEqual(banglaDefinitions({definitionsBn: ['', null, 'প্রথম', 'দ্বিতীয়']}), ['প্রথম', 'দ্বিতীয়']);
});
