import { LIMITS } from '../../shared/limits';

export const IMAGE_TOO_LARGE = 'Image is too large to process in the browser.';
// A JPEG frame header can sit behind large EXIF, ICC and thumbnail segments.
const HEAD_BYTES = 2 * 1024 * 1024;

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const text = (b: Uint8Array, i: number, expected: string) => [...expected].every((char, k) => b[i + k] === char.charCodeAt(0));

/** Pixel size declared in the first bytes of a PNG, JPEG, WebP, GIF or BMP file, or null when unknown. */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && text(b, 1, 'PNG') && text(b, 12, 'IHDR')) return { width: be32(b, 16), height: be32(b, 20) };
  if (b.length >= 10 && (text(b, 0, 'GIF87a') || text(b, 0, 'GIF89a'))) return { width: le16(b, 6), height: le16(b, 8) };
  if (b.length >= 26 && text(b, 0, 'BM')) {
    if (le32(b, 14) === 12) return { width: le16(b, 18), height: le16(b, 20) };
    return { width: le32(b, 18), height: Math.abs(le32(b, 22) | 0) };
  }
  if (b.length >= 25 && text(b, 0, 'RIFF') && text(b, 8, 'WEBP')) {
    if (text(b, 12, 'VP8L') && b[20] === 0x2f) {
      const bits = le32(b, 21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (b.length < 30) return null;
    if (text(b, 12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (text(b, 12, 'VP8X')) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      // SOF0-SOF15 carry the frame size; DHT (C4), JPG (C8) and DAC (CC) share the range but do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return i + 9 <= b.length ? { height: be16(b, i + 5), width: be16(b, i + 7) } : null;
      i += 2 + be16(b, i + 2);
    }
  }
  return null;
}

async function readHead(file: Blob): Promise<Uint8Array | null> {
  try {
    const part = file.slice(0, HEAD_BYTES);
    if (typeof part.arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer());
    return await new Promise<Uint8Array | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(part);
    });
  } catch {
    return null;
  }
}

/**
 * Decode an image with its camera orientation applied. The size declared in the file header is checked first, so an
 * image that would need more than the pixel limit is refused before the browser allocates its pixels; formats whose
 * header is not read here are checked after decoding.
 */
export async function decodeImage(file: File): Promise<ImageBitmap> {
  const head = await readHead(file);
  const declared = head && imageDimensions(head);
  if (declared && declared.width * declared.height > LIMITS.imagePixels) throw new Error(IMAGE_TOO_LARGE);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (bitmap.width * bitmap.height > LIMITS.imagePixels) {
    bitmap.close();
    throw new Error(IMAGE_TOO_LARGE);
  }
  return bitmap;
}
