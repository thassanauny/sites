import type { PdfImage } from '../pdf/operations';
import { decodeImage } from './decode';
import { encodeCanvas } from './operations';
import { throwIfAborted } from '../../shared/util';

// Photos are saved as JPEG so a phone picture does not grow several times over as PNG; every other source stays lossless.
const JPEG_QUALITY = 0.92;
const isJpeg = (file: { name: string; type: string }) => file.type === 'image/jpeg' || /\.(jpe?g|jfif)$/i.test(file.name);

/** Decode any browser-supported image (camera orientation applied, transparency flattened onto white) and encode it for pdf-lib. */
export async function toPdfImage(file: File, signal?: AbortSignal): Promise<PdfImage> {
  throwIfAborted(signal);
  let bmp: ImageBitmap | null = await decodeImage(file);
  const { width, height } = bmp;
  let canvas: HTMLCanvasElement | undefined;
  try {
    throwIfAborted(signal);
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot render images.');
    context.fillStyle = 'white';
    context.fillRect(0, 0, width, height);
    context.drawImage(bmp, 0, 0);
    bmp.close();
    bmp = null;
    const photo = isJpeg(file),
      type = photo ? 'image/jpeg' : 'image/png';
    const blob = await encodeCanvas(canvas, type, photo ? JPEG_QUALITY : 1, signal);
    if (!blob || blob.type !== type) throw new Error(`Could not convert ${file.name}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    throwIfAborted(signal);
    return { bytes, type: photo ? 'jpg' : 'png', width, height };
  } finally {
    bmp?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
