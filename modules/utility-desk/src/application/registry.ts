import { TOOL_INFO, type ToolId, type ToolInfo } from './tools';

export interface ToolModule {
  mount: (root: HTMLElement) => void | (() => void);
}
export interface ToolDef extends ToolInfo {
  load: () => Promise<ToolModule>;
}

const LOADERS: Record<ToolId, ToolDef['load']> = {
  'date-time': () => import('../features/datetime/dateTime'),
  'media-converter': () => import('../features/media/mediaConverter'),
  'document-converter': () => import('../features/documents/documentConverter'),
  'pdf-to-images': () => import('../features/pdf/pdfToImages'),
  'images-to-pdf': () => import('../features/pdf/imagesToPdf'),
  'merge-pdfs': () => import('../features/pdf/mergePdfs'),
  'split-pdf': () => import('../features/pdf/splitPdf'),
  'compress-pdf': () => import('../features/pdf/compressPdf'),
  'unlock-pdf': () => import('../features/pdf/unlockPdf'),
  'qr-generator': () => import('../features/qr/qrGenerator'),
  'image-workshop': () => import('../features/images/imageWorkshop'),
  'crop-image': () => import('../features/images/cropImage'),
  'compress-image': () => import('../features/images/compressImage'),
};

/** Every tool with its lazy screen loader. */
export const TOOLS: ToolDef[] = TOOL_INFO.map((tool) => ({ ...tool, load: LOADERS[tool.id] }));
