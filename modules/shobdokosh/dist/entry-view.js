import { matchingBangla, normalize } from './search.js';

export function banglaDefinitions(entry) {
  const values = Array.isArray(entry.definitionsBn) ? entry.definitionsBn : [entry.definitionBn];
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

export function excerpt(value, length = 150) {
  const text = String(value || '').trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

/** Definition-only records never pretend that a Bengali definition is English. */
export function entryView(entry, direction = 'en', query = '') {
  const bangla = Array.isArray(entry.bn) ? entry.bn : [];
  const english = String(entry.en || '').trim();
  const definitions = banglaDefinitions(entry);
  const useBanglaTitle = bangla.length > 0 && (direction === 'bn' || !english);
  const title = useBanglaTitle ? matchingBangla(entry, query) : english || entry.headword || '';
  const titleLanguage = useBanglaTitle || entry.language === 'bn' && !english ? 'bn' : 'en';
  const englishMeaning = direction === 'bn' && bangla.length > 0 && Boolean(english);
  const equivalents = direction === 'en' && Boolean(english) && bangla.length > 0;
  const meaningValues = englishMeaning ? [english] : equivalents ? bangla : definitions;
  return {
    title, titleLanguage, meaningValues,
    meaningLanguage: englishMeaning ? 'en' : 'bn',
    label: englishMeaning ? 'ENGLISH MEANING' : equivalents ? 'বাংলা অর্থ · BANGLA MEANING' : 'বাংলা সংজ্ঞা',
    definitionOnly: !englishMeaning && !equivalents,
    englishUnavailable: bangla.length > 0 && !english,
    extraBanglaDefinitions: englishMeaning || equivalents ? definitions.filter(value => !bangla.some(word => normalize(word) === normalize(value))) : [],
  };
}

export function meaningPreview(entries) {
  const translated = entries.filter(entry => String(entry.en || '').trim());
  if (translated.length) {
    const curated = translated.filter(entry => entry.sourceKind === 'curated');
    const sourced = translated.filter(entry => entry.sourceKind !== 'community');
    const preferred = curated.length ? curated : sourced.length ? sourced : translated;
    return { language: 'en', values: [...new Set(preferred.map(entry => entry.lookup ? `${entry.en} (base: ${entry.lookup.baseForm})` : entry.en))].slice(0, 4) };
  }
  const values = [...new Set(entries.flatMap(entry => banglaDefinitions(entry).map(value => entry.lookup ? `${value} (মূল শব্দ: ${entry.lookup.baseForm})` : value)))];
  return { language: 'bn', values: values.slice(0, 2).map(value => `বাংলা সংজ্ঞা: ${excerpt(value, 120)}`) };
}
