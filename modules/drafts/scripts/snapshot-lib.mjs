// Shared helpers of the website preparation modules. Dependency-free:
// every public source snapshot ships a copy of this file beside its
// helper as scripts/snapshot-lib.mjs, so it may only import Node.js built-ins.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';
import { homedir } from 'node:os';

export const manifestName = 'publish-manifest.json';
export const libraryName = 'snapshot-lib.mjs';
export const helperName = 'scripts/prepare-shared.mjs';
export const settingKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

/* Runtime and location guards */

/** Fail before any file work unless Node.js 24+ runs; `task` names what needs it. */
export function requireNode24(task) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error(task + ' requires Node.js 24 or newer.');
}

/** True for the copy of a helper that a public source snapshot ships under scripts/. */
export const isShipped = file => /\/scripts\/prepare-(?:shared|site)\.mjs$/.test(file);

/** True when `child` is `parent` or lies inside it. */
export function within(parent, child) {
  const path = relative(parent, child);
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}

/** The Sites checkout must not be, or sit inside, the development repository (the parent of websites/). */
export function assertOutsideRepository(file, target, repository = resolve(dirname(file), '..')) {
  if (isShipped(file)) return;
  if (within(realpathSync(repository), existsSync(target) ? realpathSync(target) : resolve(target))) {
    throw new Error('Choose a separate Sites checkout outside the development repository.');
  }
}

/** The Sites checkout must not be, or sit inside, the application being prepared. */
export function assertOutsideApp(app, target) {
  if (within(app, target)) throw new Error('Choose a checkout outside the application source.');
}

/** PATH that puts the running Node.js first, so Make and npm use the same runtime. */
export const toolPath = () => dirname(process.execPath) + delimiter + (process.env.PATH || '');

/* File safety */

export function stat(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

/** True for an existing regular file or folder; false when absent; throws for links and other types. */
export function regular(path, kind) {
  const info = stat(path);
  if (!info) return false;
  if (info.isSymbolicLink()) throw new Error('Refusing a symbolic-link publishing path: ' + path);
  if (!(kind === 'directory' ? info.isDirectory() : info.isFile())) throw new Error('Unexpected publishing path: ' + path);
  return true;
}

export const digest = body => createHash('sha256').update(body).digest('hex');

/** SHA-256 map of every file below `dir`, keyed by its path relative to `base`; links and special files throw. */
export function collect(dir, base = dir, files = Object.create(null)) {
  if (!regular(dir, 'directory')) return files;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = stat(path);
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not published: ' + path);
    if (info.isDirectory()) collect(path, base, files);
    else if (info.isFile()) files[relative(base, path).replaceAll('\\', '/')] = digest(readFileSync(path));
    else throw new Error('Only regular files are published: ' + path);
  }
  return files;
}

export function hashMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([name, hash]) => name && !isAbsolute(name) && !name.includes('\\')
      && name.split('/').every(part => part && part !== '.' && part !== '..') && /^[a-f0-9]{64}$/.test(hash));
}

export function matches(actual, expected) {
  const names = Object.keys(actual).sort();
  return JSON.stringify(names) === JSON.stringify(Object.keys(expected).sort()) && names.every(name => actual[name] === expected[name]);
}

function ownedDirectories(dir, expected, label, base = dir) {
  if (!stat(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!stat(path).isDirectory()) continue;
    const prefix = relative(base, path).replaceAll('\\', '/') + '/';
    if (!Object.keys(expected).some(file => file.startsWith(prefix))) throw new Error('Unowned ' + label + ' directory: ' + path);
    ownedDirectories(path, expected, label, base);
  }
}

/* Approved public files */

const excludedFolders = ['.git', '.github', 'node_modules', 'dist', 'build', 'coverage', 'artifacts', 'output', 'recordings', 'test-results', 'playwright-report'];

