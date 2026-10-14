import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { Unzlib, Zlib } from 'fflate';
import type * as Pdfjs from 'pdfjs-dist';
import { LIMITS } from '../../shared/limits';
import { formatBytes, formatCount, throwIfAborted } from '../../shared/util';
import { restoreStreamLengths } from './streams';
import { loadPdfjs, pdfjsDocumentOptions } from './pdfjs';
import { encodeCanvas } from '../images/operations';

export type CompressionMode = 'lossless' | 'balanced' | 'small';
export interface CompressionResult {
  bytes: Uint8Array;
  originalSize: number;
  savedBytes: number;
  savedPercent: number;
  pages: number;
  unchanged: boolean;
}

async function recompressStream(contents: Uint8Array, flate: boolean, signal?: AbortSignal): Promise<Uint8Array | undefined> {
  const skip = new Error('Keep the existing stream');
  const chunks: Uint8Array[] = [];
  let compressedSize = 0,
    inflatedSize = 0;
  const compressor = new Zlib({ level: 9 }, (chunk) => {
    compressedSize += chunk.length;
    if (compressedSize >= contents.length) throw skip;
    chunks.push(chunk);
  });
  const decoder = flate
    ? new Unzlib((chunk, final) => {
        inflatedSize += chunk.length;
        // Bound inflation independently of the uploaded PDF's compressed size.
        if (inflatedSize > LIMITS.inflatedBytes) throw skip;
        compressor.push(chunk, final);
      })
    : compressor;
  try {
    for (let offset = 0; offset < contents.length; offset += 65536) {
      throwIfAborted(signal);
      decoder.push(contents.subarray(offset, offset + 65536), offset + 65536 >= contents.length);
      if (offset % (1024 * 1024) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    if (error === skip) return undefined;
    throw error;
  }
  if (!chunks.length) return undefined;
  const result = new Uint8Array(compressedSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function compressionResult(original: Uint8Array, candidate: Uint8Array, pages: number): CompressionResult {
  const unchanged = candidate.length >= original.length;
  const bytes = unchanged ? original : candidate;
  const savedBytes = original.length - bytes.length;
  return { bytes, originalSize: original.length, savedBytes, savedPercent: original.length ? (savedBytes / original.length) * 100 : 0, pages, unchanged };
}

export async function compressPdf(original: Uint8Array, mode: CompressionMode, signal?: AbortSignal, onProgress?: (p: number, label?: string) => void): Promise<CompressionResult> {
  throwIfAborted(signal);
  if (!['lossless', 'balanced', 'small'].includes(mode)) throw new Error('Choose a supported compression mode.');
  if (original.length > LIMITS.fileBytes) throw new Error(`PDF compression accepts files up to ${formatBytes(LIMITS.fileBytes)}.`);
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(original, { ignoreEncryption: false, updateMetadata: false });
  } catch (error) {
    throwIfAborted(signal);
    throw new Error(/encrypt/i.test((error as Error).message) ? 'Password-protected PDFs are not supported.' : 'Could not read this PDF. It may be damaged or unsupported.');
  }
  throwIfAborted(signal);
  const pages = source.getPageCount();
  if (!pages || pages > LIMITS.pdfPages) throw new Error(`PDF compression accepts 1 to ${formatCount(LIMITS.pdfPages)} pages.`);
  if (mode !== 'lossless') return compressPageImages(original, mode, pages, signal, onProgress);
  await restoreStreamLengths(source, original, signal);

  // Recompress only plain and single-Flate streams. Keeping DecodeParms intact
  // preserves image predictors; opaque image codecs and filter chains stay intact.
  const objects = source.context.enumerateIndirectObjects();
  for (let i = 0; i < objects.length; i++) {
    throwIfAborted(signal);
    const [ref, object] = objects[i];
    if (object instanceof PDFRawStream) {
      const filter = object.dict.lookup(PDFName.of('Filter'));
      if (!filter || filter === PDFName.of('FlateDecode')) {
        const contents = object.getContents();
        const compressed = await recompressStream(contents, !!filter, signal);
        if (compressed) {
          const dict = object.dict.clone(source.context);
          dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
          source.context.assign(ref, PDFRawStream.of(dict, compressed));
        }
      }
    }
    if (i % 50 === 0) {
      onProgress?.((0.8 * (i + 1)) / objects.length, 'Optimizing PDF storage');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  throwIfAborted(signal);
  const candidate = await source.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  throwIfAborted(signal);
  onProgress?.(1, 'PDF ready');
  return compressionResult(original, candidate, pages);
}

async function compressPageImages(original: Uint8Array, mode: 'balanced' | 'small', pages: number, signal?: AbortSignal, onProgress?: (p: number, label?: string) => void): Promise<CompressionResult> {
  const output = await PDFDocument.create();
  throwIfAborted(signal);
  const pdfjs = await loadPdfjs();
  throwIfAborted(signal);
  const loading = pdfjs.getDocument(pdfjsDocumentOptions(original.slice()));
  let rendering: Pdfjs.RenderTask | undefined;
  const abort = () => {
    rendering?.cancel();
    void loading.destroy();
  };
  signal?.addEventListener('abort', abort, { once: true });
  const dpi = mode === 'balanced' ? 150 : 96;
  const quality = mode === 'balanced' ? 0.75 : 0.55;
  const canvas = document.createElement('canvas');
  let imageBytes = 0;
  try {
    throwIfAborted(signal);
    const doc = await loading.promise;
    if (doc.numPages !== pages) throw new Error('Could not read all PDF pages.');
    for (let i = 1; i <= pages; i++) {
      throwIfAborted(signal);
      const page = await doc.getPage(i);
      try {
        throwIfAborted(signal);
        const viewport = page.getViewport({ scale: dpi / 72 });
        const width = Math.ceil(viewport.width),
          height = Math.ceil(viewport.height);
        if (!Number.isFinite(width * height) || width < 1 || height < 1 || width * height > LIMITS.pagePixels) throw new Error(`Page ${i} exceeds the ${LIMITS.pagePixels / 1_000_000} MP rendering limit. Use lossless compression.`);
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot render PDF pages. Use lossless compression.');
        rendering = page.render({ canvasContext: context, viewport, background: '#ffffff', annotationMode: pdfjs.AnnotationMode.ENABLE });
        await rendering.promise;
        rendering = undefined;
        throwIfAborted(signal);
        const blob = await encodeCanvas(canvas, 'image/jpeg', quality, signal);
        throwIfAborted(signal);
        if (blob?.type !== 'image/jpeg') throw new Error('This browser cannot encode JPEG pages. Use lossless compression.');
        imageBytes += blob.size;
        if (imageBytes > LIMITS.totalBytes) throw new Error(`Rendered pages exceed the ${formatBytes(LIMITS.totalBytes)} output limit. Use lossless compression.`);
        const image = await output.embedJpg(await blob.arrayBuffer());
        throwIfAborted(signal);
        const size = page.getViewport({ scale: 1 });
        output.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
      } finally {
        rendering = undefined;
        page.cleanup();
        canvas.width = canvas.height = 0;
      }
      onProgress?.((0.9 * i) / pages, `Page ${i} of ${pages}`);
    }
    const candidate = await output.save();
    throwIfAborted(signal);
    onProgress?.(1, 'PDF ready');
    return compressionResult(original, candidate, pages);
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    canvas.width = canvas.height = 0;
    await loading.destroy();
  }
}
