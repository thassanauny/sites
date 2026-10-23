import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { KEYBOARD_ROWS, editText } from '../dist/bangla-keyboard.js';

const insert = (value) => ({ type: 'insert', value });
const backspace = { type: 'backspace' };

function result(text, caret) {
  return { text, selectionStart: caret, selectionEnd: caret };
}

test('the built-in layout can spell vowels, consonants, conjuncts, signs and Bangla numbers', () => {
  const keys = KEYBOARD_ROWS.flat();
  const values = new Set(keys.map((key) => key.value));
  for (const character of 'অআইঈউঊঋএঐওঔকখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহড়ঢ়য়ৎংঃঁািীুূৃেৈোৌ্০১২৩৪৫৬৭৮৯ ') {
    assert.ok(values.has(character), `${character} must be available without a device keyboard`);
  }
  for (const key of keys) {
    assert.equal(typeof key.label, 'string');
    assert.ok(key.label.length);
    assert.equal(typeof key.value, 'string');
  }
  assert.ok(keys.some((key) => key.kind === 'backspace'));
  assert.ok(keys.some((key) => key.kind === 'clear'));
});

test('letter and vowel-sign buttons build Bangla words at the caret', () => {
  let state = result('', 0);
  for (const character of ['ব', 'া', 'ং', 'ল', 'া']) {
    state = editText(state.text, state.selectionStart, state.selectionEnd, insert(character));
  }
  assert.deepEqual(state, result('বাংলা', 5));
  assert.deepEqual(editText('বাল', 2, 2, insert('ং')), result('বাংল', 3));
});

test('a keyboard button replaces the selected text and leaves the caret after it', () => {
  assert.deepEqual(editText('hello world', 6, 11, insert('বাংলা')), result('hello বাংলা', 11));
  assert.deepEqual(editText('hello world', 11, 6, insert('বাংলা')), result('hello বাংলা', 11));
  assert.deepEqual(editText('বাংলা বই', 7, 8, insert('াড়ি')), result('বাংলা বাড়ি', 10));
});

test('keyboard edits clamp selection offsets to the input boundaries', () => {
  assert.deepEqual(editText('বই', -20, 20, insert('জল')), result('জল', 2));
  assert.deepEqual(editText('বই', 20, 20, insert('!')), result('বই!', 3));
  assert.deepEqual(editText('বই', 1.8, 1.8, insert('া')), result('বাই', 2));
  assert.deepEqual(editText('বই', undefined, undefined, insert('!')), result('বই!', 3));
});

test('backspace deletes a selected range and clear empties the input', () => {
  assert.deepEqual(editText('বাংলা বই', 6, 8, backspace), result('বাংলা ', 6));
  assert.deepEqual(editText('বাংলা বই', 2, 3, { type: 'clear' }), result('', 0));
  assert.deepEqual(editText('', 0, 0, backspace), result('', 0));
  assert.deepEqual(editText('বই', 0, 0, backspace), result('বই', 0));
});

test('backspace removes complete Bangla vowel signs and conjunct graphemes', () => {
  for (const cluster of ['কা', 'কি', 'কু', 'কো', 'ক্ষ', 'ক্তি', 'ক্‍ষ', 'ড়', 'চাঁ']) {
    const text = `a${cluster}z`;
    assert.deepEqual(editText(text, text.length - 1, text.length - 1, backspace), result('az', 1), cluster);
  }
  assert.deepEqual(editText('বাংলা', 5, 5, backspace), result('বাং', 3));
  assert.deepEqual(editText('শব্দ', 4, 4, backspace), result('শ', 1));
});

test('backspace keeps emoji, combining accents and UTF-16 cursor offsets intact', () => {
  for (const cluster of ['😀', '👩‍💻', '👨‍👩‍👧‍👦', '👍🏽', '🇧🇩', 'e\u0301']) {
    const text = `a${cluster}z`;
    assert.deepEqual(editText(text, text.length - 1, text.length - 1, backspace), result('az', 1), cluster);
  }
  assert.deepEqual(editText('😀বই', 2, 2, insert('ক')), result('😀কবই', 3));
});

test('a caret inside a grapheme removes that whole grapheme without orphaning its marks', () => {
  assert.deepEqual(editText('aকোz', 2, 2, backspace), result('az', 1));
  assert.deepEqual(editText('a👩‍💻z', 3, 3, backspace), result('az', 1));
});

test('programmatic selections cannot split emoji surrogate pairs', () => {
  assert.deepEqual(editText('a😀z', 2, 2, insert('ক')), result('aক😀z', 2));
  assert.deepEqual(editText('a😀z', 2, 3, insert('ক')), result('aকz', 2));
  assert.deepEqual(editText('a😀z', 1, 2, backspace), result('az', 1));
  assert.deepEqual(editText('a😀z', 2, 2, backspace), result('az', 1));
});

test('older browsers retain Bangla conjuncts and joined emoji without Intl.Segmenter', async () => {
  const source = await readFile(new URL('../dist/bangla-keyboard.js', import.meta.url), 'utf8');
  const context = vm.createContext({ Intl: {} });
  vm.runInContext(source.replace(/export /g, '') + '\nglobalThis.editText = editText;', context);
  for (const cluster of ['কা', 'ক্তি', 'ক্‍ষ', 'ক্‌', '👩‍💻', '👍🏽', '🇧🇩', 'e\u0301']) {
    const text = `a${cluster}z`;
    assert.deepEqual({ ...context.editText(text, text.length - 1, text.length - 1, backspace) }, result('az', 1), cluster);
  }
});

test('visible conjunct controls can compose স্বর্গ', () => {
  const keys = KEYBOARD_ROWS.flat();
  let state = result('', 0);
  for (const label of ['স', 'ব-ফলা', 'রেফ', 'গ']) {
    const key = keys.find(key => (key.ariaLabel || key.label) === label);
    state = editText(state.text, state.selectionStart, state.selectionEnd, insert(key.value));
  }
  assert.equal(state.text, 'স্বর্গ');
  state = result('', 0);
  for (const character of ['স', '্', 'ব', 'র', '্', 'গ']) {
    const key = keys.find(key => key.value === character);
    state = editText(state.text, state.selectionStart, state.selectionEnd, insert(key.value));
  }
  assert.equal(state.text, 'স্বর্গ');
});
