const letters = (characters, kind) => [...characters].map((value) => ({ label: value, value, ...(kind ? { kind } : {}) }));
const marks = (characters) => [...characters].map((value) => ({ label: `◌${value}`, value, kind: 'mark' }));

export const KEYBOARD_ROWS = [
  letters('অআইঈউঊঋএঐওঔ'),
  letters('কখগঘঙচছজঝঞ'),
  letters('টঠডঢণতথদধন'),
  letters('পফবভমযরলশষসহ'),
  letters('ড়ঢ়য়ৎংঃঁ'),
  marks('ািীুূৃেৈোৌ'),
  [
    { label: '◌্', value: '্', kind: 'mark', ariaLabel: 'হসন্ত — যুক্তাক্ষর' },
    { label: '◌্ব', value: '্ব', kind: 'mark', ariaLabel: 'ব-ফলা' },
    { label: 'র্◌', value: 'র্', kind: 'mark', ariaLabel: 'রেফ' },
  ],
  letters('০১২৩৪৫৬৭৮৯', 'digit'),
  [
    { label: 'স্পেস', value: ' ', kind: 'space' },
    { label: '⌫', value: '', kind: 'backspace' },
    { label: 'মুছুন', value: '', kind: 'clear' },
  ],
];

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('bn', { granularity: 'grapheme' })
  : null;

function clampOffset(value, length, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.min(length, Math.trunc(value))) : fallback;
}

function splitsSurrogate(text, offset) {
  return offset > 0 && offset < text.length
    && /[\ud800-\udbff]/u.test(text[offset - 1])
    && /[\udc00-\udfff]/u.test(text[offset]);
}

// Older browsers without Segmenter still keep Bangla vowel marks, conjuncts,
// combining accents and joined emoji together when deleting a character.
function fallbackSegments(text) {
  const segments = [];
  let index = 0;
  let joinNext = false;
  let regionalCount = 0;
  for (const character of text) {
    const mark = /[\p{M}\u{1f3fb}-\u{1f3ff}]/u.test(character);
    const joiner = character === '\u200d' || character === '\u200c';
    const regional = /[\u{1f1e6}-\u{1f1ff}]/u.test(character);
    if (segments.length && (mark || joiner || joinNext || (regional && regionalCount % 2 === 1))) {
      segments[segments.length - 1].segment += character;
    } else {
      segments.push({ segment: character, index });
    }
    joinNext = character === '\u09cd' || character === '\u200d' || (joinNext && mark);
    regionalCount = regional ? regionalCount + 1 : 0;
    index += character.length;
  }
  return segments;
}

function replace(text, start, end, value) {
  const selectionStart = start + value.length;
  return {
    text: text.slice(0, start) + value + text.slice(end),
    selectionStart,
    selectionEnd: selectionStart,
  };
}

/** Edit an input using the same UTF-16 selection offsets as a browser input. */
export function editText(text, start, end, action) {
  text = String(text ?? '');
  start = clampOffset(start, text.length, text.length);
  end = clampOffset(end, text.length, start);
  if (start > end) [start, end] = [end, start];

  // A programmatically supplied selection must not split an emoji's surrogate pair.
  if (start === end) {
    if (action.type !== 'backspace' && splitsSurrogate(text, start)) start = end = start - 1;
  } else {
    if (splitsSurrogate(text, start)) start -= 1;
    if (splitsSurrogate(text, end)) end += 1;
  }

  if (action.type === 'clear') return replace(text, 0, text.length, '');
  if (action.type === 'insert') return replace(text, start, end, String(action.value ?? ''));
  if (action.type !== 'backspace') throw new TypeError(`Unknown keyboard action: ${action.type}`);
  if (start !== end) return replace(text, start, end, '');
  if (start === 0) return replace(text, start, end, '');

  const segments = segmenter ? segmenter.segment(text) : fallbackSegments(text);
  for (const part of segments) {
    const segmentEnd = part.index + part.segment.length;
    if (part.index < start && segmentEnd >= start) {
      return replace(text, part.index, segmentEnd, '');
    }
  }
  return replace(text, start, end, '');
}
