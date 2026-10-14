import type * as Pdfjs from 'pdfjs-dist';
import { toolPage } from '../../application/page';
import { taskControls, persistForm, operationSlot, sourceSelection } from '../../application/tasks';
import { h, field, input, select, filePicker, notice, option, rangeField, qualityScale } from '../../ui/elements';
import { group } from '../../ui/layout';
import { loadPdfjs, pdfjsDocumentOptions } from '../../domain/pdf/pdfjs';
import { parsePageRanges } from '../../domain/pdf/ranges';
import { zipWriter } from '../../shared/zip';
import { encodeCanvas } from '../../domain/images/operations';
import { LIMITS } from '../../shared/limits';
import { readFileBytes, downloadBlob, baseName, sanitizeFilename, formatBytes, throwIfAborted } from '../../shared/util';

export function mount(root: HTMLElement) {
  let file: File | null = null;
  let doc: Pdfjs.PDFDocumentProxy | null = null;
  let loading: Pdfjs.PDFDocumentLoadingTask | null = null;
  let selectionRequest = 0;
  const operation = operationSlot();
  const info = h('div');
  const range = input('text', 'range', '', { placeholder: 'All pages, or e.g. 1-3, 5' });
  const fmt = select(
    'format',
    [
      ['png', 'PNG'],
      ['jpeg', 'JPEG'],
    ],
    'png',
  );
  const dpi = input('number', 'dpi', '300', { min: 72, max: 1200 });
  const quality = rangeField({ id: 'pdf-jpeg-quality', name: 'quality', label: 'JPEG quality', value: '90', min: 1, max: 100, step: 1, footer: qualityScale() });
  const hideAnnotations = input('checkbox', 'hideAnnotations');

  function releaseSource() {
    const previousLoad = loading,
      previousDocument = doc;
    loading = null;
    doc = null;
    file = null;
    if (previousLoad) void previousLoad.destroy();
    else if (previousDocument) void previousDocument.destroy();
  }

  async function renderPage(num: number, scale: number, canvas: HTMLCanvasElement, source: Pdfjs.PDFDocumentProxy, hide: boolean, signal: AbortSignal) {
    let page: Pdfjs.PDFPageProxy | undefined, rendering: Pdfjs.RenderTask | undefined;
    const abort = () => rendering?.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      throwIfAborted(signal);
      const { AnnotationMode } = await loadPdfjs();
      page = await source.getPage(num);
      throwIfAborted(signal);
      // PDF.js exposes the visible crop box, but not the media box via its public API.
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width),
        height = Math.ceil(viewport.height);
      if (!Number.isFinite(width * height) || width < 1 || height < 1 || width * height > LIMITS.pagePixels) throw new Error(`Page ${num} exceeds the ${LIMITS.pagePixels / 1_000_000} MP rendering limit. Lower the DPI.`);
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot render PDF pages.');
      rendering = page.render({ canvasContext: context, viewport, annotationMode: hide ? AnnotationMode.DISABLE : AnnotationMode.ENABLE });
      await rendering.promise;
      throwIfAborted(signal);
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      page?.cleanup();
    }
  }

  const picked = sourceSelection(
    () => {},
    () => task.reset(),
  );
  const picker = filePicker({
    label: 'PDF file',
    accept: '.pdf,application/pdf',
    onFiles: async ([f]) => {
      const request = ++selectionRequest;
      const same = picked.begin(f);
      info.replaceChildren();
      releaseSource();
      if (f.size > LIMITS.fileBytes) {
        picked.reject();
        info.append(notice('warn', `File exceeds ${formatBytes(LIMITS.fileBytes)}.`));
        return;
      }
      try {
        const pdfjs = await loadPdfjs();
        const data = await readFileBytes(f);
        if (request !== selectionRequest) return;
        loading = pdfjs.getDocument(pdfjsDocumentOptions(data));
        const loaded = await loading.promise;
        if (request !== selectionRequest) {
          void loaded.destroy();
          return;
        }
        loading = null;
        doc = loaded;
        file = f;
        picked.accept(f, same);
        info.append(notice('info', `${f.name}: ${doc.numPages} pages.`));
      } catch (e) {
        if (request !== selectionRequest) return;
        releaseSource();
        picked.reject();
        info.append(notice('danger', /password/i.test((e as Error).message) ? 'Password-protected PDFs are not supported.' : `Could not open PDF: ${(e as Error).message}`));
      }
    },
  });

  const task = taskControls(
    'pdf-to-images',
    'Export page images',
    async ({ signal: taskSignal, progress }) => {
      throwIfAborted(taskSignal);
      const source = doc!,
        sourceFile = file!,
        hide = hideAnnotations.checked;
      const resolution = Number(dpi.value),
        jpegQuality = Math.min(1, Math.max(0.01, Number(quality.control.value) / 100));
      const pages = parsePageRanges(range.value, source.numPages);
      const type = fmt.value === 'jpeg' ? 'image/jpeg' : 'image/png';
      const ext = fmt.value === 'jpeg' ? 'jpg' : 'png';
      const stem = sanitizeFilename(baseName(sourceFile.name), 'page');
      const pad = String(source.numPages).length;
      if (!Number.isInteger(resolution) || resolution < 72 || resolution > 1200) throw new Error('Resolution must be a whole number from 72 to 1,200 DPI.');
      return operation.run(taskSignal, async (signal) => {
        // Several pages go straight into the archive, so only the page being rendered is held next to it.
        const archive = pages.length > 1 ? zipWriter() : null;
        let single: { name: string; blob: Blob } | undefined,
          total = 0;
        for (let i = 0; i < pages.length; i++) {
          throwIfAborted(signal);
          const c = document.createElement('canvas');
          try {
            await renderPage(pages[i], resolution / 72, c, source, hide, signal);
            const blob = await encodeCanvas(c, type, jpegQuality, signal);
            throwIfAborted(signal);
            if (!blob || blob.type !== type) throw new Error('Canvas export failed');
            const name = `${stem}-p${String(pages[i]).padStart(pad, '0')}.${ext}`;
            total += blob.size;
            if (total > LIMITS.totalBytes) throw new Error(`The page images exceed ${formatBytes(LIMITS.totalBytes)}. Lower the resolution or export fewer pages.`);
            if (archive) archive.add(name, new Uint8Array(await blob.arrayBuffer()));
            else single = { name, blob };
          } finally {
            c.width = c.height = 0;
          }

          progress((i + 1) / pages.length, `Page ${i + 1} of ${pages.length}`);
        }
        throwIfAborted(signal);
        if (archive) downloadBlob(archive.finish(), `${stem}-images.zip`);
        else downloadBlob(single!.blob, single!.name);
        return `${pages.length} image(s) downloaded${pages.length > 1 ? ' as ZIP' : ''}.`;
      });
    },
    { validate: () => (doc ? null : 'Choose a PDF first.') },
  );

  toolPage(root, 'pdf-to-images', {
    config: [
      group(null, picker, info),
      group(
        null,
        field('Pages to export', range, 'Leave blank for all, or enter 1, 3, 5-8.'),
        h('div', { class: 'option-grid' }, field('Image format', fmt), field('Resolution (DPI)', dpi)),
        quality.el,
        option('Hide annotations', 'Omit annotation appearances from the exported pages.', hideAnnotations),
        h('p', { class: 'field-hint' }, 'Pages are rendered from the PDF crop box, the area a PDF viewer shows. Media-box rendering and TIFF export are unavailable in this edition.'),
      ),
    ],
    actions: [task.el],
  });
  persistForm('pdf-to-images', root, ['range']);
  return () => {
    selectionRequest++;
    operation.abort();
    releaseSource();
  };
}
