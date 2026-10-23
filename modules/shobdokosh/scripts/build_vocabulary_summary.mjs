#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unpackDictionary } from '../dist/dictionary-format.js';
import { getVocabularyStats } from '../dist/vocabulary-stats.js';

const root = new URL('../', import.meta.url);
const sources = ['featured', 'literary-dictionary', 'dictionary', 'expanded-dictionary', 'bn-wiktionary-dictionary', 'reading-dictionary', 'native-bengali', 'english-bangla-definitions'];
const entries = [];
const inputs = [];
for (const name of sources) {
  const path = `dist/data/${name}.json`;
  const bytes = await readFile(new URL(path, root));
  const data = unpackDictionary(JSON.parse(bytes));
  const values = Array.isArray(data) ? data : data.entries;
  entries.push(...values);
  inputs.push({ path, bytes: bytes.length, entryCount: values.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const output = {
  meta: {
    schemaVersion: 1,
    method: 'Distinct normalized language-tagged source headwords with a usable translation or definition. Multiple senses do not increase the count. English descriptive glosses, proper-name-only records and nonlexical-only entries are excluded from lexical counts. Multiword lexical entries are reported separately.',
    inputs,
  },
  stats: getVocabularyStats(entries),
};
const destination = new URL('dist/data/vocabulary-summary.json', root);
await writeFile(destination, JSON.stringify(output) + '\n');
process.stdout.write(JSON.stringify({ output: fileURLToPath(destination), ...output.stats }, null, 2) + '\n');