/** False for names that never belong in a public snapshot: tooling folders, guides, private settings and keys. */
export function approved(name) {
  const parts = name.replaceAll('\\', '/').split('/');
  return parts.every(part => !excludedFolders.includes(part.toLowerCase())
    && !/^(?:readme|agents)(?:\..*)?$/i.test(part)
    && !/^(?:deployment|publishing|websites)(?:\..*)?$/i.test(part)
    && !(/^\.env/i.test(part) && name !== '.env.example')
    && !/(?:^|[._-])(?:secrets?|credentials?)(?:[._-]|$)/i.test(part)
    && !/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|log|dmg|zip)$/i.test(part));
}

/** Drop excluded names and throw for any other file `allowed(kind, name)` does not list. */
export function approvedFiles(names, kind, label, allowed) {
  return names.filter(name => {
    if (!approved(name)) return false;
    if (!allowed(kind, name)) throw new Error('Unapproved ' + label + ' ' + kind + ' file: ' + name);
    return true;
  });
}

export function copyFiles(origin, destination, names) {
  for (const name of names) {
    mkdirSync(dirname(join(destination, name)), { recursive: true });
    cpSync(join(origin, name), join(destination, name));
  }
}

/** Copy an app's explicit file list and approved folders into a staged source folder. */
export function copySnapshot(origin, destination, { label, files, folders, allowed }) {
  mkdirSync(destination, { recursive: true });
  for (const name of files) {
    // Reject linked parents too, especially a linked supabase folder.
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) regular(join(origin, ...parts.slice(0, index)), 'directory');
    if (!regular(join(origin, name), 'file')) throw new Error('Missing approved ' + label + ' source file: ' + name);
    copyFiles(origin, destination, [name]);
  }
  for (const name of folders) {
    if (!regular(join(origin, name), 'directory')) throw new Error('Missing approved ' + label + ' source folder: ' + name);
    copyFiles(origin, destination, approvedFiles(Object.keys(collect(join(origin, name), origin)), name, label, allowed));
  }
}

/** Public examples hold placeholders, even when the development copy was filled in locally. */
export function placeholderEnvironment(extra = '') {
  return 'VITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_ANON_KEY=sb_publishable_your_public_key\n' + extra;
}

/** Point a snapshot Makefile's PUBLISH_SCRIPT at the helper shipped beside it. */
export function retargetPublishScript(makefile) {
  writeFileSync(makefile, readFileSync(makefile, 'utf8').replace(/^PUBLISH_SCRIPT\s*\?=\s*\S*websites\/[\w.-]+\.mjs\s*$/m, 'PUBLISH_SCRIPT ?= ' + helperName));
}

/** Append a publishing-owned Make target to a snapshot Makefile, once. */
export function appendMakeTarget(makefile, block) {
  const source = readFileSync(makefile, 'utf8');
  if (!source.includes(block)) writeFileSync(makefile, source + block);
}

/** Copy the running helper and this library into a staged snapshot, as `name` and scripts/snapshot-lib.mjs. */
export function shipHelper(file, destination, name = helperName) {
  const path = join(destination, name);
  mkdirSync(dirname(path), { recursive: true });
  cpSync(file, path);
  cpSync(join(dirname(file), libraryName), join(dirname(path), libraryName));
}

/* Public settings and versions */

function fileSettings(directory) {
  const values = Object.create(null);
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const path = join(directory, name);
    if (regular(path, 'file')) Object.assign(values, parseEnv(readFileSync(path, 'utf8')));
  }
  return values;
}

/** Process environment, then app-local files, then shared defaults; an explicitly empty process value stays authoritative. */
export function resolveSettings(origin, sharedDirectory = resolve(origin, '../../websites')) {
  const shared = fileSettings(sharedDirectory);
  const local = fileSettings(origin);
  const settings = Object.create(null);
  for (const key of settingKeys) {
    const inherited = process.env[key];
    const appValue = typeof inherited === 'string' ? inherited : local[key];
    const sharedValue = typeof inherited === 'string' ? inherited : shared[key];
    settings[key] = appValue?.trim() || sharedValue?.trim() || '';
  }
  return settings;
}

