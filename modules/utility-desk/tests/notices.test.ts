import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const notices = read('../public/THIRD_PARTY_NOTICES.md');
const manifest = JSON.parse(read('../package.json')) as { dependencies: Record<string, string> };
const lock = JSON.parse(read('../package-lock.json')) as { packages: Record<string, { version: string; license?: string; dev?: boolean }> };

interface Row {
  name: string;
  version: string;
  license: string;
}
const rows: Row[] = notices
  .split('\n')
  .filter((line) => /^\| [^|]+ \| [^|]+ \| [^|]+ \|$/.test(line) && !/^\| (?:Package|---)/.test(line))
  .map((line) => {
    const [name, version, license] = line.slice(2, -2).split(' | ');
    return { name: name.replace(/\s*\(.*\)$/, ''), version, license };
  });

const installed = Object.entries(lock.packages)
  .filter(([path]) => /(?:^|\/)node_modules\//.test(path))
  .map(([path, entry]) => ({ name: path.replace(/^.*node_modules\//, ''), ...entry }));
const tokens = (license: string) => new Set(license.replace(/[()]/g, '').split(/\s+(?:AND|OR)\s+|\//));

describe('third-party notices', () => {
  it('lists each bundled package once, at the version and license the lockfile installs', () => {
    expect(rows.length).toBeGreaterThan(15);
    expect(new Set(rows.map((row) => `${row.name}@${row.version}`)).size).toBe(rows.length);
    for (const row of rows) {
      const match = installed.find((entry) => entry.name === row.name && entry.version === row.version);
      expect(match, `${row.name} ${row.version} is not in package-lock.json`).toBeDefined();
      expect(match!.dev, `${row.name} is a development dependency, not bundled`).not.toBe(true);
      if (match!.license) expect(tokens(row.license), row.name).toEqual(tokens(match!.license));
    }
  });

  it('covers every direct dependency, so adding or dropping one forces a notices update', () => {
    const listed = new Set(rows.map((row) => row.name));
    for (const name of Object.keys(manifest.dependencies)) expect(listed.has(name), `${name} is missing from THIRD_PARTY_NOTICES.md`).toBe(true);
  });

  it('links only license texts that exist', () => {
    const links = [...notices.matchAll(/\]\((licenses\/[^)#]+)\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(2);
    // Concatenate on purpose: Vite rewrites `new URL(`...${x}`, import.meta.url)` template literals into asset imports.
    // biome-ignore lint/style/useTemplate: see the comment above
    for (const link of links) expect(existsSync(new URL('../public/' + link, import.meta.url).pathname), link).toBe(true);
  });
});
