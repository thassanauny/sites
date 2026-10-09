import { toolPage, group, outputPanel } from '../page';
import { h, field, input, select, filePicker, fileList, taskControls, notice, persistForm, button } from '../ui';
import { imagesToPdf, type PageSizeName, type Fit, type PdfImage } from '../lib/pdfops';
import { detectUnsupportedImage, MAX_PIXELS } from '../lib/imageops';
import { downloadBlob, bytesToBlob, sanitizeFilename, UrlBag, formatBytes, MAX_FILE_BYTES, MAX_TOTAL_BYTES, throwIfAborted } from '../lib/util';

/** Decode any browser-supported image; re-encode to PNG/JPEG for pdf-lib when needed. */
export async function toPdfImage(file: File): Promise<PdfImage> {
  const bmp = await createImageBitmap(file);
  const { width, height } = bmp;
  if (width * height > MAX_PIXELS) { bmp.close(); throw new Error('Image is too large for browser memory.'); }
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const g = c.getContext('2d')!; g.fillStyle = 'white'; g.fillRect(0, 0, width, height); g.drawImage(bmp, 0, 0); bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  c.width = c.height = 0;
  if (!blob) throw new Error(`Could not convert ${file.name}`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png', width, height };
}

export function mount(root: HTMLElement) {
  const items: { name: string; size: number; file: File; url: string }[] = [];
  const urls = new UrlBag();
  const msg = h('div');
  const thumbs = h('div', { class: 'preview-grid' });
  const draw = () => { thumbs.replaceChildren(...items.map((i) => h('figure', {}, h('img', { src: i.url, alt: i.name, loading: 'lazy' }), h('figcaption', { class: 'muted' }, i.name)))); };
  const list = fileList(items, draw);
  const picker = filePicker({ label: 'Add images', accept: 'image/*', multiple: true, onFiles: (files) => {
    msg.replaceChildren();
    for (const f of files) { const bad = detectUnsupportedImage(f); if (bad) { msg.append(notice('warn', `${f.name}: ${bad}`)); continue; } if (items.length >= 50 || f.size > MAX_FILE_BYTES || items.reduce((n, i) => n + i.size, 0) + f.size > MAX_TOTAL_BYTES) { msg.append(notice('warn', `${f.name} skipped: maximum 50 images, 200 MB each, 500 MB total.`)); continue; } items.push({ name: f.name, size: f.size, file: f, url: urls.make(f) }); }
    list.refresh(); draw();
  } });
  const size = select('pageSize', [['A4', 'A4'], ['Letter', 'Letter'], ['Legal', 'Legal'], ['A3', 'A3'], ['A5', 'A5'], ['Fit', 'Match image size']], 'A4');
  const orient = select('orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto');
  const fit = select('fit', [['contain', 'Fit inside'], ['cover', 'Fill (crop)'], ['stretch', 'Stretch'], ['original', 'Original size at DPI']], 'contain');
  const dpi = input('number', 'dpi', '150', { min: 72, max: 600 });
  const margin = input('number', 'margin', '0', { min: 0, max: 144 });
  const name = input('text', 'outName', 'images.pdf');
  const task = taskControls('images-to-pdf', 'Create PDF', async ({ signal, progress }) => {
    const sources = items.map((item) => item.file);
    const options = { pageSize: size.value as PageSizeName, orientation: orient.value as 'portrait' | 'landscape' | 'auto', fit: fit.value as Fit, dpi: Number(dpi.value), marginPt: Number(margin.value) || 0 };
    let n = sanitizeFilename(name.value, 'images.pdf'); if (!/\.pdf$/i.test(n)) n += '.pdf';
    const imgs: PdfImage[] = [];
    for (let i = 0; i < sources.length; i++) { throwIfAborted(signal); imgs.push(await toPdfImage(sources[i])); progress((i / sources.length) * 0.5); }
    const out = await imagesToPdf(imgs, options, signal, (p) => progress(0.5 + p / 2));
    imgs.length = 0;
    throwIfAborted(signal); downloadBlob(bytesToBlob(out, 'application/pdf'), n);
    return `${n} (${formatBytes(out.length)})`;
  }, { validate: () => (!items.length ? 'Add at least one image.' : !Number.isInteger(Number(dpi.value)) || Number(dpi.value) < 72 || Number(dpi.value) > 600 ? 'DPI must be a whole number from 72 to 600.' : Number(margin.value) < 0 || Number(margin.value) > 144 ? 'Margin must be from 0 to 144 points.' : null) });
  const preview = button('Preview PDF', () => msg.replaceChildren(notice('info', `${items.length} pages · ${size.value} · ${orient.value} · ${dpi.value} DPI. Image order is shown below; no PDF has been created.`)));
  toolPage(root, 'images-to-pdf', { config: [group('Image order', h('p', { class: 'field-hint' }, 'Reorder with the arrow buttons. HEIC/TIFF are unavailable. Camera orientation is applied, transparency flattened onto white, and metadata removed.'), picker, msg, list.el), group('Page settings', h('div', { class: 'option-grid' }, field('Page size', size), field('Orientation', orient), field('Image fitting', fit), field('DPI', dpi), field('Margin (pt)', margin), field('Output filename', name)))], actions: [preview, task.el], output: [outputPanel('Preview', 'PAGE ORDER', thumbs)] });
  persistForm('images-to-pdf', root);
  return () => urls.revokeAll();
}
