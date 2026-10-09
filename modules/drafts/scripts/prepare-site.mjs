import { cpSync, existsSync, mkdirSync, realpathSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const file = fileURLToPath(import.meta.url);

export function prepareDrafts(target) {
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
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'styles.css', 'assets']) cpSync(join(input, name), join(output, name), { recursive: true });
  writeFileSync(join(output, '.nojekyll'), '');
  // Preserve published Mac/Chrome metadata; a source build is not a new release.
  writeFileSync(marker, JSON.stringify({ ...manifest, files: collect(output, output) }, null, 2) + '\n');
  if (file !== join(module, 'scripts/prepare-site.mjs')) {
    mkdirSync(join(module, 'scripts'), { recursive: true });
    cpSync(file, join(module, 'scripts/prepare-site.mjs'));
  }
  console.log('Prepared Drafts website.');
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(file)) {
  const target = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(file), '../../..');
  try { prepareDrafts(target); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
