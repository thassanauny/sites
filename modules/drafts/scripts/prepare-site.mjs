import { cpSync, existsSync, mkdirSync, realpathSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const file = fileURLToPath(import.meta.url);

const versionPattern = /^\d+\.\d+\.\d+$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function validateRelease(release) {
  if (!versionPattern.test(release.version) || !versionPattern.test(release.chrome?.version) || !versionPattern.test(release.mac?.version)) throw new Error('Drafts release versions must be major.minor.patch.');
  const { mac, chrome } = release;
  const store = new URL(chrome.url);
  if (store.protocol !== 'https:' || store.hostname !== 'chromewebstore.google.com' || !store.pathname.startsWith('/detail/drafts/')) throw new Error('Invalid Drafts Chrome Web Store URL.');
  if (!['aarch64', 'x64'].includes(mac.architecture) || !/^[a-f0-9]{64}$/.test(mac.sha256)) throw new Error('Drafts Mac release requires an architecture and verified SHA-256 checksum.');
  const installer = `drafts_${mac.version}_${mac.architecture}.dmg`;
  const url = new URL(mac.url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.endsWith(`/releases/download/drafts-v${mac.version}/${installer}`) || url.search || url.hash || mac.checksumUrl !== mac.url + '.sha256') throw new Error('Drafts Mac release URLs must match its version and architecture.');
}

// A verified manifest for this version takes precedence over a local rebuild:
// signed DMGs can differ even when their app version is identical.
export function releaseForApp(app, target) {
  const manifest = JSON.parse(readFileSync(join(target, 'modules/drafts/publish-manifest.json'), 'utf8'));
  const version = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;
  const extension = JSON.parse(readFileSync(join(app, 'extension/manifest.json'), 'utf8')).version;
  const native = readFileSync(join(app, 'native/Info.plist'), 'utf8').match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  if (!versionPattern.test(version) || extension !== version || native !== version) throw new Error('Drafts package, Chrome and native app versions must match before preparing its website.');
  validateRelease(manifest);
  let mac = manifest.mac;
  if (mac.version !== version) {
    const filename = `drafts_${version}_${mac.architecture}.dmg`;
    const installer = join(app, 'build', filename);
    if (!existsSync(installer) || !existsSync(installer + '.sha256')) throw new Error(`Build the Drafts ${version} Mac installer and checksum first, or record verified public release metadata in the Sites manifest.`);
    const checksum = readFileSync(installer + '.sha256', 'utf8').trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    const hash = sha256(readFileSync(installer));
    if (!checksum || checksum[1] !== hash || checksum[2] !== filename) throw new Error('Drafts Mac installer checksum does not match its package.');
    const url = mac.url.slice(0, mac.url.lastIndexOf('/releases/download/')) + `/releases/download/drafts-v${version}/${filename}`;
    mac = { ...mac, version, url, checksumUrl: url + '.sha256', sha256: hash };
  }
  return { ...manifest, version, chrome: { ...manifest.chrome, version }, mac };
}

function renderRelease(html, release) {
  validateRelease(release);
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const replace = (pattern, value, label) => {
    if ([...html.matchAll(pattern)].length !== 1) throw new Error('Missing or ambiguous Drafts website release field: ' + label);
    html = html.replace(pattern, (_, before, after) => before + value + after);
  };
  replace(/(<a class="download" href=")[^"]+(">)/g, escape(release.chrome.url), 'Chrome download');
  replace(/(<a href=")[^"]+(">Drafts in the Chrome Web Store<\/a>)/g, escape(release.chrome.url), 'Chrome installation');
  replace(/(<p class="download-meta">Version )[\d.]+( <span[^>]*>·<\/span> Free)/g, release.chrome.version, 'Chrome version');
  replace(/(<a class="download download-secondary" href=")[^"]+(">)/g, escape(release.mac.url), 'Mac download');
  replace(/(<p class="download-meta">Version )[\d.]+( <span[^>]*>·<\/span> (?:Apple silicon|Intel))/g, release.mac.version, 'Mac version');
  const architecture = release.mac.architecture === 'aarch64' ? 'Apple silicon' : 'Intel';
  replace(/(<p class="download-meta">Version [\d.]+ <span[^>]*>·<\/span> )(?:Apple silicon|Intel)( <span)/g, architecture, 'Mac architecture');
  html = html.replace(/This download is for (?:Apple silicon Macs \(M1 and later\)|Intel Macs)\./g, `This download is for ${architecture === 'Intel' ? 'Intel Macs' : 'Apple silicon Macs (M1 and later)'}.`);
  replace(/(<a href=")[^"]+(">SHA-256 checksum<\/a>)/g, escape(release.mac.checksumUrl), 'Mac checksum');
  replace(/(Version )[\d.]+( is locally signed)/g, release.mac.version, 'Mac preview');
  replace(/(<span class="footer-version">Drafts · )[\d.]+(<\/span>)/g, release.version, 'footer version');
  return html;
}

export function prepareDrafts(target, release) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Drafts preparation requires Node.js 24 or newer.');
  target = realpathSync(target);
  const module = join(target, 'modules/drafts');
  const input = join(module, 'site');
  const output = join(target, 'site/drafts');
  const marker = join(module, 'publish-manifest.json');
  if (!existsSync(join(target, '.git')) || !existsSync(join(target, 'site/index.html'))) throw new Error('Choose the existing shared Sites checkout.');
  const manifest = JSON.parse(readFileSync(marker, 'utf8'));
  if (manifest.app !== 'drafts' || manifest.site !== 'site/drafts') throw new Error('Invalid Drafts ownership manifest.');
  for (const path of [join(target, "site"), join(target, "modules"), module, input, join(module, "scripts"), output]) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Refusing a symbolic-link Drafts folder.');
  for (const name of ['index.html', 'styles.css', 'assets']) if (!existsSync(join(input, name))) throw new Error('Missing Drafts website input: ' + name);
  const collect = (dir, base, files = {}) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not published: ' + path);
      if (stat.isDirectory()) collect(path, base, files);
      else files[relative(base, path).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
    return files;
  };
  collect(input, input); // Reject source links before replacing generated output.
  const metadata = { ...manifest, ...release };
  const html = renderRelease(readFileSync(join(input, 'index.html'), 'utf8'), metadata);
  writeFileSync(join(input, 'index.html'), html);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'styles.css', 'assets']) cpSync(join(input, name), join(output, name), { recursive: true });
  writeFileSync(join(output, '.nojekyll'), '');
  writeFileSync(marker, JSON.stringify({ ...metadata, files: collect(output, output) }, null, 2) + '\n');
  if (file !== join(module, 'scripts/prepare-site.mjs')) {
    mkdirSync(join(module, 'scripts'), { recursive: true });
    cpSync(file, join(module, 'scripts/prepare-site.mjs'));
  }
  console.log(`Prepared Drafts ${metadata.version} (Chrome ${metadata.chrome.version}, Mac ${metadata.mac.version}) in ${output}.`);
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(file)) {
  const target = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(file), '../../..');
  try { prepareDrafts(target, process.argv[3] ? releaseForApp(resolve(process.argv[3]), target) : undefined); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
