import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mount } from '../src/features/pdf/imagesToPdf';
import { toPdfImage } from '../src/domain/images/pdfImage';
import { LIMITS } from '../src/shared/limits';
import { formatBytes } from '../src/shared/util';
import { blobBytes, bytesFile, captureDownloads, mainRoot, press, selectFiles, statuses } from './helpers';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
// pdf-lib reads only the frame header, so a bare one is enough to embed.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const HUGE_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20, 8, 6, 0, 0, 0]);

const limits = LIMITS as { -readonly [K in keyof typeof LIMITS]: number };
const defaults = { ...LIMITS };

let requests: { type: string; quality: number | undefined }[];
let bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[];
let canvases: HTMLCanvasElement[];
let createBitmap: ReturnType<typeof vi.fn>;
let encodeAs: (type: string) => { bytes: Uint8Array; type: string };

beforeEach(() => {
  localStorage.clear();
  requests = [];
  bitmaps = [];
  canvases = [];
  encodeAs = (type) => ({ bytes: type === 'image/jpeg' ? JPEG : PNG, type });
  createBitmap = vi.fn(async () => {
    const bitmap = { width: 40, height: 30, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  });
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this);
    return { fillRect() {}, drawImage() {} } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type, quality) => {
    requests.push({ type: type ?? '', quality });
    const { bytes, type: produced } = encodeAs(type ?? 'image/png');
    const blob = new Blob([bytes as BlobPart], { type: produced });
    Object.defineProperty(blob, 'arrayBuffer', { value: async () => bytes.slice().buffer });
    callback(blob);
  });
});
afterEach(() => {
  Object.assign(limits, defaults);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('toPdfImage', () => {
  it('keeps JPEG photos as JPEG at quality 92 and every other format lossless', async () => {
    expect(await toPdfImage(bytesFile('photo.jpg', 'x', 'image/jpeg'))).toMatchObject({ type: 'jpg', width: 40, height: 30 });
    expect(await toPdfImage(bytesFile('scan.JFIF', 'x'))).toMatchObject({ type: 'jpg' });
    expect(await toPdfImage(bytesFile('logo.png', 'x', 'image/png'))).toMatchObject({ type: 'png' });
    expect(await toPdfImage(bytesFile('clip.gif', 'x', 'image/gif'))).toMatchObject({ type: 'png' });
    expect(requests).toEqual([
      { type: 'image/jpeg', quality: 0.92 },
      { type: 'image/jpeg', quality: 0.92 },
      { type: 'image/png', quality: 1 },
      { type: 'image/png', quality: 1 },
    ]);
    expect(createBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' });
  });

  it('refuses a browser that cannot encode the format, and releases the bitmap and canvas', async () => {
    encodeAs = () => ({ bytes: PNG, type: 'image/png' });
    await expect(toPdfImage(bytesFile('photo.jpg', 'x', 'image/jpeg'))).rejects.toThrow('Could not convert photo.jpg');
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('stops on a cancelled run, closing the bitmap it already decoded', async () => {
    await expect(toPdfImage(bytesFile('photo.png', PNG, 'image/png'), AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(createBitmap).not.toHaveBeenCalled();
    const controller = new AbortController();
    createBitmap.mockImplementationOnce(async () => {
      controller.abort();
      const bitmap = { width: 40, height: 30, close: vi.fn() };
      bitmaps.push(bitmap);
      return bitmap;
    });
    await expect(toPdfImage(bytesFile('photo.png', PNG, 'image/png'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(requests).toEqual([]);
  });

  it('never decodes an image whose header declares too many pixels', async () => {
    await expect(toPdfImage(bytesFile('huge.png', HUGE_PNG, 'image/png'))).rejects.toThrow('Image is too large to process in the browser.');
    expect(createBitmap).not.toHaveBeenCalled();
  });
});

describe('Images to PDF', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = mainRoot();
  });
  afterEach(() => {
    root.dispatchEvent(new Event('utility-desk:leave'));
  });

  const run = async (...files: File[]) => {
    const cleanup = mount(root);
    selectFiles(root, files);
    press(root, 'Create PDF →');
    await vi.waitFor(() => expect(statuses(root)[0]).not.toMatch(/^(Ready\.|Working…)$/));
    return cleanup;
  };

  it('embeds JPEG photos and other images in one PDF', async () => {
    const saved = captureDownloads();
    const cleanup = await run(bytesFile('photo.jpg', 'x', 'image/jpeg'), bytesFile('logo.png', 'x', 'image/png'));
    try {
      expect(statuses(root)[0]).toMatch(/^Done\. photo_images\.pdf \(.*, 2 pages\)$/);
      expect(requests.map((request) => request.type)).toEqual(['image/jpeg', 'image/png']);
      expect(await (await PDFDocument.load(await blobBytes(saved[0].blob))).getPageCount()).toBe(2);
      expect(saved[0].name).toBe('photo_images.pdf');
    } finally {
      if (typeof cleanup === 'function') cleanup();
    }
  });

  it('stops when the converted images together exceed the total size limit', async () => {
    const saved = captureDownloads();
    limits.totalBytes = PNG.length + 1;
    const cleanup = await run(bytesFile('a.png', 'x', 'image/png'), bytesFile('b.png', 'x', 'image/png'), bytesFile('c.png', 'x', 'image/png'));
    try {
      expect(statuses(root)[0]).toBe(`Failed: The converted images exceed ${formatBytes(limits.totalBytes)}. Add fewer or smaller images.`);
      expect(saved).toHaveLength(0);
      expect(createBitmap).toHaveBeenCalledTimes(2);
    } finally {
      if (typeof cleanup === 'function') cleanup();
    }
  });

  it('reports an image with a huge declared size without decoding it', async () => {
    captureDownloads();
    const cleanup = await run(bytesFile('huge.png', HUGE_PNG, 'image/png'));
    try {
      expect(statuses(root)[0]).toBe('Failed: Image is too large to process in the browser.');
      expect(createBitmap).not.toHaveBeenCalled();
    } finally {
      if (typeof cleanup === 'function') cleanup();
    }
  });
});
