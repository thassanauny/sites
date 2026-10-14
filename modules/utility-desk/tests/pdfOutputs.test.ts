import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import * as pdfjs from 'pdfjs-dist';
import { mount as mountImages } from '../src/features/pdf/pdfToImages';
import { mount as mountSplit } from '../src/features/pdf/splitPdf';
import { LIMITS } from '../src/shared/limits';
import { blobBytes, bytesFile, captureDownloads, mainRoot, press, selectFiles, statuses } from './helpers';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, AnnotationMode: { DISABLE: 0, ENABLE: 1 }, getDocument: vi.fn() }));

// The limits are plain numbers at run time, so a test can lower one instead of building 500 MB of data.
const limits = LIMITS as { -readonly [K in keyof typeof LIMITS]: number };
const defaults = { ...LIMITS };

let root: HTMLElement;
let cleanup: void | (() => void);
beforeEach(() => {
  localStorage.clear();
  root = mainRoot();
  vi.mocked(pdfjs.getDocument).mockReset();
});
afterEach(() => {
  root.dispatchEvent(new Event('utility-desk:leave'));
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  Object.assign(limits, defaults);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const setField = (name: string, value: string) => {
  const control = root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('split PDF output', () => {
  const pdfBytes = async (pages: number) => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([100, 100 + i]);
    return doc.save();
  };
  const choose = async (name: string, pages: number) => {
    selectFiles(root, [bytesFile(name, await pdfBytes(pages), 'application/pdf')]);
    await vi.waitFor(() => expect(root.textContent).toContain(`${name}: ${pages} pages`));
  };
  const heights = async (blob: Blob) => {
    const doc = await PDFDocument.load(await blobBytes(blob));
    return doc.getPages().map((page) => page.getHeight());
  };

  it('saves several pages as one stored ZIP with one entry per page', async () => {
    const saved = captureDownloads();
    cleanup = mountSplit(root);
    await choose('report.pdf', 3);
    press(root, 'Save PDF pages →');
    await vi.waitFor(() => expect(statuses(root)[0]).toBe('Done. 3 PDF file(s) downloaded as ZIP.'));
    expect(saved.map((file) => file.name)).toEqual(['report-split.zip']);
    expect(saved[0].blob.type).toBe('application/zip');
    const entries = unzipSync(await blobBytes(saved[0].blob));
    expect(Object.keys(entries)).toEqual(['report-page-1.pdf', 'report-page-2.pdf', 'report-page-3.pdf']);
    expect(await Promise.all(Object.values(entries).map(async (entry) => (await PDFDocument.load(entry)).getPageCount()))).toEqual([1, 1, 1]);
  });

  it('downloads a single selected page as a PDF and extracts a selection in the order given', async () => {
    const saved = captureDownloads();
    cleanup = mountSplit(root);
    await choose('report.pdf', 3);
    setField('range', '2');
    press(root, 'Save PDF pages →');
    await vi.waitFor(() => expect(statuses(root)[0]).toBe('Done. 1 PDF file(s) downloaded.'));
    expect(saved.map((file) => file.name)).toEqual(['report-page-2.pdf']);
    expect(saved[0].blob.type).toBe('application/pdf');
    expect(await heights(saved[0].blob)).toEqual([101]);

    const mode = root.querySelector<HTMLSelectElement>('[name=mode]')!;
    mode.value = 'range';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    setField('range', '3, 1');
    press(root, 'Save PDF pages →');
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1].name).toBe('report-pages-3_1.pdf');
    expect(await heights(saved[1].blob)).toEqual([102, 100]);
  });

  it('stops at the total size limit instead of collecting every page', async () => {
    const saved = captureDownloads();
    cleanup = mountSplit(root);
    await choose('report.pdf', 3);
    limits.totalBytes = 1;
    press(root, 'Save PDF pages →');
    await vi.waitFor(() => expect(statuses(root)[0]).toBe('Failed: The page files exceed 1 B. Select fewer pages.'));
    expect(saved).toHaveLength(0);
  });

  it('resets a finished status for another PDF but keeps it when the same PDF is chosen again', async () => {
    captureDownloads();
    cleanup = mountSplit(root);
    await choose('first.pdf', 2);
    press(root, 'Save PDF pages →');
    await vi.waitFor(() => expect(statuses(root)[0]).toBe('Done. 2 PDF file(s) downloaded as ZIP.'));
    await choose('first.pdf', 2);
    await settle();
    expect(statuses(root)[0]).toBe('Done. 2 PDF file(s) downloaded as ZIP.');
    await choose('second.pdf', 2);
    expect(statuses(root)).toEqual(['Ready.']);
  });
});

