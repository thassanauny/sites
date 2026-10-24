import avro from './vendor/avro-phonetic.js';

// Familiar Banglish spellings are whole-word conveniences, never global sound
// replacements: shob must remain শব, bhasa ভাসা, and chad ছাদ. Only lowercase
// words without Avro controls match; case-sensitive spellings and ` / ^ still
// go through the complete Avro engine, including its conjunct and vowel rules.
// Keep valid alternative words and spellings, such as bhalobasa → ভালবাসা.
const familiarSpellings = new Map([
  ['ভালো', ['bhalo']],
  ['ভালোবাসা', ['bhalobasha', 'valobasha']],
  ['ভালোবাসি', ['bhalobashi', 'valobashi']],
  ['অর্ঘ', ['orgho']],
  ['অর্ঘ্য', ['orghyo']],
  ['যাতনা', ['jatona']],
  ['শৈল', ['shoil', 'shoilo']],
  ['জীর্ণ', ['jirno', 'jeerno', 'jirna']],
  ['সুন্দর', ['sundor', 'shundor', 'sundar', 'shundar']],
  ['সকাল', ['sokal', 'shokal', 'sakal']],
  ['সময়', ['somoy', 'shomoy', 'samay']],
  ['শব্দ', ['shobdo', 'sobdo', 'shabdo', 'shabda']],
  ['শক্তি', ['shokti', 'shakti', 'sokti']],
  ['শান্তি', ['shanti', 'santi']],
  ['বন্ধু', ['bondhu', 'bandhu']],
  ['জীবন', ['jibon', 'jiban']],
  ['প্রকৃতি', ['prokriti', 'prakriti']],
  ['পৃথিবী', ['prithibi', 'prithivi']],
  ['স্বপ্ন', ['shopno', 'swapno', 'sopno', 'swopno']],
  ['শিক্ষা', ['shikkha', 'shiksha', 'siksha', 'sikkha']],
  ['হৃদয়', ['hridoy', 'hriday', 'ridoy']],
  ['ভাষা', ['bhasha']],
  ['দুঃখ', ['dukkho', 'dukhkho']],
  ['শিশু', ['shishu', 'sishu']],
  ['সুখ', ['sukh', 'shukh']],
  ['সত্যি', ['sotyi', 'sotti', 'shotti']],
  ['আনন্দ', ['anondo', 'ananda']],
  ['নদী', ['nodi', 'nadi']],
  ['বিরহ', ['biroho', 'biraha']],
  ['আকাশ', ['akash', 'akaash']],
  ['সমুদ্র', ['somudro', 'shomudro', 'samudra']],
  ['মা', ['ma', 'maa']],
  ['আমার', ['amar', 'amaar']],
  ['করুণা', ['koruna', 'karuna']],
  ['স্বাধীন', ['sadhin', 'shadhin']],
  ['স্বাধীনতা', ['sadhinota', 'shadhinota']],
].flatMap(([bangla, spellings]) => spellings.map(spelling => [spelling, bangla])));

/**
 * Transliterate a complete Roman composition into Bangla, locally and offline.
 * Always recompute from the original Roman text after an edit: phonetic rules
 * use context, so converting individual keystrokes loses vowels and conjuncts.
 * Existing Bangla, other scripts, whitespace, digits and punctuation stay intact.
 * Within Roman words, Avro's backtick and ^ controls retain their usual meaning.
 */
export function transliterate(text) {
  return String(text ?? '').replace(/[A-Za-z][A-Za-z`^]*/g, (word) =>
    familiarSpellings.get(word) ?? avro.parse(word));
}
