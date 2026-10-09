import { toolPage, group } from '../page';
import { h, field, input, filePicker, fileList, taskControls, notice, persistForm, button } from '../ui';
import { mergePdfs, pageCount } from '../lib/pdfops';
import { parsePageRanges } from '../lib/ranges';
import { readFileBytes, downloadBlob, bytesToBlob, sanitizeFilename, MAX_FILE_BYTES, MAX_TOTAL_BYTES, formatBytes, throwIfAborted } from '../lib/util';

interface Item { name: string; size: number; file: File; pages: number; range: string }

export function mount(root: HTMLElement) {
  const items: Item[] = [];
  const msg = h('div');

  const list = fileList(items, () => {}, (it) => h('input', { type: 'text', value: it.range, placeholder: 'All pages', 'aria-label': `Pages of ${it.name}`, class: 'range-in', size: 12, oninput: (e: Event) => { it.range = (e.target as HTMLInputElement).value; } }));
  const picker = filePicker({ label: 'Add PDFs', accept: '.pdf,application/pdf', multiple: true, onFiles: async (files) => {
    msg.replaceChildren();
    for (const f of files) {
      if (items.length >= 50 || f.size > MAX_FILE_BYTES || items.reduce((n, item) => n + item.size, 0) + f.size > MAX_TOTAL_BYTES) { msg.append(notice('warn', `${f.name} skipped: size limit (${formatBytes(MAX_FILE_BYTES)} per file, ${formatBytes(MAX_TOTAL_BYTES)} total).`)); continue; }
      try { const pages = await pageCount(await readFileBytes(f)); items.push({ name: f.name, size: f.size, file: f, pages, range: '' }); }
      catch (e) { msg.append(notice('danger', `${f.name}: ${/encrypt/i.test((e as Error).message) ? 'password-protected PDFs are not supported' : 'could not be read as a PDF'}.`)); }
    }
    list.refresh();
  } });
  const name = field('Output filename', input('text', 'outName', 'merged.pdf'));
  const task = taskControls('merge-pdfs', 'Merge PDFs', async ({ signal, progress }) => {
    const selection = items.map((item) => ({ ...item }));
    let n = sanitizeFilename((name.querySelector('input') as HTMLInputElement).value, 'merged.pdf');
    if (!/\.pdf$/i.test(n)) n += '.pdf';
    const sources = [];
    for (const it of selection) sources.push({ bytes: await readFileBytes(it.file, signal), pages: parsePageRanges(it.range, it.pages, true) });
    const out = await mergePdfs(sources, signal, progress);
    throwIfAborted(signal); downloadBlob(bytesToBlob(out, 'application/pdf'), n);
    return `${n} (${formatBytes(out.length)}, ${sources.reduce((a, s) => a + s.pages.length, 0)} pages)`;
  }, { validate: () => (items.length < 2 ? 'Add at least two PDFs.' : null) });
  const preview = button('Preview merge', () => {
    try { if (items.length < 2) throw new Error('Add at least two PDFs.'); msg.replaceChildren(notice('info', ...items.map((it) => h('p', {}, `${it.name}: ${parsePageRanges(it.range, it.pages, true).join(', ')}`)), 'No output has been created.')); }
    catch (e) { msg.replaceChildren(notice('danger', (e as Error).message)); }
  });
  toolPage(root, 'merge-pdfs', { config: [group('Merge order', h('p', { class: 'field-hint' }, 'Reorder with the arrow buttons. Enter pages like 1-3, 5, 8- per file (blank = all).'), picker, msg, list.el), group(null, name)], actions: [preview, task.el] });
  persistForm('merge-pdfs', root);
}
