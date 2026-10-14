import { toolPage } from '../../application/page';
import { taskControls, persistForm, sourceSelection } from '../../application/tasks';
import { h, field, input, select, filePicker, notice, emptyState } from '../../ui/elements';
import { group } from '../../ui/layout';
import { splitPages, extractPages, pageCount } from '../../domain/pdf/operations';
import { parsePageRanges } from '../../domain/pdf/ranges';
import { zipWriter } from '../../shared/zip';
import { LIMITS } from '../../shared/limits';
import { readFileBytes, downloadBlob, bytesToBlob, baseName, sanitizeFilename, formatBytes, throwIfAborted } from '../../shared/util';

export function mount(root: HTMLElement) {
  let file: File | null = null,
    pages = 0;
  let selectionRequest = 0;
  const info = h('div', {}, emptyState('No PDF selected', 'Choose a PDF to see its page count.'));
  const mode = select(
    'mode',
    [
      ['each', 'One PDF per page'],
      ['range', 'Extract selected pages into one PDF'],
    ],
    'each',
  );
  const range = input('text', 'range', '', { placeholder: 'e.g. 1-3, 5' });
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
      file = null;
      pages = 0;
      info.replaceChildren();
      if (f.size > LIMITS.fileBytes) {
        picked.reject();
        info.replaceChildren(notice('warn', `File exceeds ${formatBytes(LIMITS.fileBytes)}.`));
        return;
      }
      try {
        const count = await pageCount(await readFileBytes(f));
        if (request !== selectionRequest) return;
        pages = count;
        file = f;
        picked.accept(f, same);
        info.replaceChildren(notice('info', `${f.name}: ${pages} pages (${formatBytes(f.size)}). Original is not modified.`));
      } catch {
        if (request !== selectionRequest) return;
        picked.reject();
        info.replaceChildren(notice('danger', 'Could not read this PDF (it may be encrypted or damaged).'));
      }
    },
  });
  const task = taskControls(
    'split-pdf',
    'Save PDF pages',
    async ({ signal, progress }) => {
      const source = file!,
        pageTotal = pages,
        saveMode = mode.value,
        selectedRange = range.value;
      const bytes = await readFileBytes(source, signal);
      const stem = sanitizeFilename(baseName(source.name), 'document');
      let name: string,
        blob: Blob,
        count = 1;
      if (saveMode === 'each') {
        const selected = parsePageRanges(selectedRange, pageTotal);
        const pad = String(pageTotal).length;
        const partName = (page: number) => `${stem}-page-${String(page).padStart(pad, '0')}.pdf`;
        // Several pages go straight into the archive, so the saved pages are never held twice.
        const archive = selected.length > 1 ? zipWriter() : null;
        const single: Uint8Array[] = [];
        await splitPages(
          bytes,
          (part, page) => {
            if (!archive) {
              single.push(part);
              return;
            }
            archive.add(partName(page), part);
            if (archive.size > LIMITS.totalBytes) throw new Error(`The page files exceed ${formatBytes(LIMITS.totalBytes)}. Select fewer pages.`);
          },
          signal,
          progress,
          selected,
        );
        count = selected.length;
        [name, blob] = archive ? [`${stem}-split.zip`, archive.finish()] : [partName(selected[0]), bytesToBlob(single[0], 'application/pdf')];
      } else {
        const selection = parsePageRanges(selectedRange, pageTotal, true);
        name = `${stem}-pages-${selectedRange.replace(/\s+/g, '') || 'all'}.pdf`.replace(/[^\w.-]+/g, '_');
        blob = bytesToBlob(await extractPages(bytes, selection, signal, progress), 'application/pdf');
      }
      throwIfAborted(signal);
      downloadBlob(blob, name);
      return `${count} PDF file(s) downloaded${count > 1 ? ' as ZIP' : ''}.`;
    },
    { validate: () => (file ? null : 'Choose a PDF first.') },
  );
  toolPage(root, 'split-pdf', { config: [group(null, picker, info), group(null, field('Save as', mode), field('Pages to include', range, 'Blank = all. Separate files use document order; extraction preserves order and repetitions.'))], actions: [task.el] });
  persistForm('split-pdf', root, ['range']);
  return () => {
    selectionRequest++;
    file = null;
    pages = 0;
  };
}