/** The package version, which must match the lockfile root and the package name. */
export function readAppVersion(directory, name) {
  const info = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
  const { version } = info;
  if (info.name !== name || typeof version !== 'string' || !version || lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('The ' + name + ' package and lockfile versions must match.');
  }
  return version;
}

/* Ownership of the previous output */

/**
 * Read-only check of one app's output and source folders in the Sites checkout, before any build.
 * `spec`: label, app, site, source, required { files, sourceFiles }, bootstrap (an empty destination may
 * be adopted) and legacy (an unversioned manifest, written before source hashes existed, verifies
 * only the site output).
 */
export function validateManagedDestination(target, spec) {
  const { label, app, site: siteName, source: sourceName, bootstrap = true, legacy = false } = spec;
  const { files: requiredFiles = [], sourceFiles: requiredSourceFiles = [] } = spec.required ?? {};
  if (!regular(target, 'directory')) throw new Error('Choose the existing shared Sites checkout.');
  target = realpathSync(target);
  for (const name of ['site', 'modules']) regular(join(target, name), 'directory');
  const git = stat(join(target, '.git'));
  if (!git || git.isSymbolicLink() || !(git.isDirectory() || git.isFile()) || !regular(join(target, 'site/index.html'), 'file')) {
    throw new Error('Choose the existing shared Sites checkout.');
  }
  const site = join(target, siteName);
  const source = join(target, sourceName);
  const siteFiles = collect(site);
  const sourceFiles = collect(source);
  const marker = join(source, manifestName);
  if (!stat(marker)) {
    if (!bootstrap) throw new Error('Missing ' + label + ' ownership manifest.');
    if ((stat(site) && readdirSync(site).length) || (stat(source) && readdirSync(source).length)) throw new Error('Missing ' + label + ' ownership manifest; refusing unowned contents.');
    return target;
  }
  const invalid = () => new Error('Invalid ' + label + ' ownership manifest.');
  let manifest;
  try { manifest = JSON.parse(readFileSync(marker, 'utf8')); }
  catch { throw invalid(); }
  if (manifest?.app !== app || manifest.site !== siteName) throw invalid();
  const owned = manifest.format !== undefined || !legacy;
  if (owned) {
    if (manifest.format !== 1 || manifest.source !== sourceName || typeof manifest.version !== 'string' || !manifest.version
      || !hashMap(manifest.files) || !hashMap(manifest.sourceFiles)
      || requiredFiles.some(name => !manifest.files[name]) || requiredSourceFiles.some(name => !manifest.sourceFiles[name])
      || manifest.sourceFiles[manifestName]) throw invalid();
  } else if (manifest.files !== undefined && !hashMap(manifest.files)) throw invalid();
  const files = manifest.files ?? {};
  delete sourceFiles[manifestName];
  if (!matches(siteFiles, files) || (owned && !matches(sourceFiles, manifest.sourceFiles))) {
    throw new Error('Unowned or modified ' + label + ' files; preserve those changes before preparing again.');
  }
  ownedDirectories(site, files, label);
  if (owned) ownedDirectories(source, manifest.sourceFiles, label);
  return target;
}

/* Staged, rollback-safe replacement */

/** Thrown when a failed replacement could not be undone; the stage then keeps the previous files. */
export class RestoreFailure extends Error {}

const stageOwner = '.stage-owner';

// A killed run (Ctrl+C, SIGKILL) cannot clean up. The next run removes such stages once the
// process recorded in their owner file no longer exists; stages without that file are never touched.
function removeAbandonedStages(parent, prefix) {
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(prefix)) continue;
    let pid;
    try { pid = JSON.parse(readFileSync(join(parent, name, stageOwner), 'utf8')).pid; }
    catch { continue; }
    if (!Number.isInteger(pid)) continue;
    try { process.kill(pid, 0); continue; }
    catch (error) { if (error.code !== 'ESRCH') continue; }
    rmSync(join(parent, name), { recursive: true, force: true });
    console.log('Removed an abandoned preparation folder: ' + name);
  }
}

