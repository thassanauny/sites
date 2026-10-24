import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  appendMakeTarget, copySnapshot, helperName, isShipped, placeholderEnvironment, prepareManagedApp, prepareManagedAppAsync, readAppVersion,
  resolveSettings, retargetPublishScript, shipHelper, stat, toolPath, validateManagedDestination,
} from './snapshot-lib.mjs';

const file = fileURLToPath(import.meta.url);
const { checkCloudBuild } = await import(isShipped(file) ? './check-cloud-build.mjs' : '../apps/iou/scripts/check-cloud-build.mjs');
const label = 'iou';
const filesToCopy = ['Makefile', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts', 'biome.json', '.env.example', 'supabase/schema.sql', 'supabase/update-live-sync.sql', 'supabase/postgres-check.mjs', 'scripts/check-cloud-build.mjs', 'scripts/publishing.test.mjs'];
const publicAssets = new Set(['icons/favicon-1e1757b61e5d.png', 'logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']);
const baseExample = '\n# Optional: /repository-name/ for a GitHub project site, / for a custom domain.\n# Leaving this empty uses relative asset URLs for local previews.\nVITE_BASE_PATH=\n';
// The Sites workflow runs this target; it only reads the prepared website.
const checkSite = '\n.PHONY: check-site\ncheck-site: node-check\n\t@test -n "$(SITE)" || { printf \'%s\\n\' \'Set SITE to the prepared website folder.\' >&2; exit 1; }\n\t"$(NODE)" scripts/check-cloud-build.mjs "$(SITE)"\n';

const allowed = (kind, name) => kind === 'src' ? /^src\/.+\.(?:ts|tsx|css)$/.test(name)
  : kind === 'public' ? publicAssets.has(name.slice('public/'.length))
  : ['index.html', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'cloud-build.json'].includes(name) || publicAssets.has(name)
    || /^workbox-[A-Za-z0-9_-]+\.js$/.test(name) || /^assets\/[A-Za-z0-9._-]+\.(?:js|css)$/.test(name);

/** Read-only bootstrap/ownership check, suitable before preparing any other app. */
export function validateIouDestination(target) {
  return validateManagedDestination(target, {
    label, app: 'iou', site: 'site/iou', source: 'modules/iou',
    required: { files: ['index.html', '.nojekyll'], sourceFiles: ['Makefile', 'package.json', helperName] },
  });
}

/** Copy the approved iou source into `destination` with placeholder settings and its standalone helper. */
export function snapshotIou(origin, destination) {
  copySnapshot(origin, destination, { label, files: filesToCopy, folders: ['src', 'public'], allowed });
  writeFileSync(join(destination, '.env.example'), placeholderEnvironment(baseExample));
  retargetPublishScript(join(destination, 'Makefile'));
  appendMakeTarget(join(destination, 'Makefile'), checkSite);
  shipHelper(file, destination);
}

const spec = {
  app: 'iou', label, file, site: 'site/iou', source: 'modules/iou', allowed,
  validate: validateIouDestination,
  snapshot: snapshotIou,
  version: source => readAppVersion(source, 'iou'),
  // The clean build copy sees no environment files, so resolve public settings here; a missing value
  // is left for the app's own build error.
  environment: origin => ({
    ...process.env,
    ...Object.fromEntries(Object.entries(resolveSettings(origin)).filter(([, value]) => value)),
    PATH: toolPath(), VITE_BASE_PATH: './',
  }),
  check: checkCloudBuild,
};

/** Builds and prepares only iou; never pushes, deploys, or changes the catalog. */
export const prepareIou = (app, target, run = execFileSync, options) => prepareManagedApp(spec, app, target, run, options);
/** Like prepareIou, but awaits `run` so other apps can prepare meanwhile. */
export const prepareIouAsync = (app, target, run, options) => prepareManagedAppAsync(spec, app, target, run, options);

if (process.argv[1] && stat(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(file)) {
  if (!process.argv[2]) { console.error('Use make -C websites publish from the development repository root.'); process.exitCode = 1; }
  else {
    const defaultApp = isShipped(file) ? join(dirname(file), '..') : join(dirname(file), '../apps/iou');
    try { prepareIou(resolve(process.argv[3] || defaultApp), resolve(process.argv[2])); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
