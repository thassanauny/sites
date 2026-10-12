import type { RouteId } from './router';

export interface ToolDef { id: Exclude<RouteId, 'dashboard'>; title: string; desc: string; icon: string; sub: string; load: () => Promise<{ mount: (root: HTMLElement) => void | (() => void) }> }

export const TOOLS: ToolDef[] = [
  { id: 'date-time', title: 'Date & time', icon: 'date-time', sub: 'Dates & timezones', desc: 'Date math, differences, Unix timestamps and world clocks.', load: () => import('../features/datetime/dateTime') },
  { id: 'media-converter', title: 'Media converter', icon: 'media-converter', sub: 'Convert & trim media', desc: 'Convert and trim audio/video with FFmpeg WebAssembly.', load: () => import('../features/media/mediaConverter') },
  { id: 'document-converter', title: 'Document converter', icon: 'document-converter', sub: 'Convert books & documents', desc: 'Convert PDF, EPUB, Markdown, text, HTML and classic MOBI.', load: () => import('../features/documents/documentConverter') },
  { id: 'pdf-to-images', title: 'PDF to images', icon: 'pdf-to-images', sub: 'Export pages as images', desc: 'Render PDF pages to PNG or JPEG.', load: () => import('../features/pdf/pdfToImages') },
  { id: 'images-to-pdf', title: 'Images to PDF', icon: 'images-to-pdf', sub: 'Combine images into PDF', desc: 'Combine images into a single PDF.', load: () => import('../features/pdf/imagesToPdf') },
  { id: 'merge-pdfs', title: 'Merge PDFs', icon: 'merge-pdfs', sub: 'Combine PDF files', desc: 'Join PDFs, optionally selecting pages.', load: () => import('../features/pdf/mergePdfs') },
  { id: 'split-pdf', title: 'Split PDF', icon: 'split-pdf', sub: 'Split & extract pages', desc: 'Split into pages or extract a range.', load: () => import('../features/pdf/splitPdf') },
  { id: 'compress-pdf', title: 'Compress PDF', icon: 'compress-pdf', sub: 'Reduce PDF file size', desc: 'Reduce PDF file size with lossless or image-based compression.', load: () => import('../features/pdf/compressPdf') },
  { id: 'unlock-pdf', title: 'Unlock PDF', icon: 'unlock-pdf', sub: 'Remove PDF password', desc: 'Use a known password to save an unlocked copy of a PDF.', load: () => import('../features/pdf/unlockPdf') },
  { id: 'qr-generator', title: 'QR generator', icon: 'qr-generator', sub: 'Create QR codes', desc: 'Create a QR code for text, Wi-Fi, email, phone, SMS, or a contact.', load: () => import('../features/qr/qrGenerator') },
  { id: 'image-workshop', title: 'Image workshop', icon: 'image-workshop', sub: 'Rotate, flip & adjust colors', desc: 'Rotate, filter and convert images.', load: () => import('../features/images/imageWorkshop') },
  { id: 'crop-image', title: 'Crop Image', icon: 'crop-image', sub: 'Crop to exact dimensions', desc: 'Crop an image with a preview and exact pixel measurements.', load: () => import('../features/images/cropImage') },
  { id: 'compress-image', title: 'Compress Image', icon: 'compress-image', sub: 'Reduce & resize images', desc: 'Reduce image file size, with optional resizing.', load: () => import('../features/images/compressImage') },
];
