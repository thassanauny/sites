#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackDictionary } from '../dist/dictionary-format.js';
import { auditTagoreCoverage } from '../dist/coverage-core.js';
import { buildIndex, normalize, resolveBanglaWord } from '../dist/search.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_DICTIONARIES = [
  'dist/data/featured.json', 'dist/data/dictionary.json', 'dist/data/expanded-dictionary.json', 'dist/data/bn-wiktionary-dictionary.json', 'dist/data/reading-dictionary.json', 'dist/data/native-bengali.json', 'dist/data/english-bangla-definitions.json',
];

function options(argv) {
  const result = {
    corpus: 'resources/tagore/vocabulary.json', dictionaries: [],
    output: 'resources/tagore/coverage.json', unresolved: 'resources/tagore/unresolved.json',
    date: '2026-10-23',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help') {
      process.stdout.write('Audit Tagore dictionary coverage.\n\n--corpus PATH\n--dictionary PATH (repeatable; replaces defaults)\n--output PATH\n--unresolved PATH\n--date YYYY-MM-DD (default 2026-10-23)\n\nPaths are relative to the app directory unless absolute.\n');
      return null;
    }
    if (!['--corpus', '--dictionary', '--output', '--unresolved', '--date'].includes(flag)) {
      throw new TypeError(`Unknown option: ${flag}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new TypeError(`Missing value for ${flag}`);
    if (flag === '--dictionary') result.dictionaries.push(value);
    else result[flag.slice(2)] = value;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result.date)) throw new TypeError('--date must be YYYY-MM-DD');
  if (!result.dictionaries.length) {
    result.dictionaries = [...DEFAULT_DICTIONARIES];
    result.optionalLiteraryDictionary = true;
  }
  return result;
}

const pathFor = path => isAbsolute(path) ? path : resolve(ROOT, path);
const displayPath = path => relative(ROOT, path).split('\\').join('/');
async function loadJson(path) {
  const file = pathFor(path);
  const bytes = await readFile(file);
  return {
    data: unpackDictionary(JSON.parse(bytes.toString('utf8'))),
    fingerprint: {
      path: displayPath(file), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

async function main() {
  const config = options(process.argv.slice(2));
  if (!config) return;
  if (config.optionalLiteraryDictionary) {
    const literary = 'dist/data/literary-dictionary.json';
    try {
      await access(pathFor(literary));
      config.dictionaries.push(literary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const loaded = await Promise.all([loadJson(config.corpus), ...config.dictionaries.map(loadJson)]);
  const [corpus, ...dictionaries] = loaded;
  const entries = [];
  const fingerprints = dictionaries.map(({ data, fingerprint }) => {
    const sourceEntries = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(sourceEntries)) throw new TypeError(`No entries array: ${fingerprint.path}`);
    entries.push(...sourceEntries);
    return { ...fingerprint, entryCount: sourceEntries.length };
  });
  const index = buildIndex(entries);
  const { report, unresolved } = auditTagoreCoverage({
    corpus: corpus.data, resolve: word => resolveBanglaWord(index, word),
    dictionaryFingerprints: fingerprints, corpusFingerprint: corpus.fingerprint, auditDate: config.date,
  });
  report.dictionary = {
    entryCount: entries.length,
    bengaliHeadwords: new Set(entries.flatMap(entry => entry.bn.map(normalize))).size,
    englishHeadwords: new Set(entries.map(entry => normalize(entry.en)).filter(Boolean)).size,
  };
  const unresolvedData = {
    meta: {
      schemaVersion: 1, auditDate: config.date, uniqueForms: unresolved.length,
      totalTokens: report.stats.unresolved.tokens,
      sourceCoverageScope: report.meta.sourceCoverageScope,
      fullAuthorCoverageVerified: false,
      description: 'Corpus forms with no exact dictionary or validated related base-form lookup; occurrence supplies no verified meaning.',
      corpusFingerprint: corpus.fingerprint, dictionaryFingerprints: fingerprints,
    },
    words: unresolved,
  };
  const output = pathFor(config.output);
  const unresolvedPath = pathFor(config.unresolved);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(unresolvedPath), { recursive: true });
  await writeFile(output, JSON.stringify(report) + '\n');
  await writeFile(unresolvedPath, JSON.stringify(unresolvedData) + '\n');
  const { stats } = report;
  process.stdout.write(JSON.stringify({
    output: displayPath(output), unresolvedOutput: displayPath(unresolvedPath), stats,
    sourceRecords: report.sourceInventory.recordCount,
    topUnresolved: report.topUnresolved.slice(0, 30).map(({ word, count }) => ({ word, count })),
  }, null, 2) + '\n');
}

main().catch(error => {
  process.stderr.write(`Coverage audit failed: ${error.message}\n`);
  process.exitCode = 1;
});