/** Run `action(stage)` in a private folder inside `parent`, removed afterwards unless a rollback failed. */
export function withStage(parent, prefix, action) {
  removeAbandonedStages(parent, prefix);
  const stage = mkdtempSync(join(parent, prefix));
  writeFileSync(join(stage, stageOwner), JSON.stringify({ pid: process.pid }));
  let keep = false;
  try { return action(stage); }
  catch (error) {
    keep = error instanceof RestoreFailure;
    if (keep) rmSync(join(stage, stageOwner), { force: true });
    throw error;
  } finally { if (!keep) rmSync(stage, { recursive: true, force: true }); }
}

/** Move each staged file or folder into place, keeping the previous one in `stage`; undo all on any failure. */
export function replacePaths(pairs, stage, label) {
  const done = [];
  try {
    for (const [staged, destination] of pairs) {
      mkdirSync(dirname(destination), { recursive: true });
      const entry = { destination, backup: undefined, installed: false };
      done.push(entry);
      if (stat(destination)) { entry.backup = join(stage, 'previous-' + done.length); renameSync(destination, entry.backup); }
      renameSync(staged, destination);
      entry.installed = true;
    }
  } catch (error) {
    try {
      for (const entry of done.reverse()) {
        if (entry.installed) rmSync(entry.destination, { recursive: true, force: true });
        if (entry.backup) renameSync(entry.backup, entry.destination);
      }
    } catch { throw new RestoreFailure('Could not restore previous ' + label + ' files. Preserved backups in ' + stage, { cause: error }); }
    throw error;
  }
}

const dependencyCopy = { recursive: true, verbatimSymlinks: true };

/** Clone dependency files on APFS so staging a large cache copies metadata, not file contents. */
function copyDependencies(source, destination) {
  if (process.platform === 'darwin') {
    try {
      execFileSync('/bin/cp', ['-cR', source, destination], { stdio: 'ignore' });
      return;
    } catch {
      rmSync(destination, { recursive: true, force: true });
    }
  }
  cpSync(source, destination, dependencyCopy);
}

/** Keep installations local to the source app; source snapshots and output never read this folder. */
function dependencyCache(origin, stagedSource, env) {
  if (env.WEBSITE_DEPENDENCY_CACHE === '0' || stat(join(origin, manifestName))) return undefined;
  const npmOptions = Object.entries(env).filter(([name]) => /^npm_config_/i.test(name)).sort();
  const option = name => npmOptions.find(([key]) => key.toLowerCase() === 'npm_config_' + name)?.[1];
  const configFiles = [option('userconfig') || join(env.HOME || homedir(), '.npmrc'),
    option('globalconfig') || resolve(dirname(process.execPath), '../etc/npmrc')];
  const key = digest(JSON.stringify({
    config: configFiles.map(file => existsSync(file) ? digest(readFileSync(file)) : null),
    node: process.version, platform: process.platform, arch: process.arch,
    manifest: readFileSync(join(stagedSource, 'package.json'), 'utf8'),
    lock: readFileSync(join(stagedSource, 'package-lock.json'), 'utf8'),
    npm: npmOptions, nodeEnvironment: env.NODE_ENV || '',
  }));
  const parent = join(origin, '.website-cache');
  if (!regular(parent, 'directory')) mkdirSync(parent);
  const root = join(parent, 'dependencies');
  if (!regular(root, 'directory')) mkdirSync(root);
  const entry = join(root, key);
  if (regular(entry, 'directory') && regular(join(entry, 'complete'), 'file')
      && regular(join(entry, 'node_modules'), 'directory')
      && regular(join(entry, 'node_modules/.package-lock.json'), 'file')) return { root, entry, ready: true };
  return { root, entry, ready: false };
}

