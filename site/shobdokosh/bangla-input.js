import { transliterate } from './transliteration.js';
import { KEYBOARD_ROWS, editText } from './bangla-keyboard.js';

/** Bind the local input method without changing the user's operating-system keyboard. */
export function createBanglaInput({ input, onChange, getMeanings = () => [] }) {
  const panel = document.querySelector('#bangla-input');
  const keyboard = document.querySelector('#bangla-keyboard');
  const preview = document.querySelector('#phonetic-preview');
  const candidate = document.querySelector('#phonetic-candidate');
  const meaning = document.querySelector('#phonetic-meaning');
  const help = document.querySelector('#typing-help');
  let direction = 'en';
  let keyboardOpen = false;
  let composing = false;
  let selection = { start: 0, end: 0 };

  function rememberSelection() {
    selection = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length };
  }

  function getQuery() {
    return direction === 'bn' && !composing ? transliterate(input.value) : input.value;
  }

  function update() {
    const active = direction === 'bn';
    keyboard.hidden = !active || !keyboardOpen;
    input.placeholder = active ? 'বাংলা / bangla…' : 'English word…';
    input.lang = active && /[\u0980-\u09ff]/u.test(input.value) ? 'bn' : 'en';
    help.textContent = 'Bangla is accepted directly; English letters transliterate automatically in Bangla mode.';
    const converted = active && !composing ? getQuery() : input.value;
    preview.hidden = !active || converted === input.value || !input.value.trim();
    panel.hidden = !active || (preview.hidden && !keyboardOpen);
    candidate.textContent = converted;
    const result = preview.hidden ? [] : getMeanings(converted);
    const meanings = Array.isArray(result) ? result : result?.values || [];
    meaning.setAttribute('lang', Array.isArray(result) ? 'en' : result?.language || 'en');
    meaning.textContent = meanings.join(' · ');
    meaning.hidden = !meanings.length;
    const toggle = document.querySelector('#bangla-toggle');
    toggle.setAttribute('aria-pressed', String(active && keyboardOpen));
    toggle.setAttribute('aria-expanded', String(active && keyboardOpen));
    toggle.setAttribute('aria-label', active && keyboardOpen ? 'Hide Bangla keyboard' : 'Open Bangla keyboard');
  }

  function notify() {
    rememberSelection();
    update();
    onChange();
  }

  function commit() {
    if (direction !== 'bn' || composing) return;
    rememberSelection();
    const value = input.value;
    const next = transliterate(value);
    if (value === next) return;
    const start = transliterate(value.slice(0, selection.start)).length;
    const end = transliterate(value.slice(0, selection.end)).length;
    input.value = next;
    input.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length));
    rememberSelection();
    update();
  }

  function setDirection(value) {
    direction = value;
    update();
  }

  function toggleKeyboard() {
    keyboardOpen = !keyboardOpen;
    update();
    input.focus({ preventScroll: true });
  }

  function applyKey(key, returnToInput) {
    if (returnToInput) input.focus({ preventScroll: true });
    input.setSelectionRange(selection.start, selection.end);
    commit();
    const action = key.kind === 'backspace' || key.kind === 'clear' ? { type: key.kind } : { type: 'insert', value: key.value };
    const next = editText(input.value, input.selectionStart, input.selectionEnd, action);
    if (action.type === 'insert' && next.text.length > input.maxLength) return;
    input.value = next.text;
    input.setSelectionRange(next.selectionStart, next.selectionEnd);
    notify();
  }

  for (const [index, row] of KEYBOARD_ROWS.entries()) {
    const container = document.createElement('div');
    container.className = 'bangla-keyboard-row';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', `Bangla keyboard row ${index + 1}`);
    for (const key of row) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `bangla-key ${key.kind || 'letter'}`;
      button.textContent = key.label;
      button.lang = 'bn';
      if (key.ariaLabel) button.title = key.ariaLabel;
      button.setAttribute('aria-label', key.ariaLabel || key.label);
      button.addEventListener('pointerdown', event => { event.preventDefault(); });
      button.addEventListener('click', event => applyKey(key, event.detail !== 0));
      container.append(button);
    }
    keyboard.append(container);
  }

  input.addEventListener('select', rememberSelection);
  input.addEventListener('keyup', rememberSelection);
  input.addEventListener('click', rememberSelection);
  input.addEventListener('input', event => {
    rememberSelection();
    if (event.isComposing || composing) return;
    // Mobile keyboards can insert Space without firing a useful keydown event.
    if (event.data === ' ' || (event.inputType === 'insertText' && /\s$/u.test(event.data || ''))) commit();
    update();
  });
  input.addEventListener('compositionstart', () => { composing = true; update(); });
  input.addEventListener('compositionend', () => { composing = false; notify(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === ' ' || event.key === 'Enter') commit();
  });
  document.querySelector('#commit-phonetic').addEventListener('pointerdown', event => event.preventDefault());
  document.querySelector('#commit-phonetic').addEventListener('click', () => {
    commit(); input.focus({ preventScroll: true }); notify();
  });
  update();
  return { setDirection, getQuery, commit, toggleKeyboard, refresh: update };
}
