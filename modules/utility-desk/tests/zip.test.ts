import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { nameAllocator, safeZipPath, zipWriter } from '../src/shared/zip';
import { sanitizeFilename } from '../src/shared/util';
import { blobBytes } from './helpers';

describe('zip', () => {
  it('prevents path traversal', () => {
    expect(safeZipPath('../../etc/passwd')).toBe('etc/passwd');
    expect(safeZipPath('C:\\x\\y.txt')).toBe('C:/x/y.txt');
    expect(['x', 'x'].map(nameAllocator())).toEqual(['x', 'x-2']);
  });
  it('never hands out a name twice, even when a numbered name is already taken', () => {
    expect(['a.txt', 'a.txt', 'a-2.txt', 'A.TXT'].map(nameAllocator())).toEqual(['a.txt', 'a-2.txt', 'a-2-2.txt', 'A-3.TXT']);
    const next = nameAllocator();
    expect([next('.hidden'), next('.hidden'), next('dir/x'), next('dir/x')]).toEqual(['.hidden', '.hidden-2', 'dir/x', 'dir/x-2']);
  });
});

describe('zipWriter', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it('writes stored entries one at a time that a standard reader unpacks', async () => {
    const zip = zipWriter();
    const sizes = [zip.size];
    zip.add('one.bin', bytes(1, 2, 3));
    sizes.push(zip.size);
    zip.add('folder/two.txt', new TextEncoder().encode('two'));
    sizes.push(zip.size);
    zip.add('../../escape.txt', bytes(9));
    sizes.push(zip.size);
    zip.add('one.bin', bytes(4));
    sizes.push(zip.size);
    expect(sizes.every((size, i) => i === 0 || size > sizes[i - 1])).toBe(true);
    const archive = zip.finish();
    expect(archive.type).toBe('application/zip');
    const raw = await blobBytes(archive);
    const files = unzipSync(raw);
    expect(Object.keys(files)).toEqual(['one.bin', 'folder/two.txt', 'escape.txt', 'one-2.bin']);
    expect([...files['one.bin']]).toEqual([1, 2, 3]);
    expect(strFromU8(files['folder/two.txt'])).toBe('two');
    expect([...files['one-2.bin']]).toEqual([4]);
    // Local file header at offset 0: compression method (bytes 8-9) 0 means stored.
    expect(new DataView(raw.buffer, raw.byteOffset).getUint16(8, true)).toBe(0);
  });

  it('writes a valid archive for no entries and for an empty entry', async () => {
    expect(Object.keys(unzipSync(await blobBytes(zipWriter().finish())))).toEqual([]);
    const zip = zipWriter();
    zip.add('empty.txt', new Uint8Array());
    expect(unzipSync(await blobBytes(zip.finish()))['empty.txt']).toHaveLength(0);
  });
});

describe('filenames', () => {
  it('sanitizes', () => {
    expect(sanitizeFilename('../../a:b*c?.pdf')).toBe('_.._abc.pdf');
    expect(sanitizeFilename('...')).toBe('file');
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename(`${'x'.repeat(300)}.pdf`).length).toBeLessThanOrEqual(120);
  });
});