/** Check and build fresh staged source, reusing only an exact-key dependency installation. */
export function buildStagedApp({ run, preview, origin, stagedSource, stage, env, label }) {
  const buildApp = preview ? origin : join(stage, 'build-app');
  if (!preview) cpSync(stagedSource, buildApp, { recursive: true });
  const cache = preview ? undefined : dependencyCache(origin, stagedSource, env);
  const cacheStarted = Date.now();
  if (cache?.ready) {
    copyDependencies(join(cache.entry, 'node_modules'), join(buildApp, 'node_modules'));
    console.log('Reusing cached dependencies for ' + label + ' (' + ((Date.now() - cacheStarted) / 1000).toFixed(1) + 's to stage).');
  }
  const started = Date.now();
  run('make', ['-C', buildApp, ...(preview ? ['build'] : ['check', 'build']), 'NODE=' + process.execPath], { stdio: 'inherit', env });
  const dist = join(buildApp, 'dist');
  if (!regular(join(dist, 'index.html'), 'file')) throw new Error('The ' + label + ' build did not produce dist/index.html.');
  if (cache && !cache.ready && !stat(cache.entry) && regular(join(buildApp, 'node_modules/.package-lock.json'), 'file')) {
    const pending = mkdtempSync(join(cache.root, '.pending-'));
    try {
      const cacheStarted = Date.now();
      try { renameSync(join(buildApp, 'node_modules'), join(pending, 'node_modules')); }
      catch (error) {
        if (error.code !== 'EXDEV') throw error;
        copyDependencies(join(buildApp, 'node_modules'), join(pending, 'node_modules'));
      }
      writeFileSync(join(pending, 'complete'), '1\n');
      try { renameSync(pending, cache.entry); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
      console.log('Saved dependency cache for ' + label + ' (' + ((Date.now() - cacheStarted) / 1000).toFixed(1) + 's).');
    } finally { rmSync(pending, { recursive: true, force: true }); }
  }
  console.log(label + ' checks/build: ' + ((Date.now() - started) / 1000).toFixed(1) + 's.');
  return dist;
}

/**
 * Stage, build, verify and atomically replace one managed app's website and source snapshot.
 * `spec` supplies what differs per app: app, label, site, source, file (the calling helper),
 * validate(target), snapshot(origin, stagedSource), version(stagedSource), environment(origin, stagedSource),
 * allowed(kind, name) for built files, and the optional check(dist) and report(stagedSite, { version, env }).
 */
export function prepareManagedApp(spec, origin, target, run, { preview = false } = {}) {
  const { app: name, label, site: siteName, source: sourceName } = spec;
  requireNode24(label + ' preparation');
  if (!regular(origin, 'directory')) throw new Error('Choose the ' + label + ' application source.');
  origin = realpathSync(origin);
  assertOutsideRepository(spec.file, target);
  target = spec.validate(target);
  assertOutsideApp(origin, target);
  return withStage(target, '.' + name + '-prepare-', stage => {
    const stagedSite = join(stage, 'site');
    const stagedSource = join(stage, 'source');
    spec.snapshot(origin, stagedSource);
    const version = spec.version(stagedSource);
    const env = spec.environment(origin, stagedSource);
    const dist = buildStagedApp({ run, preview, origin, stagedSource, stage, env, label });
    spec.check?.(dist);
    mkdirSync(stagedSite);
    copyFiles(dist, stagedSite, approvedFiles(Object.keys(collect(dist)), 'build', label, spec.allowed));
    writeFileSync(join(stagedSite, '.nojekyll'), '');
    spec.report?.(stagedSite, { version, env });
    const manifest = { format: 1, app: name, version, site: siteName, source: sourceName, files: collect(stagedSite), sourceFiles: collect(stagedSource) };
    writeFileSync(join(stagedSource, manifestName), JSON.stringify(manifest, null, 2) + '\n');
    // Detect edits or links introduced while Make was running before replacing anything.
    spec.validate(target);
    replacePaths([[stagedSite, join(target, siteName)], [stagedSource, join(target, sourceName)]], stage, label);
    console.log('Prepared ' + label + ' website and source snapshot.');
    return manifest;
  });
}