describe('PDF to images output', () => {
  function openPdf(pages: number) {
    const page = { getViewport: () => ({ width: 40, height: 20 }), render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })), cleanup: vi.fn() };
    const doc = { numPages: pages, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
    vi.mocked(pdfjs.getDocument).mockReturnValue({ promise: Promise.resolve(doc), destroy: vi.fn() } as unknown as pdfjs.PDFDocumentLoadingTask);
    return doc;
  }
  function encodeAs(size: number) {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      const blob = new Blob([new Uint8Array(size)], { type: type ?? 'image/png' });
      Object.defineProperty(blob, 'arrayBuffer', { value: async () => new Uint8Array(size).buffer });
      callback(blob);
    });
  }
  const choose = async (name: string, pages: number) => {
    selectFiles(root, [bytesFile(name, 'pdf', 'application/pdf')]);
    await vi.waitFor(() => expect(root.textContent).toContain(`${name}: ${pages} pages.`));
  };

  it('writes several pages straight into one ZIP and a single page as a plain image', async () => {
    const saved = captureDownloads();
    openPdf(3);
    encodeAs(3);
    cleanup = mountImages(root);
    await choose('doc.pdf', 3);
    press(root, 'Export page images →');
    await vi.waitFor(() => expect(statuses(root)[0]).toBe('Done. 3 image(s) downloaded as ZIP.'));
    expect(saved.map((file) => file.name)).toEqual(['doc-images.zip']);
    expect(Object.keys(unzipSync(await blobBytes(saved[0].blob)))).toEqual(['doc-p1.png', 'doc-p2.png', 'doc-p3.png']);

    setField('range', '2');
    press(root, 'Export page images →');
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1].name).toBe('doc-p2.png');
    expect(saved[1].blob.type).toBe('image/png');
    expect(statuses(root)[0]).toBe('Done. 1 image(s) downloaded.');
  });

  it('stops rendering once the images exceed the total size limit', async () => {
    const saved = captureDownloads();
    const doc = openPdf(3);
    encodeAs(3);
    limits.totalBytes = 5;
    cleanup = mountImages(root);
    await choose('doc.pdf', 3);
    press(root, 'Export page images →');
    await vi.waitFor(() => expect(statuses(root)[0]).toBe('Failed: The page images exceed 5 B. Lower the resolution or export fewer pages.'));
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(0);
  });

  it('resets a finished status for another PDF but keeps it when the same PDF is chosen again', async () => {
    captureDownloads();
    openPdf(2);
    encodeAs(3);
    cleanup = mountImages(root);
    await choose('first.pdf', 2);
    press(root, 'Export page images →');
    await vi.waitFor(() => expect(statuses(root)[0]).toBe('Done. 2 image(s) downloaded as ZIP.'));
    await choose('first.pdf', 2);
    await settle();
    expect(statuses(root)[0]).toBe('Done. 2 image(s) downloaded as ZIP.');
    await choose('second.pdf', 2);
    expect(statuses(root)).toEqual(['Ready.']);
  });

  it('opens documents with the bundled fonts and character maps and without eval', async () => {
    openPdf(1);
    cleanup = mountImages(root);
    await choose('doc.pdf', 1);
    expect(pdfjs.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        cMapPacked: true,
        isEvalSupported: false,
        cMapUrl: expect.stringMatching(/\/pdfjs\/cmaps\/$/),
        standardFontDataUrl: expect.stringMatching(/\/pdfjs\/standard_fonts\/$/),
      }),
    );
  });
});
