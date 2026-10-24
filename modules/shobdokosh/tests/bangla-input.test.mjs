import assert from 'node:assert/strict';
import test from 'node:test';
import { createBanglaInput } from '../dist/bangla-input.js';

class Element {
  constructor() {
    this.value = '';
    this.selectionStart = this.selectionEnd = 0;
    this.maxLength = 120;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(child) { this.children.push(child); }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  emit(type, properties = {}) {
    const event = { key: '', detail: 1, preventDefault() {}, ...properties };
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
  setSelectionRange(start, end) {
    this.selectionStart = Math.min(start, this.value.length);
    this.selectionEnd = Math.min(end, this.value.length);
  }
  focus() { globalThis.document.activeElement = this; }
}

function setup(t, options = {}) {
  const previousDocument = globalThis.document;
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  globalThis.document = { querySelector: element, createElement: () => new Element() };
  t.after(() => { globalThis.document = previousDocument; });
  const input = new Element();
  let changes = 0;
  const controller = createBanglaInput({ input, onChange: () => { changes += 1; }, ...options });
  const type = (text, properties) => {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.emit('input', properties);
  };
  const key = (label) => element('#bangla-keyboard').children
    .flatMap(row => row.children).find(button => button.textContent === label);
  return { input, element, controller, type, key, changes: () => changes };
}

test('Banglish stays editable while its Bangla preview drives live lookup', (t) => {
  const { input, controller, element, type } = setup(t);
  controller.setDirection('bn');
  type('bangla');
  assert.equal(input.value, 'bangla');
  assert.equal(controller.getQuery(), 'বাংলা');
  assert.equal(element('#phonetic-candidate').textContent, 'বাংলা');
  assert.equal(element('#phonetic-preview').hidden, false);
  type('boi');
  assert.equal(controller.getQuery(), 'বই');
  type('বই');
  assert.equal(controller.getQuery(), 'বই');
  assert.equal(element('#phonetic-preview').hidden, true);
});

test('the orgho and orghyo previews retain their distinct Bangla words', (t) => {
  const queries = [];
  const meanings = ['offering', 'tribute', 'gift'];
  const { input, controller, element, type } = setup(t, {
    getMeanings(query) {
      queries.push(query);
      return ['অর্ঘ', 'অর্ঘ্য'].includes(query) ? meanings : [];
    },
  });
  controller.setDirection('bn');
  for (const [roman, bangla] of [['orgho', 'অর্ঘ'], ['orghyo', 'অর্ঘ্য']]) {
    type(roman);
    assert.equal(input.value, roman);
    assert.equal(controller.getQuery(), bangla);
    assert.equal(element('#phonetic-candidate').textContent, bangla);
    assert.equal(element('#phonetic-meaning').hidden, false);
    assert.equal(element('#phonetic-meaning').textContent, 'offering · tribute · gift');
  }
  assert.deepEqual(queries, ['অর্ঘ', 'অর্ঘ্য']);
});

test('familiar spellings share a live candidate, meaning and committed word', (t) => {
  const queries = [];
  const { input, controller, element, type } = setup(t, {
    getMeanings(query) {
      queries.push(query);
      return query === 'সুন্দর' ? ['beautiful', 'lovely'] : [];
    },
  });
  controller.setDirection('bn');
  for (const roman of ['sundor', 'shundor', 'sundar', 'shundar']) {
    type(roman);
    assert.equal(input.value, roman, 'the original spelling stays editable');
    assert.equal(controller.getQuery(), 'সুন্দর');
    assert.equal(element('#phonetic-candidate').textContent, 'সুন্দর');
    assert.equal(element('#phonetic-meaning').textContent, 'beautiful · lovely');
    assert.equal(element('#phonetic-meaning').hidden, false);
    element('#commit-phonetic').emit('click');
    assert.equal(input.value, 'সুন্দর');
    assert.equal(input.selectionStart, input.value.length);
    assert.equal(element('#phonetic-preview').hidden, true);
  }
  assert.deepEqual(queries, Array(4).fill('সুন্দর'));
});

test('preview meanings clear for unknown words, English mode and native IME composition', (t) => {
  const { input, controller, element, type } = setup(t, {
    getMeanings: query => query === 'অর্ঘ' ? ['offering'] : [],
  });
  const assertNoMeaning = () => {
    assert.equal(element('#phonetic-meaning').textContent, '');
    assert.equal(element('#phonetic-meaning').hidden, true);
  };
  controller.setDirection('bn');
  type('orgho');
  assert.equal(element('#phonetic-meaning').hidden, false);
  type('xyzzy');
  assertNoMeaning();

  type('orgho');
  assert.equal(element('#phonetic-meaning').hidden, false);
  controller.setDirection('en');
  assert.equal(controller.getQuery(), 'orgho');
  assertNoMeaning();

  controller.setDirection('bn');
  assert.equal(element('#phonetic-meaning').hidden, false);
  input.emit('compositionstart');
  assert.equal(element('#phonetic-preview').hidden, true);
  assertNoMeaning();
  type('অর্ঘ্য', { isComposing: true });
  input.emit('compositionend');
  assert.equal(controller.getQuery(), 'অর্ঘ্য');
  assert.equal(element('#phonetic-preview').hidden, true);
  assertNoMeaning();
});

test('Space and Enter commit Bangla before the browser inserts or submits', (t) => {
  const { input, controller, type } = setup(t);
  controller.setDirection('bn');
  type('ami bangla');
  input.emit('keydown', { key: ' ' });
  assert.equal(input.value, 'আমি বাংলা');
  assert.equal(input.selectionStart, input.value.length);
  type('boi');
  input.emit('keydown', { key: 'Enter' });
  assert.equal(input.value, 'বই');
  assert.equal(input.selectionStart, 2);
});

test('a mobile Space input commits Bangla without requiring a keydown event', (t) => {
  const { input, controller, type } = setup(t);
  controller.setDirection('bn');
  type('bangla ', { data: ' ', inputType: 'insertText' });
  assert.equal(input.value, 'বাংলা ');
  assert.equal(input.selectionStart, input.value.length);
  type('ami bangla ', { data: 'bangla ', inputType: 'insertText' });
  assert.equal(input.value, 'আমি বাংলা ');
  assert.equal(input.selectionStart, input.value.length);
});

test('English mode preserves Latin search text and does not commit on Space', (t) => {
  const { input, controller, element, type } = setup(t);
  type('book');
  input.emit('keydown', { key: ' ' });
  assert.equal(input.value, 'book');
  assert.equal(controller.getQuery(), 'book');
  assert.equal(element('#bangla-input').hidden, true);
  controller.setDirection('bn');
  assert.equal(element('#bangla-input').hidden, false);
  controller.setDirection('en');
  assert.equal(controller.getQuery(), 'book');
});

test('on-screen letters replace the remembered selection and preserve the caret', (t) => {
  const { input, controller, type, key, changes } = setup(t);
  controller.setDirection('bn');
  type('বাংলা বই');
  input.setSelectionRange(6, 8);
  input.emit('select');
  key('ক').emit('click');
  assert.equal(input.value, 'বাংলা ক');
  assert.equal(input.selectionStart, 7);
  key('◌া').emit('click');
  assert.equal(input.value, 'বাংলা কা');
  assert.equal(input.selectionStart, 8);
  assert.equal(changes(), 2);
});

test('keyboard activation preserves the focused key and pointer activation returns to search', (t) => {
  const { input, controller, type, key } = setup(t);
  controller.setDirection('bn');
  type('বই');
  const letter = key('ক');
  letter.focus();
  letter.emit('click', { detail: 0 });
  assert.equal(document.activeElement, letter);
  assert.equal(input.value, 'বইক');
  letter.emit('click', { detail: 1 });
  assert.equal(document.activeElement, input);
  assert.equal(input.value, 'বইকক');
});

test('native IME composition is neither converted nor committed mid-composition', (t) => {
  const { input, controller, element, type, changes } = setup(t);
  controller.setDirection('bn');
  input.emit('compositionstart');
  type('bangla', { isComposing: true });
  input.emit('keydown', { key: 'Enter', isComposing: true });
  assert.equal(input.value, 'bangla');
  assert.equal(controller.getQuery(), 'bangla');
  assert.equal(element('#phonetic-preview').hidden, true);
  type('bangla ', { isComposing: true, data: ' ', inputType: 'insertText' });
  assert.equal(input.value, 'bangla ');
  // Some browsers omit InputEvent.isComposing; the local composition session
  // must still protect native input until compositionend.
  type('bangla ', { isComposing: false, data: ' ', inputType: 'insertText' });
  assert.equal(input.value, 'bangla ');
  type('বাংলা', { isComposing: true });
  input.emit('compositionend');
  assert.equal(input.value, 'বাংলা');
  assert.equal(controller.getQuery(), 'বাংলা');
  assert.equal(changes(), 1);
});

test('Bangla script and Roman phonetic text are handled automatically', (t) => {
  const { input, controller, element, type } = setup(t);
  controller.setDirection('bn');
  type('পানি');
  assert.equal(controller.getQuery(), 'পানি');
  assert.equal(input.lang, 'bn');
  assert.equal(element('#phonetic-preview').hidden, true);
  type('pani');
  assert.equal(controller.getQuery(), 'পানি');
  assert.equal(element('#phonetic-preview').hidden, false);
  type('বাংলা boi');
  assert.equal(controller.getQuery(), 'বাংলা বই');
});

test('a native-only phonetic meaning is shown as Bangla without pretending to be English', t => {
  const {controller,element,type}=setup(t,{getMeanings:()=>({language:'bn',values:['বাংলা সংজ্ঞা: যার কিছুই নেই।']})});
  controller.setDirection('bn');type('okinchon');
  assert.equal(element('#phonetic-meaning').attributes.get('lang'),'bn');
  assert.match(element('#phonetic-meaning').textContent,/^বাংলা সংজ্ঞা:/);
  assert.equal(element('#phonetic-meaning').hidden,false);
});

test('the auxiliary panel stays hidden until a preview or keyboard is needed', (t) => {
  const { controller, element, type } = setup(t);
  controller.setDirection('bn');
  assert.equal(element('#bangla-input').hidden, true);
  type('boi');
  assert.equal(element('#bangla-input').hidden, false);
  type('');
  assert.equal(element('#bangla-input').hidden, true);
  controller.toggleKeyboard();
  assert.equal(element('#bangla-input').hidden, false);
  assert.equal(element('#bangla-keyboard').hidden, false);
  controller.toggleKeyboard();
  assert.equal(element('#bangla-input').hidden, true);
  controller.setDirection('en');
});

test('close dictionary spelling can be chosen without overriding literal transliteration', t => {
  const { input, controller, element, type, changes } = setup(t, {
    getSuggestions: query => query === 'কঙ্কন' ? ['কঙ্কণ'] : [],
  });
  controller.setDirection('bn');
  type('konkon');
  assert.equal(controller.getQuery(), 'কঙ্কন');
  const suggestions = element('#phonetic-suggestions');
  assert.equal(suggestions.hidden, false);
  suggestions.children.find(child => child.textContent === 'কঙ্কণ').emit('click');
  assert.equal(input.value, 'কঙ্কণ');
  assert.equal(controller.getQuery(), 'কঙ্কণ');
  assert.equal(suggestions.hidden, true);
  assert.equal(changes(), 1);
});
