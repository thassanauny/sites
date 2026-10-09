import { toolPage, group, outputPanel } from '../page';
import { h, field, input, select, filePicker, taskControls, notice, persistForm, button, emptyState } from '../ui';
import { compressPdf, type CompressionMode } from '../lib/pdfCompression';
import { readFileBytes, downloadBlob, bytesToBlob, baseName, sanitizeFilename, MAX_FILE_BYTES, formatBytes, throwIfAborted } from '../lib/util';

export function mount(root: HTMLElement) {
  let file: File | null = null;
  const info = h('div', {}, emptyState('No PDF selected', 'Choose a PDF to compress.'));
  const results = h('div', { 'aria-live': 'polite' });
  const mode = select('compression', [['lossless', 'Lossless · preserve quality and text'], ['balanced', 'Balanced · image-only pages, 150 DPI'], ['small', 'Smaller file · image-only pages, 96 DPI']], 'lossless');
  const name = input('text', 'outName', 'compressed.pdf');
  const tradeoff = h('div');
  const updateMode = () => tradeoff.replaceChildren(notice(mode.value === 'lossless' ? 'info' : 'warn', mode.value === 'lossless'
    ? 'Keeps selectable text, image quality, links and forms. Already optimized PDFs may not shrink.'
    : 'Turns each visible page into a JPEG image. Text will no longer be selectable or searchable; links and forms become static. Use lossless compression to keep these features.'));
  mode.addEventListener('change', updateMode); updateMode();
  const picker = filePicker({ label: 'PDF file', accept: '.pdf,application/pdf', onFiles: ([selected]) => {
    file = null; results.replaceChildren();
    if (selected.size > MAX_FILE_BYTES) { info.replaceChildren(notice('warn', `File exceeds ${formatBytes(MAX_FILE_BYTES)}.`)); return; }
    file = selected;
    name.value = sanitizeFilename(`${baseName(selected.name)}-compressed.pdf`);
    info.replaceChildren(notice('info', `${selected.name} · ${formatBytes(selected.size)}. The source stays untouched.`));
  } });
  const task = taskControls('compress-pdf', 'Compress PDF', async ({ signal, progress }) => {
    const source = file!, compression = mode.value as CompressionMode;
    const filename = sanitizeFilename(name.value, 'compressed.pdf').replace(/(?:\.pdf)?$/i, '.pdf');
    results.replaceChildren();
    const result = await compressPdf(await readFileBytes(source, signal), compression, signal, progress);
    throwIfAborted(signal);
    const message = result.unchanged ? 'No size reduction with these settings. An unchanged copy is ready.' : `Saved ${formatBytes(result.savedBytes)} (${result.savedPercent.toFixed(1)}%).`;
    results.append(notice(result.unchanged ? 'info' : 'success', message),
      h('p', {}, `${compression === 'lossless' ? 'Lossless' : compression === 'balanced' ? 'Balanced' : 'Smaller file'} · Original: ${formatBytes(result.originalSize)} → Output: ${formatBytes(result.bytes.length)} · ${result.pages} pages`),
      button('Download PDF', () => downloadBlob(bytesToBlob(result.bytes, 'application/pdf'), filename), { variant: 'primary' }));
    return message;
  }, { validate: () => file ? name.value.trim() ? null : 'Enter an output filename.' : 'Choose a PDF first.' });
  toolPage(root, 'compress-pdf', { config: [group(null, picker, info), group(null, field('Compression', mode), tradeoff, field('Output filename', name))], actions: [task.el], output: [outputPanel('Compressed PDF', 'DOWNLOAD', results)] });
  persistForm('compress-pdf', root);
  return () => { file = null; };
}
