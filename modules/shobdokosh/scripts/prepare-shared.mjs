import { cpSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOBDOKOSH_FILES } from './shobdokosh-assets.mjs';
import { collect, copyFiles, copySnapshot, helperName, prepareManagedAppAsync, shipHelper, toolPath, validateManagedDestination } from './snapshot-lib.mjs';

const file = fileURLToPath(import.meta.url);
const identity = { app: 'shobdokosh', label: 'Shobdokosh', site: 'site/shobdokosh', source: 'modules/shobdokosh' };

export function validateShobdokoshDestination(target) {
  return validateManagedDestination(target, { ...identity,
    required: { files: ['index.html', 'sw.js', '.nojekyll'], sourceFiles: ['Makefile', 'package.json', helperName] },
  });
}

// This source distribution includes a public upstream dictionary database and its
// README/license. They are required offline assets, never a user's saved data.
function copyDistribution(origin, destination) {
  const names = Object.keys(collect(origin)).filter(name => name.split('/').at(-1) !== '.DS_Store');
  for (const name of names) if (!SHOBDOKOSH_FILES.has(name)) throw new Error('Unapproved Shobdokosh asset: ' + name);
  for (const name of SHOBDOKOSH_FILES) if (!names.includes(name)) throw new Error('Missing Shobdokosh asset: ' + name);
  copyFiles(origin, destination, names);
}

export function prepareShobdokosh(origin, target, run, options) {
  return prepareManagedAppAsync({ ...identity, file,
    validate: validateShobdokoshDestination,
    snapshot(origin, destination) {
      copySnapshot(origin, destination, { label: 'Shobdokosh',
        files: ['Makefile', 'package.json', 'server.mjs', 'THIRD_PARTY_NOTICES.md',
          ...['scripts', 'tests'].flatMap(folder => readdirSync(join(origin, folder)).filter(name => /^[A-Za-z0-9_.-]+\.(?:mjs|py)$/.test(name)).map(name => folder + '/' + name)),
          ...['coverage', 'inventory', 'nltr-category-inventory', 'sources', 'wikisource-revisions'].map(name => 'resources/tagore/' + name + '.json')],
        folders: [],
        allowed: (kind, name) => /^(?:scripts|tests)\/[A-Za-z0-9_.-]+\.(?:mjs|py)$/.test(name),
      });
      copyDistribution(join(origin, 'dist'), join(destination, 'dist'));
      shipHelper(file, destination);
      cpSync(join(dirname(file), 'shobdokosh-assets.mjs'), join(destination, 'scripts/shobdokosh-assets.mjs'));
    },
    version(source) {
      const info = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
      if (info.name !== 'shobdokosh-dictionary' || !/^\d+\.\d+\.\d+$/.test(info.version)) throw new Error('Invalid Shobdokosh package version.');
      return info.version;
    },
    environment: () => ({ ...process.env, PATH: toolPath() }),
    copyBuild: copyDistribution,
  }, origin, target, run, options);
}

if (process.argv[1] && resolve(process.argv[1]) === file) {
  try {
    if (!process.argv[2]) throw new Error('Pass the existing shared Sites checkout.');
    await prepareShobdokosh(resolve(dirname(file), '..'), resolve(process.argv[2]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
