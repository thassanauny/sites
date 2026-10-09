import type { RouteId } from './lib/router';

export interface ToolDef { id: Exclude<RouteId, 'dashboard'>; title: string; desc: string; icon: string; sub: string; unavailable?: boolean; load: () => Promise<{ mount: (root: HTMLElement) => void | (() => void) }> }

export const TOOLS: ToolDef[] = [
  { id: 'date-time', title: 'Date & time', icon: '◷', sub: 'Dates & timezones', desc: 'Date math, differences, Unix timestamps and world clocks.', load: () => import('./tools/dateTime') },
  { id: 'folder-sync', title: 'Folder sync', icon: '↔', sub: 'rsync command', desc: 'Plan a folder sync with rsync dry-run and sync commands.', load: () => import('./tools/folderSync') },
  { id: 'media-downloader', title: 'Media downloader', icon: '↓', sub: 'yt-dlp command', desc: 'Prepare a yt-dlp command for videos, audio, playlists or clips.', load: () => import('./tools/mediaDownloader') },
  { id: 'secure-copy', title: 'Secure copy', icon: '⇄', sub: 'scp command', desc: 'Prepare an scp command; run it with your local SSH client.', load: () => import('./tools/secureCopy') },
  { id: 'media-converter', title: 'Media converter', icon: '▷', sub: 'FFmpeg WASM', desc: 'Convert and trim audio/video with FFmpeg WebAssembly.', load: () => import('./tools/mediaConverter') },
  { id: 'document-converter', title: 'Document converter', icon: '▤', sub: 'PDF, EPUB, Markdown', desc: 'Convert PDF, EPUB, Markdown, text, HTML and classic MOBI.', load: () => import('./tools/documentConverter') },
  { id: 'pdf-to-images', title: 'PDF to images', icon: '▧', sub: 'PDF.js', desc: 'Render PDF pages to PNG or JPEG.', load: () => import('./tools/pdfToImages') },
  { id: 'images-to-pdf', title: 'Images to PDF', icon: '▣', sub: 'pdf-lib', desc: 'Combine images into a single PDF.', load: () => import('./tools/imagesToPdf') },
  { id: 'merge-pdfs', title: 'Merge PDFs', icon: '⊕', sub: 'pdf-lib', desc: 'Join PDFs, optionally selecting pages.', load: () => import('./tools/mergePdfs') },
  { id: 'split-pdf', title: 'Split PDF', icon: '⊖', sub: 'pdf-lib', desc: 'Split into pages or extract a range.', load: () => import('./tools/splitPdf') },
  { id: 'compress-pdf', title: 'Compress PDF', icon: '⇣', sub: 'Local PDF compression', desc: 'Reduce PDF file size with lossless or image-based compression.', load: () => import('./tools/compressPdf') },
  { id: 'image-workshop', title: 'Image workshop', icon: '✧', sub: 'Canvas', desc: 'Resize, crop, rotate, filter and convert images.', load: () => import('./tools/imageWorkshop') },
];
