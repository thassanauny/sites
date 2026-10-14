import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOutsideRepository, collect, isShipped, manifestName, replacePaths, requireNode24, shipHelper, stat,
  validateManagedDestination, withStage,
} from './snapshot-lib.mjs';

const file = fileURLToPath(import.meta.url);
const label = 'Drafts';
const siteName = 'site/drafts';
const sourceName = 'modules/drafts';
const scriptName = 'scripts/prepare-site.mjs';
const pages = ['index.html', 'styles.css', 'assets'];

const versionPattern = /^\d+\.\d+\.\d+$/;
function validateRelease(release) {
  if (!versionPattern.test(release.version) || !versionPattern.test(release.chrome?.version)) throw new Error('Drafts release versions must be major.minor.patch.');
  let store;
  try { store = new URL(release.chrome.url); }
  catch { throw new Error('Invalid Drafts Chrome Web Store URL.'); }
  if (store.protocol !== 'https:' || store.hostname !== 'chromewebstore.google.com' || !/^\/detail\/drafts\/[a-p]{32}$/.test(store.pathname) || store.port || store.username || store.password || store.search || store.hash) throw new Error('Invalid Drafts Chrome Web Store URL.');
}

/** The release the website advertises: the package version, which must match the extension and the native app. */
export function releaseForApp(app, target, releaseFile) {
  const manifest = JSON.parse(readFileSync(releaseFile ?? join(target, sourceName, manifestName), 'utf8'));
  const version = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;
  const extension = JSON.parse(readFileSync(join(app, 'extension/manifest.json'), 'utf8')).version;
  const native = readFileSync(join(app, 'native/Info.plist'), 'utf8').match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
  if (!versionPattern.test(version) || extension !== version || native !== version) throw new Error('Drafts package, Chrome extension and native app versions must match before preparing its website.');
  validateRelease(manifest);
  return { version, chrome: { version, url: manifest.chrome.url } };
}

/** A notice when the website advertises a version the recorded Chrome Web Store release does not match. */
export function storeLagNotice(app, releaseFile) {
  const recorded = JSON.parse(readFileSync(releaseFile, 'utf8'));
  const { version } = releaseForApp(app, undefined, releaseFile);
  if (recorded.chrome.version === version) return undefined;
  return `Notice: the Drafts website now advertises ${version}, but releases/drafts.json records Chrome Web Store release ${recorded.chrome.version}. `
    + `Confirm that ${version} is live in the store before running Publish websites, then record it in releases/drafts.json.`;
}

function renderRelease(html, release) {
  validateRelease(release);
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const replace = (pattern, value, field) => {
    if ([...html.matchAll(pattern)].length !== 1) throw new Error('Missing or ambiguous Drafts website release field: ' + field);
    html = html.replace(pattern, (_, before, after) => before + value + after);
  };
  replace(/(<a class="download" href=")[^"]+(">)/g, escape(release.chrome.url), 'Chrome download');
  replace(/(<a href=")[^"]+(">Drafts in the Chrome Web Store<\/a>)/g, escape(release.chrome.url), 'Chrome installation');
  replace(/(<p class="download-meta">Version )[\d.]+( <span[^>]*>·<\/span> Free)/g, release.chrome.version, 'Chrome version');
  replace(/(<span class="footer-version">Drafts · )[\d.]+(<\/span>)/g, release.version, 'footer version');
  return html;
}

/** Validate the complete website source and render release fields without writing. */
export function validateDraftsSources(input, release) {
  for (const path of [input, dirname(input)]) if (stat(path)?.isSymbolicLink()) throw new Error('Refusing a symbolic-link Drafts folder.');
  for (const [name, kind] of [['index.html', 'file'], ['styles.css', 'file'], ['assets', 'directory']]) {
    const entry = stat(join(input, name));
    if (!entry) throw new Error('Missing Drafts website input: ' + name);
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not published: ' + join(input, name));
    if (!(kind === 'file' ? entry.isFile() : entry.isDirectory())) throw new Error('Invalid Drafts website input: ' + name);
  }
  collect(input);
  return renderRelease(readFileSync(join(input, 'index.html'), 'utf8'), release);
}

/** Read-only ownership check; the first run after an upgrade also accepts a manifest without source hashes. */
export function validateDraftsDestination(target) {
  return validateManagedDestination(target, {
    label, app: 'drafts', site: siteName, source: sourceName, bootstrap: false, legacy: true,
    required: { files: ['index.html', '.nojekyll'], sourceFiles: ['site/index.html', scriptName] },
  });
}

/** Render the website from `website` (or the module's own copy) and replace the page, its source and the manifest together. */
export function prepareDrafts(target, release, website) {
  requireNode24('Drafts preparation');
  target = realpathSync(target);
  assertOutsideRepository(file, target);
  target = validateDraftsDestination(target);
  const module = join(target, sourceName);
  const output = join(target, siteName);
  const manifest = JSON.parse(readFileSync(join(module, manifestName), 'utf8'));
  for (const path of website ? [website, dirname(website)] : []) if (stat(path)?.isSymbolicLink()) throw new Error('Refusing a symbolic-link Drafts folder.');
  const origin = website ?? join(module, 'site');
  const current = release ?? manifest;
  const metadata = { app: 'drafts', version: current.version, chrome: { version: current.chrome?.version, url: current.chrome?.url }, site: siteName };
  const html = validateDraftsSources(origin, metadata);
  withStage(target, '.drafts-prepare-', stage => {
    const stagedSite = join(stage, 'site');
    const stagedSource = join(stage, 'source');
    const stagedInput = join(stagedSource, 'site');
    mkdirSync(stagedInput, { recursive: true });
    for (const name of pages) cpSync(join(origin, name), join(stagedInput, name), { recursive: true });
    writeFileSync(join(stagedInput, 'index.html'), html);
    mkdirSync(stagedSite);
    for (const name of pages) cpSync(join(stagedInput, name), join(stagedSite, name), { recursive: true });
    writeFileSync(join(stagedSite, '.nojekyll'), '');
    shipHelper(file, stagedSource, scriptName);
    const record = { format: 1, ...metadata, source: sourceName, files: collect(stagedSite), sourceFiles: collect(stagedSource) };
    writeFileSync(join(stagedSource, manifestName), JSON.stringify(record, null, 2) + '\n');
    // Detect edits or links introduced meanwhile before replacing anything.
    validateDraftsDestination(target);
    replacePaths([[stagedSite, output], [stagedSource, module]], stage, label);
  });
  console.log(`Prepared Drafts ${metadata.version} (Chrome ${metadata.chrome.version}) in ${output}.`);
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(file)) {
  try {
    if (isShipped(file)) {
      const target = resolve(process.argv[2] ?? join(dirname(file), '../../..'));
      prepareDrafts(target, process.argv[3] ? releaseForApp(resolve(process.argv[3]), target) : undefined);
    } else {
      if (!process.argv[2]) throw new Error('Use make -C everydayapps/publishing publish-drafts from the development repository root.');
      const target = resolve(process.argv[2]);
      const app = process.argv[3] ? resolve(process.argv[3]) : resolve(dirname(file), '../apps/drafts');
      const releaseFile = join(dirname(file), 'releases/drafts.json');
      prepareDrafts(target, releaseForApp(app, target, releaseFile), join(dirname(file), 'templates/drafts'));
      const notice = storeLagNotice(app, releaseFile);
      if (notice) console.log(notice);
    }
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
