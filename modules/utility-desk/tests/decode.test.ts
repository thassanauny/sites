import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImage, imageDimensions, IMAGE_TOO_LARGE } from '../src/domain/images/decode';
import { bytesFile } from './helpers';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());

const png = (width: number, height: number) => bytes([0x89, ...ascii('PNG'), 13, 10, 26, 10], be32(13), ascii('IHDR'), be32(width), be32(height), [8, 6, 0, 0, 0]);
const gif = (width: number, height: number) => bytes(ascii('GIF89a'), le16(width), le16(height), [0, 0, 0]);
const bmp = (width: number, height: number) => bytes(ascii('BM'), le32(0), le32(0), le32(54), le32(40), le32(width), le32(height), [1, 0, 24, 0]);
const bmpCore = (width: number, height: number) => bytes(ascii('BM'), le32(0), le32(0), le32(26), le32(12), le16(width), le16(height), [1, 0, 24, 0]);
const riff = (chunk: string, body: number[]) => bytes(ascii('RIFF'), le32(body.length + 12), ascii('WEBP'), ascii(chunk), le32(body.length), body);
const webpLossy = (width: number, height: number) => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height)]);
const webpLossless = (width: number, height: number) => riff('VP8L', [0x2f, ...le32((width - 1) | ((height - 1) << 14))]);
const webpExtended = (width: number, height: number) => riff('VP8X', [0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
const segment = (marker: number, payload: number[]) => bytes([0xff, marker], be16(payload.length + 2), payload);
const frame = (marker: number, width: number, height: number) => segment(marker, [8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const jpeg = (...segments: Uint8Array[]) => Uint8Array.from([0xff, 0xd8, ...segments.flatMap((part) => [...part]), 0xff, 0xda, 0, 2]);

describe('image header sizes', () => {
  it.each([
    ['PNG', png(4000, 3000)],
    ['GIF', gif(640, 480)],
    ['BMP', bmp(1280, 720)],
    ['BMP (OS/2 header)', bmpCore(320, 200)],
    ['WebP lossy', webpLossy(1024, 768)],
    ['WebP lossless', webpLossless(2048, 1536)],
    ['WebP extended', webpExtended(8192, 4096)],
    ['JPEG', jpeg(segment(0xe0, ascii('JFIF\0').concat([1, 1, 0, 0, 1, 0, 1, 0, 0])), frame(0xc0, 6000, 4000))],
    ['progressive JPEG', jpeg(frame(0xc2, 6000, 4000))],
  ] as const)('reads the size of a %s', (name, data) => {
    const expected = { PNG: [4000, 3000], GIF: [640, 480], BMP: [1280, 720], 'BMP (OS/2 header)': [320, 200], 'WebP lossy': [1024, 768], 'WebP lossless': [2048, 1536], 'WebP extended': [8192, 4096], JPEG: [6000, 4000], 'progressive JPEG': [6000, 4000] }[name]!;
    expect(imageDimensions(data)).toEqual({ width: expected[0], height: expected[1] });
  });

  it('reads a top-down BMP and skips JPEG segments that only look like a frame header', () => {
    expect(imageDimensions(bmp(100, -50 >>> 0))).toEqual({ width: 100, height: 50 });
    const exif = segment(0xe1, ascii('Exif\0\0').concat(new Array(5000).fill(0xff)));
    const tables = segment(0xc4, new Array(20).fill(1));
    expect(imageDimensions(jpeg(exif, tables, segment(0xcc, [1, 2, 3]), frame(0xc1, 123, 45)))).toEqual({ width: 123, height: 45 });
  });

  it('gives up on truncated, unknown and frameless data', () => {
    expect(imageDimensions(new Uint8Array())).toBeNull();
    expect(imageDimensions(png(10, 10).slice(0, 20))).toBeNull();
    expect(imageDimensions(new TextEncoder().encode('just some text, not an image at all'))).toBeNull();
    expect(imageDimensions(jpeg(segment(0xe0, [1, 2, 3])))).toBeNull();
    expect(imageDimensions(riff('ANIM', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17]))).toBeNull();
  });
});

describe('decodeImage', () => {
  const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() });
  const stub = (result: ReturnType<typeof bitmap>) => {
    const create = vi.fn(async () => result);
    vi.stubGlobal('createImageBitmap', create);
    return create;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('refuses an image whose header declares too many pixels before the browser decodes it', async () => {
    const create = stub(bitmap(10, 10));
    for (const data of [png(20_000, 20_000), webpLossless(16_384, 16_384), jpeg(frame(0xc0, 65_535, 65_535)), gif(65_535, 65_535)]) {
      await expect(decodeImage(bytesFile('huge.img', data, 'image/png'))).rejects.toThrow(IMAGE_TOO_LARGE);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('decodes with the camera orientation applied and returns the bitmap', async () => {
    const decoded = bitmap(4000, 3000);
    const create = stub(decoded);
    const file = bytesFile('photo.png', png(4000, 3000), 'image/png');
    await expect(decodeImage(file)).resolves.toBe(decoded);
    expect(create).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(decoded.close).not.toHaveBeenCalled();
  });

  it('checks the decoded size when the header is unknown or understates it, and closes the bitmap', async () => {
    const huge = bitmap(10_001, 10_000);
    stub(huge);
    await expect(decodeImage(bytesFile('mystery.img', 'not a known header'))).rejects.toThrow(IMAGE_TOO_LARGE);
    expect(huge.close).toHaveBeenCalledOnce();
    const understated = bitmap(20_000, 20_000);
    stub(understated);
    await expect(decodeImage(bytesFile('liar.png', png(10, 10), 'image/png'))).rejects.toThrow(IMAGE_TOO_LARGE);
    expect(understated.close).toHaveBeenCalledOnce();
  });

  it('reads the header through Blob.arrayBuffer when the browser has it, and still decodes when it cannot read the file', async () => {
    const decoded = bitmap(10, 10);
    const create = stub(decoded);
    const head = png(30_000, 30_000);
    const file = bytesFile('modern.png', png(1, 1), 'image/png');
    Object.defineProperty(file, 'slice', { value: () => ({ arrayBuffer: async () => head.buffer }) });
    await expect(decodeImage(file)).rejects.toThrow(IMAGE_TOO_LARGE);
    expect(create).not.toHaveBeenCalled();
    const unreadable = bytesFile('unreadable.png', 'x', 'image/png');
    Object.defineProperty(unreadable, 'slice', {
      value: () => {
        throw new Error('gone');
      },
    });
    await expect(decodeImage(unreadable)).resolves.toBe(decoded);
  });
});
