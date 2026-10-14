import type { RouteId } from './router';

export type ToolId = Exclude<RouteId, 'dashboard'>;
/** `file` tools read user files and keep a completed progress bar after a run; `utility` tools do not. */
export type ToolKind = 'file' | 'utility';
export interface ToolInfo {
  id: ToolId;
  title: string;
  desc: string;
  icon: string;
  sub: string;
  kind: ToolKind;
}

/** Tool metadata only. Screens are loaded through `registry.ts`, so pages can read this without importing every tool. */
export const TOOL_INFO: ToolInfo[] = [
  { id: 'date-time', title: 'Date & time', icon: 'date-time', sub: 'Dates & timezones', desc: 'Date math, differences, Unix timestamps and world clocks.', kind: 'utility' },
  { id: 'media-converter', title: 'Media converter', icon: 'media-converter', sub: 'Convert & trim media', desc: 'Convert and trim audio/video with FFmpeg WebAssembly.', kind: 'file' },
  { id: 'document-converter', title: 'Document converter', icon: 'document-converter', sub: 'Convert books & documents', desc: 'Convert PDF, EPUB, Markdown, text, HTML and classic MOBI.', kind: 'file' },
  { id: 'pdf-to-images', title: 'PDF to images', icon: 'pdf-to-images', sub: 'Export pages as images', desc: 'Render PDF pages to PNG or JPEG.', kind: 'file' },
  { id: 'images-to-pdf', title: 'Images to PDF', icon: 'images-to-pdf', sub: 'Combine images into PDF', desc: 'Combine images into a single PDF.', kind: 'file' },
  { id: 'merge-pdfs', title: 'Merge PDFs', icon: 'merge-pdfs', sub: 'Combine PDF files', desc: 'Join PDFs, optionally selecting pages.', kind: 'file' },
  { id: 'split-pdf', title: 'Split PDF', icon: 'split-pdf', sub: 'Split & extract pages', desc: 'Split into pages or extract a range.', kind: 'file' },
  { id: 'compress-pdf', title: 'Compress PDF', icon: 'compress-pdf', sub: 'Reduce PDF file size', desc: 'Reduce PDF file size with lossless or image-based compression.', kind: 'file' },
  { id: 'unlock-pdf', title: 'Unlock PDF', icon: 'unlock-pdf', sub: 'Remove PDF password', desc: 'Use a known password to save an unlocked copy of a PDF.', kind: 'file' },
  { id: 'qr-generator', title: 'QR generator', icon: 'qr-generator', sub: 'Create QR codes', desc: 'Create a QR code for text, Wi-Fi, email, phone, SMS, or a contact.', kind: 'utility' },
  { id: 'image-workshop', title: 'Image workshop', icon: 'image-workshop', sub: 'Rotate, flip & adjust colors', desc: 'Rotate, filter and convert images.', kind: 'file' },
  { id: 'crop-image', title: 'Crop Image', icon: 'crop-image', sub: 'Crop to exact dimensions', desc: 'Crop an image with a preview and exact pixel measurements.', kind: 'file' },
  { id: 'compress-image', title: 'Compress Image', icon: 'compress-image', sub: 'Reduce & resize images', desc: 'Reduce image file size, with optional resizing.', kind: 'file' },
];

export const toolInfo = (id: string) => TOOL_INFO.find((tool) => tool.id === id);
