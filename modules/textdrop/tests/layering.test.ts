import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// everydayapps/code-organization.md keeps domain rules apart from storage, cloud and screen code. This makes that checkable.
const root = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : [];
  });
}

function relativeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)'([^']+)'/gm)].map(match => match[1]!);
  return specifiers.filter(specifier => specifier.startsWith('.')).map(specifier => resolve(dirname(file), specifier));
}

/** Layers a layer may import from. Infrastructure implements the interfaces in `application/ports.ts` and nothing else of the application. */
const allowed: Record<string, string[]> = {
  domain: [],
  ui: ['domain'],
  application: ['domain', 'ui'],
  infrastructure: ['domain'],
};
const layerOf = (file: string): string => relative(root, file).split(sep)[0]!;

describe('code layers', () => {
  const files = sourceFiles(root).filter(file => layerOf(file) in allowed);

  it('covers every layer with source files', () => {
    for (const layer of Object.keys(allowed))
      expect(
        files.some(file => layerOf(file) === layer),
        layer,
      ).toBe(true);
  });

  it('imports only from the layers each layer may use', () => {
    const violations: string[] = [];
    for (const file of files) {
      const layer = layerOf(file);
      for (const target of relativeImports(file)) {
        const targetLayer = relative(root, target).split(sep)[0]!;
        const portsOnly = layer === 'infrastructure' && relative(root, target) === join('application', 'ports');
        if (targetLayer !== layer && !allowed[layer]!.includes(targetLayer) && !portsOnly) {
          violations.push(`${relative(root, file)} imports ${relative(root, target)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
