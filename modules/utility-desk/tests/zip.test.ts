import { describe, it, expect } from 'vitest';
import { makeZip, readZip, uniqueNames, safeZipPath } from '../src/lib/zip';
import { sanitizeFilename } from '../src/lib/util';
import { compareFolders } from '../src/lib/foldersync';

describe('zip', () => {
  it('round-trips and dedupes names', () => {
    const z = makeZip([{ name: 'a.txt', data: new Uint8Array([1]) }, { name: 'a.txt', data: new Uint8Array([2]) }, { name: 'dir/b.txt', data: new Uint8Array([3]) }]);
    const files = readZip(z);
    expect(Object.keys(files).sort()).toEqual(['a-2.txt', 'a.txt', 'dir/b.txt']);
    expect(files['a-2.txt'][0]).toBe(2);
  });
  it('prevents path traversal', () => {
    expect(safeZipPath('../../etc/passwd')).toBe('etc/passwd');
    expect(safeZipPath('C:\\x\\y.txt')).toBe('C:/x/y.txt');
    expect(uniqueNames(['x', 'x'])).toEqual(['x', 'x-2']);
  });
});

describe('filenames', () => {
  it('sanitizes', () => {
    expect(sanitizeFilename('../../a:b*c?.pdf')).toBe('_.._abc.pdf');
    expect(sanitizeFilename('...')).toBe('file');
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('x'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(120);
  });
});

describe('folder compare', () => {
  it('classifies and never deletes', () => {
    const r = compareFolders(
      [{ path: 'a', size: 1, mtime: 10000 }, { path: 'b', size: 2, mtime: 20000 }, { path: 'c', size: 3, mtime: 10000 }],
      [{ path: 'a', size: 1, mtime: 10500 }, { path: 'b', size: 5, mtime: 20000 }, { path: 'z', size: 1, mtime: 1 }]);
    expect(r.unchanged.map((x) => x.path)).toEqual(['a']);
    expect(r.changed.map((x) => x.path)).toEqual(['b']);
    expect(r.added.map((x) => x.path)).toEqual(['c']);
    expect(r.destOnly.map((x) => x.path)).toEqual(['z']);
    expect(r.bytesToCopy).toBe(5);
  });
});
