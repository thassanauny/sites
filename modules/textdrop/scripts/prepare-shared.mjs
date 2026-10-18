import { cpSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeSharedBuildReport, checkSharedBuild } from './check-shared-build.mjs';
import { SHARED_APPS } from './catalog.mjs';
import {
  appendMakeTarget, copySnapshot, helperName, isShipped, placeholderEnvironment, prepareManagedApp, readAppVersion,
  resolveSettings, shipHelper, stat, toolPath, validateManagedDestination,
} from './snapshot-lib.mjs';

const file = fileURLToPath(import.meta.url);
const checkerName = 'scripts/check-shared-build.mjs';
const schemaFiles = ['tsconfig.app.json', 'tsconfig.node.json', 'biome.json', 'build-config.test.ts', 'supabase/schema.sql'];
const iconAssets = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
const apps = {
  textdrop: { assets: new Set(['logo.svg', ...iconAssets]), files: [...schemaFiles, 'supabase/update-poll-and-grants.sql', 'supabase/update-save-receipt.sql', 'supabase/update-shared-names.sql'], folders: ['src', 'public', 'tests'] },
  pinboard: { assets: new Set(['favicon.svg', ...iconAssets]), files: [...schemaFiles, 'supabase/schema.test.mjs', 'supabase/postgres-check.mjs'], folders: ['src', 'public'] },
  blueprint: {
    assets: new Set([...iconAssets, 'favicon.svg', '.nojekyll', 'licenses/Manrope.txt', 'licenses/DM-Sans.txt', 'licenses/React-Flow.txt']),
    files: ['playwright.config.ts', 'supabase/rename-to-blueprint.sql', 'supabase/migrations/001_blueprint_boards.sql', 'supabase/migrations/002_board_invitations.sql', 'supabase/migrations/003_shared_editing.sql', 'supabase/migrations/004_incremental_sync.sql'],
    folders: ['src', 'public', 'tests'], fonts: true,
  },
};
const commonFiles = ['Makefile', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.test.ts', 'build-config.ts', '.env.example'];
const prepareTarget = '\n.PHONY: prepare-shared\nprepare-shared: node-check\n\t"$(NODE)" scripts/prepare-shared.mjs "$(SITE_CHECKOUT)"\n';
// The Sites workflow runs this target; it only reads the prepared website.
const checkSite = name => '\n.PHONY: check-site\ncheck-site: node-check\n\t@test -n "$(SITE)" || { printf \'%s\\n\' \'Set SITE to the prepared website folder.\' >&2; exit 1; }\n\t"$(NODE)" ' + checkerName + ' "$(SITE)" ' + name + '\n';

function identity(name) {
  const entry = SHARED_APPS.find(app => app.id === name);
  if (!entry || !Object.hasOwn(apps, name)) throw new Error('Choose ' + SHARED_APPS.map(app => app.id).join(', ') + '.');
  return { ...entry, ...apps[name], name, site: 'site/' + name, source: 'modules/' + name };
}

const allowedFor = app => (kind, name) => ['src', 'tests'].includes(kind) ? new RegExp('^' + kind + '/.+\\.(?:ts|tsx|css)$').test(name)
  : kind === 'public' ? app.assets.has(name.slice('public/'.length))
  : ['index.html', '.nojekyll', 'manifest.webmanifest', 'registerSW.js', 'sw.js'].includes(name) || /^workbox-[A-Za-z0-9_-]+\.js$/.test(name) || app.assets.has(name) || /^assets\/[A-Za-z0-9._-]+\.(?:js|css)$/.test(name)
    || (app.fonts && /^assets\/[A-Za-z0-9._-]+\.woff2$/.test(name));

/** Read-only ownership/empty-bootstrap check, before any app build is run. */
export function validateSharedAppDestination(target, name) {
  const app = identity(name);
  return validateManagedDestination(target, {
    label: name, app: name, site: app.site, source: app.source,
    required: { files: ['index.html', '.nojekyll', 'shared-build.json'], sourceFiles: ['Makefile', 'package.json', helperName, checkerName] },
  });
}

/** Copy the approved source of one shared app into `destination` with placeholder settings and its helpers. */
export function snapshotSharedApp(name, origin, destination) {
  const app = identity(name);
  copySnapshot(origin, destination, { label: name, files: [...commonFiles, ...app.files], folders: app.folders, allowed: allowedFor(app) });
  const makefile = join(destination, 'Makefile');
  appendMakeTarget(makefile, prepareTarget);
  appendMakeTarget(makefile, checkSite(name));
  // Examples are placeholders, even if the development copy was locally filled in.
  writeFileSync(join(destination, '.env.example'), placeholderEnvironment());
  shipHelper(file, destination);
  cpSync(join(dirname(file), 'check-shared-build.mjs'), join(destination, checkerName));
  cpSync(join(dirname(file), 'catalog.mjs'), join(destination, 'scripts/catalog.mjs'));
}

function publicSettings(origin, stagedSource, name) {
  const settings = resolveSettings(origin);
  if (!settings.VITE_SUPABASE_URL || !settings.VITE_SUPABASE_ANON_KEY) throw new Error('Set public Supabase URL and anon/publishable key before preparing ' + name + '.');
  if (Object.values(settings).some(value => /\$\{?\w/.test(value))) throw new Error('Set literal public Supabase settings in the build environment before preparing ' + name + '.');
  // Use the app's own public-config policy without printing settings or errors
  // from a subprocess that may carry its environment in diagnostic properties.
  const validator = pathToFileURL(join(stagedSource, 'build-config.ts')).href;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `import { validatePublicConfig } from ${JSON.stringify(validator)}; validatePublicConfig(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);`],
      { stdio: 'pipe', env: { ...process.env, ...settings } });
  } catch { throw new Error(name + ' requires a valid Supabase URL and public anon/publishable key; private settings are rejected.'); }
  return settings;
}

function specFor(name) {
  const app = identity(name);
  return {
    app: name, label: name, file, site: app.site, source: app.source, allowed: allowedFor(app),
    validate: target => validateSharedAppDestination(target, name),
    snapshot: (origin, destination) => snapshotSharedApp(name, origin, destination),
    version: source => readAppVersion(source, app.packageName || name),
    environment: (origin, stagedSource) => ({ ...process.env, ...publicSettings(origin, stagedSource, name), PATH: toolPath(), VITE_BASE_PATH: './' }),
    report(stagedSite, { version, env }) {
      writeSharedBuildReport(stagedSite, { app: name, version, url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_ANON_KEY });
      checkSharedBuild(stagedSite, name);
    },
  };
}

/** Stage, check, build and replace only one owned static app; no publication. */
export function prepareSharedApp(name, origin, target, run = execFileSync, options) {
  return prepareManagedApp(specFor(name), origin, target, run, options);
}


if (process.argv[1] && stat(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(file)) {
  try {
    if (isShipped(file)) {
      const origin = resolve(dirname(file), '..');
      const packageName = JSON.parse(readFileSync(join(origin, 'package.json'), 'utf8')).name;
      const name = SHARED_APPS.find(app => (app.packageName || app.id) === packageName)?.id;
      if (!process.argv[2]) throw new Error('Pass the existing shared Sites checkout.');
      prepareSharedApp(name, origin, resolve(process.argv[2]));
    } else {
      if (!process.argv[2] || !process.argv[3]) throw new Error('Pass an app name and the existing shared Sites checkout.');
      const name = process.argv[2];
      prepareSharedApp(name, resolve(process.argv[4] || join(dirname(file), '../apps', name)), resolve(process.argv[3]));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
