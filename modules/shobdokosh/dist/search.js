export function normalize(value) {
  return String(value ?? '').normalize('NFC').toLocaleLowerCase('en').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

export function buildIndex(entries) {
  const index = entries.map((entry, order) => ({ entry, order, en: normalize(entry.en), bn: entry.bn.map(normalize) }));
  const words = new Map();
  for (const item of index) for (const word of new Set(item.bn)) {
    if (!words.has(word)) words.set(word, []);
    words.get(word).push(item);
  }
  banglaIndexes.set(index, words);
  return index;
}

/** Resolve exact words first; related forms carry a visible inference label. */
export function resolveBanglaWord(index, query) {
  const needle = normalize(query);
  const words = banglaIndexes.get(index);
  if (!needle || !words) return { entries: [], exact: false };
  const exact = words.get(needle);
  if (exact?.length) return { entries: exact.map(item => item.entry), exact: true };
  const entries = new Map();
  for (const candidate of getBanglaBaseForms(needle)) {
    for (const item of words.get(normalize(candidate.word)) || []) {
      const compatible = !candidate.pos || item.entry.pos === candidate.pos
        || (candidate.pos === 'pronoun' && item.entry.pos === 'determiner');
      if (!compatible || entries.has(item.entry.id)) continue;
      entries.set(item.entry.id, Object.assign(Object.create(Object.getPrototypeOf(item.entry)), item.entry, {
        lookup: { query: needle, baseForm: candidate.word, kind: candidate.kind, label: candidate.label },
      }));
    }
  }
  return { entries: [...entries.values()], exact: false };
}

/** Display the Bangla spelling that matched, including non-primary synonyms. */
export function matchingBangla(entry, query = '') {
  const needle = normalize(query);
  if (!needle) return entry.bn[0];
  return entry.bn.find(word => normalize(word) === needle)
    || entry.bn.find(word => normalize(word).startsWith(needle))
    || entry.bn.find(word => normalize(word).includes(needle))
    || entry.bn[0];
}

export function searchDictionary(index, query, direction = 'en', limit = 40) {
  const needle = normalize(query);
  if (!needle) return { entries: [], total: 0 };
  const matches = [];
  for (const item of index) {
    const texts = direction === 'bn' ? item.bn : [item.en];
    let score = Infinity;
    for (const text of texts) {
      if (text === needle) score = Math.min(score, 0);
      else if (text.startsWith(needle)) score = Math.min(score, 10 + Math.min(text.length - needle.length, 30) / 100);
      else if (text.split(/[\s,;()[\]।]+/u).includes(needle)) score = Math.min(score, 20);
      else if (needle.length >= 2 && text.includes(needle)) score = Math.min(score, 30 + text.indexOf(needle) / 1000);
    }
    if (score < Infinity) matches.push({ entry: item.entry, order: item.order, score });
  }
  matches.sort((a, b) => a.score - b.score || a.order - b.order);
  if (direction === 'bn' && !matches.some(item => item.score === 0)) {
    const inferred = resolveBanglaWord(index, query).entries;
    if (inferred.length) {
      const byId = new Map(inferred.map((entry, order) => [entry.id, { entry, score: 5, order }]));
      for (const match of matches) if (!byId.has(match.entry.id)) byId.set(match.entry.id, match);
      const combined = [...byId.values()].sort((a, b) => a.score - b.score || a.order - b.order);
      return { entries: combined.slice(0, limit).map(item => item.entry), total: combined.length };
    }
  }
  return { entries: matches.slice(0, limit).map(item => item.entry), total: matches.length };
}

export function detectDirection(query, fallback = 'en') {
  if (/[\u0980-\u09ff]/u.test(query)) return 'bn';
  if (/[a-z]/i.test(query)) return 'en';
  return fallback;
}

export function dailyEntry(entries, date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return entries.length ? entries[((day % entries.length) + entries.length) % entries.length] : undefined;
}
import { getBanglaBaseForms } from './bengali-morphology.js';

const banglaIndexes = new WeakMap();
