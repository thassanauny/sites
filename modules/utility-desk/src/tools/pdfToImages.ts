import { toolPage, group, outputPanel } from '../page';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { h, field, input, select, filePicker, taskControls, notice, persistForm, button, option } from '../ui';
import { parsePageRanges } from '../lib/ranges';
import { makeZip } from '../lib/zip';
import { readFileBytes, downloadBlob, baseName, sanitizeFilename, UrlBag, MAX_FILE_BYTES, formatBytes, throwIfAborted } from '../lib/util';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_PIXELS = 50_000_000;

export function mount(root: HTMLElement) {
  let file: File | null = null;
  let doc: pdfjs.PDFDocumentProxy | null = null;
  const urls = new UrlBag();
  const info = h('div'), preview = h('div', { class: 'preview-grid' }), results = h('div', { class: 'preview-grid' });
  let outputs: { name: string; blob: Blob }[] = [];
  const range = input('text', 'range', '', { placeholder: 'All pages, or e.g. 1-3, 5' });
  const fmt = select('format', [['png', 'PNG'], ['jpeg', 'JPEG']], 'png');
  const dpi = input('number', 'dpi', '300', { min: 72, max: 1200 });
  const quality = input('number', 'quality', '90', { min: 1, max: 100 });
  const cropBox = input('checkbox', 'cropBox', '', { checked: true });
  const hideAnnotations = input('checkbox', 'hideAnnotations');

  async function renderPage(num: number, scale: number, canvas: HTMLCanvasElement, source = doc!, hide = hideAnnotations.checked) {
    const page = await source.getPage(num);
    // PDF.js exposes the visible crop box, but not the media box via its public API.
    const vp = page.getViewport({ scale });
    if (vp.width * vp.height > MAX_PIXELS) throw new Error(`Page ${num} would be ${Math.round((vp.width * vp.height) / 1e6)} MP at this DPI. Lower the DPI.`);
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, annotationMode: hide ? pdfjs.AnnotationMode.DISABLE : pdfjs.AnnotationMode.ENABLE }).promise;
    page.cleanup();
  }

  const picker = filePicker({ label: 'PDF file', accept: '.pdf,application/pdf', onFiles: async ([f]) => {
    info.replaceChildren(); preview.replaceChildren(); results.replaceChildren(); outputs = []; urls.revokeAll(); zipBtn.hidden = true;
    await doc?.destroy(); doc = null; file = null;
    if (f.size > MAX_FILE_BYTES) { info.append(notice('warn', `File exceeds ${formatBytes(MAX_FILE_BYTES)}.`)); return; }
    try {
      const assetRoot = new URL('pdfjs/', new URL(import.meta.env.BASE_URL, location.href)).href;
      doc = await pdfjs.getDocument({ data: await readFileBytes(f), cMapUrl: assetRoot + 'cmaps/', cMapPacked: true, standardFontDataUrl: assetRoot + 'standard_fonts/' }).promise; file = f;
      info.append(notice('info', `${f.name}: ${doc.numPages} pages. Previewing first pages.`));
      for (let p = 1; p <= Math.min(3, doc.numPages); p++) { const c = document.createElement('canvas'); await renderPage(p, 0.3, c); preview.append(h('figure', {}, c, h('figcaption', { class: 'muted' }, `Page ${p}`))); }
    } catch (e) { info.append(notice('danger', /password/i.test((e as Error).message) ? 'Password-protected PDFs are not supported.' : `Could not open PDF: ${(e as Error).message}`)); }
  } });

  const task = taskControls('pdf-to-images', 'Export page images', async ({ signal, progress }) => {
    const source = doc!, sourceFile = file!, hide = hideAnnotations.checked;
    const resolution = Number(dpi.value), jpegQuality = Math.min(1, Math.max(0.01, Number(quality.value) / 100));
    results.replaceChildren(); outputs = []; urls.revokeAll();
    zipBtn.hidden = true;
    const pages = parsePageRanges(range.value, source.numPages);
    const type = fmt.value === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = fmt.value === 'jpeg' ? 'jpg' : 'png';
    const stem = sanitizeFilename(baseName(sourceFile.name), 'page');
    const pad = String(source.numPages).length;
    for (let i = 0; i < pages.length; i++) {
      throwIfAborted(signal);
      const c = document.createElement('canvas');
      if (!Number.isInteger(resolution) || resolution < 72 || resolution > 1200) throw new Error('Resolution must be a whole number from 72 to 1,200 DPI.');
      await renderPage(pages[i], resolution / 72, c, source, hide);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, jpegQuality));
      c.width = c.height = 0;
      if (!blob) throw new Error('Canvas export failed');
      const name = `${stem}-p${String(pages[i]).padStart(pad, '0')}.${ext}`;
      outputs.push({ name, blob });
      results.append(h('figure', {}, h('img', { src: urls.make(blob), alt: `Rendered ${name}` }), h('figcaption', {}, button('Download', () => downloadBlob(blob, name), { variant: 'ghost' }), h('small', { class: 'muted' }, ` p.${pages[i]} · ${formatBytes(blob.size)}`))));
      progress((i + 1) / pages.length, `Page ${i + 1} of ${pages.length}`);
    }
    zipBtn.hidden = false;
    return `${outputs.length} image(s) rendered.`;
  }, { validate: () => (doc ? null : 'Choose a PDF first.') });
  const zipBtn = button('Download all as ZIP', async () => {
    const items = await Promise.all(outputs.map(async (o) => ({ name: o.name, data: new Uint8Array(await o.blob.arrayBuffer()) })));
    downloadBlob(new Blob([makeZip(items, { store: true }) as BlobPart], { type: 'application/zip' }), `${baseName(file!.name)}-images.zip`);
  }, { variant: 'primary' });
  zipBtn.hidden = true;

  cropBox.disabled = true;
  toolPage(root, 'pdf-to-images', { config: [group(null, picker, info, preview), group(null, field('Pages to export', range, 'Leave blank for all, or enter 1, 3, 5-8.'), h('div', { class: 'option-grid' }, field('Image format', fmt), field('Resolution (DPI)', dpi)), field('JPEG quality (1–100)', quality), option('Use the PDF crop box', 'PDF.js always renders the visible crop box. Full media-box rendering and TIFF export are unavailable in this edition.', cropBox), option('Hide annotations', 'Omit annotation appearances from the exported pages.', hideAnnotations))], actions: [task.el], output: [outputPanel('Output', 'IMAGES', zipBtn, results)] });
  persistForm('pdf-to-images', root);
  return () => { urls.revokeAll(); void doc?.destroy(); };
}
