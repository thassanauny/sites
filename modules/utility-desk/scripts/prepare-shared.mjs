import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  copySnapshot, helperName, isShipped, prepareManagedApp, readAppVersion, retargetPublishScript, shipHelper, stat,
  toolPath, validateManagedDestination,
} from './snapshot-lib.mjs';

const file = fileURLToPath(import.meta.url);
const label = 'Utility Desk Lite';
const filesToCopy = ['index.html', 'Makefile', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'eslint.config.js', 'biome.json', 'PARITY.md'];

// Source: code and its tests, plus the licence texts and notices that ship with the website.
const allowedSource = (kind, name) => kind === 'public'
  ? /^public\/(?:licenses\/[\w.-]+\.txt|THIRD_PARTY_NOTICES\.md)$/.test(name)
  : /^(?:src|tests)\/.+\.(?:ts|tsx|css)$/.test(name);
// Build: the page, bundled scripts, styles, wasm and fonts, and the PDF.js maps and fonts with their licences.
const allowedBuild = name => ['index.html', 'THIRD_PARTY_NOTICES.md', '.nojekyll'].includes(name)
  || /^licenses\/[\w.-]+\.txt$/.test(name)
  || /^assets\/[A-Za-z0-9._-]+\.(?:js|mjs|css|wasm|ttf)$/.test(name)
  || /^pdfjs\/cmaps\/(?:[\w.-]+\.bcmap|LICENSE)$/.test(name)
  || /^pdfjs\/standard_fonts\/(?:[\w.-]+\.(?:pfb|ttf)|LICENSE_[A-Z]+)$/.test(name);
const allowed = (kind, name) => kind === 'build' ? allowedBuild(name) : allowedSource(kind, name);

/** Read-only ownership check; the first run after an upgrade also accepts a manifest without source hashes. */
export function validateUtilityDestination(target) {
  return validateManagedDestination(target, {
    label, app: 'utility-desk', site: 'site/utility-desk', source: 'modules/utility-desk', bootstrap: false, legacy: true,
    required: { files: ['index.html', '.nojekyll'], sourceFiles: ['Makefile', 'package.json', helperName] },
  });
}

/** Copy the approved Utility Desk Lite source into `destination` with its standalone helper. */
export function snapshotUtility(origin, destination) {
  copySnapshot(origin, destination, { label, files: filesToCopy, folders: ['src', 'tests', 'public'], allowed });
  const makefile = join(destination, 'Makefile');
  retargetPublishScript(makefile);
  // The helper builds its own clean copy: standalone preparation must not install dependencies into the snapshot.
  writeFileSync(makefile, readFileSync(makefile, 'utf8').replace(/^prepare-shared:\s*setup\s*$/m, 'prepare-shared: runtime'));
  shipHelper(file, destination);
}

const spec = {
  app: 'utility-desk', label, file, site: 'site/utility-desk', source: 'modules/utility-desk', allowed,
  validate: validateUtilityDestination,
  snapshot: snapshotUtility,
  version: source => readAppVersion(source, 'utility-desk'),
  environment: () => ({ ...process.env, PATH: toolPath(), BASE_PATH: './' }),
};

/** Builds and prepares only Utility Desk Lite; never pushes or deploys. */
export const prepareUtility = (app, target, run = execFileSync, options) => prepareManagedApp(spec, app, target, run, options);

if (process.argv[1] && stat(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(file)) {
  if (!process.argv[2]) { console.error('Use make -C everydayapps/publishing publish from the development repository root.'); process.exitCode = 1; }
  else {
    const defaultApp = isShipped(file) ? join(dirname(file), '..') : join(dirname(file), '../apps/utility-desk-lite');
    try { prepareUtility(resolve(process.argv[3] || defaultApp), resolve(process.argv[2])); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
