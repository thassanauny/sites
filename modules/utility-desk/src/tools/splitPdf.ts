import { toolPage, group, outputPanel } from '../page';
import { h, field, input, select, filePicker, taskControls, notice, persistForm, button, emptyState } from '../ui';
import { splitEachPage, extractPages, pageCount } from '../lib/pdfops';
import { parsePageRanges } from '../lib/ranges';
import { makeZip } from '../lib/zip';
import { readFileBytes, downloadBlob, bytesToBlob, baseName, sanitizeFilename, MAX_FILE_BYTES, formatBytes } from '../lib/util';

export function mount(root: HTMLElement) {
  let file: File | null = null, pages = 0;
  let results: { name: string; data: Uint8Array }[] = [];
  const info = h('div', {}, emptyState('No PDF selected', 'Choose a PDF to see its page count.'));
  const results$ = h('div');
  const mode = select('mode', [['each', 'One PDF per page'], ['range', 'Extract selected pages into one PDF']], 'each');
  const range = input('text', 'range', '', { placeholder: 'e.g. 1-3, 5' });
  const showRes = () => {
    results$.replaceChildren();
    if (!results.length) return;
    results$.append(h('div', { class: 'row' }, button('Download ZIP', () => downloadBlob(bytesToBlob(makeZip(results, { store: true }), 'application/zip'), `${baseName(file!.name)}-split.zip`), { variant: 'primary' })),
      h('ul', { class: 'file-list' }, ...results.map((r) => h('li', { class: 'file-row' }, h('span', { class: 'file-name' }, `${r.name} `, h('small', { class: 'muted' }, formatBytes(r.data.length))), button('Download', () => downloadBlob(bytesToBlob(r.data, 'application/pdf'), r.name), { variant: 'ghost' })))));
  };
  const picker = filePicker({ label: 'PDF file', accept: '.pdf,application/pdf', onFiles: async ([f]) => {
    file = null; pages = 0;
    results = []; showRes();
    if (f.size > MAX_FILE_BYTES) { info.replaceChildren(notice('warn', `File exceeds ${formatBytes(MAX_FILE_BYTES)}.`)); return; }
    try { pages = await pageCount(await readFileBytes(f)); file = f; info.replaceChildren(notice('info', `${f.name}: ${pages} pages (${formatBytes(f.size)}). Original is not modified.`)); }
    catch { file = null; info.replaceChildren(notice('danger', 'Could not read this PDF (it may be encrypted or damaged).')); }
  } });
  const task = taskControls('split-pdf', 'Save PDF pages', async ({ signal, progress }) => {
    const source = file!, pageTotal = pages, saveMode = mode.value, selectedRange = range.value;
    const bytes = await readFileBytes(source, signal);
    const stem = sanitizeFilename(baseName(source.name), 'document');
    if (saveMode === 'each') {
      const selected = parsePageRanges(selectedRange, pageTotal);
      const parts = await splitEachPage(bytes, signal, progress, selected);
      const pad = String(pageTotal).length;
      results = parts.map((d, i) => ({ name: `${stem}-page-${String(selected[i]).padStart(pad, '0')}.pdf`, data: d }));
    } else {
      const sel = parsePageRanges(selectedRange, pageTotal, true);
      results = [{ name: `${stem}-pages-${selectedRange.replace(/\s+/g, '') || 'all'}.pdf`.replace(/[^\w.-]+/g, '_'), data: await extractPages(bytes, sel) }];
    }
    showRes();
    return `${results.length} file(s) ready below.`;
  }, { validate: () => (file ? null : 'Choose a PDF first.') });
  const preview = button('Preview selection', () => {
    try { if (!file) throw new Error('Choose a PDF first.'); const selected = parsePageRanges(range.value, pages, mode.value === 'range'); info.replaceChildren(notice('info', `${selected.length} pages: ${selected.join(', ')}. ${mode.value === 'each' ? 'One file per page.' : 'One PDF in this order.'}`)); }
    catch (e) { info.replaceChildren(notice('danger', (e as Error).message)); }
  });
  toolPage(root, 'split-pdf', { config: [group(null, picker, info), group(null, field('Save as', mode), field('Pages to include', range, 'Blank = all. Separate files use document order; extraction preserves order and repetitions.'))], actions: [preview, task.el], output: [outputPanel('Results', 'DOWNLOADS', results$)] });
  persistForm('split-pdf', root);
}
