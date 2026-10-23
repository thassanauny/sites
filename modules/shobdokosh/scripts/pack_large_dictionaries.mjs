#!/usr/bin/env node
/** Preserve full source-derived JSON, then write compact offline dictionaries. */
import { readFile, writeFile, mkdir, copyFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPACT_DICTIONARY_FORMAT, packDictionary } from '../dist/dictionary-format.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const options = { inputDir: resolve(project, 'dist/data'), outputDir: null, backupDir: resolve(project, 'resources/dictionaries'), dryRun: false };
const argumentsList = process.argv.slice(2);
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === '--dry-run') options.dryRun = true;
  else if (argument === '--help') {
    process.stdout.write('Usage: node scripts/pack_large_dictionaries.mjs [--input-dir DIR] [--output-dir DIR] [--backup-dir DIR] [--dry-run]\n');
    process.exit(0);
  } else {
    const field = { '--input-dir': 'inputDir', '--output-dir': 'outputDir', '--backup-dir': 'backupDir' }[argument];
    if (!field || !argumentsList[index + 1] || argumentsList[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete argument: ${argument}`);
    options[field] = resolve(argumentsList[++index]);
  }
}
options.outputDir ||= options.inputDir;

const plans = [];
for (const name of ['native-bengali.json', 'english-bangla-definitions.json']) {
  const input = resolve(options.inputDir, name);
  const output = resolve(options.outputDir, name);
  const backup = resolve(options.backupDir, name);
  if (backup === input || backup === output) throw new Error('The full-source backup must be outside the runtime input/output location.');
  const source = await readFile(input);
  const dictionary = JSON.parse(source.toString('utf8'));
  if (dictionary.format === COMPACT_DICTIONARY_FORMAT) {
    plans.push({ name, input, output, backup, source, packed: source, alreadyPacked: true, entryCount: dictionary.entries.length });
    continue;
  }
  const packedDictionary = packDictionary(dictionary);
  const packed = Buffer.from(JSON.stringify(packedDictionary) + '\n');
  let existingBackup;
  try { existingBackup = await readFile(backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existingBackup && !existingBackup.equals(source)) throw new Error(`A different full-source backup already exists: ${backup}`);
  plans.push({ name, input, output, backup, source, packed, alreadyPacked: false, entryCount: dictionary.entries.length });
}

for (const plan of plans) {
  if (!options.dryRun) {
    if (!plan.alreadyPacked) {
      await mkdir(dirname(plan.backup), { recursive: true });
      try { await copyFile(plan.input, plan.backup, constants.COPYFILE_EXCL); }
      catch (error) {
        if (error.code !== 'EEXIST' || !(await readFile(plan.backup)).equals(plan.source)) throw error;
      }
      // Refuse a source file changed by an importer after the initial read.
      if (!(await readFile(plan.input)).equals(plan.source)) throw new Error(`Input changed while preparing the compact dictionary: ${plan.input}`);
    }
    if (plan.input !== plan.output || !plan.alreadyPacked) {
      await mkdir(dirname(plan.output), { recursive: true });
      const temporary = `${plan.output}.tmp-${process.pid}`;
      try {
        await writeFile(temporary, plan.packed, { flag: 'wx' });
        await rename(temporary, plan.output);
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  }
  process.stdout.write(JSON.stringify({
    file: plan.name, entries: plan.entryCount, originalBytes: plan.source.length,
    compactBytes: plan.packed.length, savedPercent: Number(((1 - plan.packed.length / plan.source.length) * 100).toFixed(2)),
    backup: plan.backup, output: plan.output, alreadyPacked: plan.alreadyPacked, dryRun: options.dryRun,
  }) + '\n');
}
