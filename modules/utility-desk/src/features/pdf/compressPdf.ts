import { toolPage } from '../../application/page';
import { taskControls, persistForm, sourceSelection, operationSlot } from '../../application/tasks';
import { group } from '../../ui/layout';
import { h, field, input, select, filePicker, notice, emptyState } from '../../ui/elements';
import { compressPdf, type CompressionMode } from '../../domain/pdf/compression';
import { LIMITS } from '../../shared/limits';
import { readFileBytes, downloadBlob, bytesToBlob, sanitizeFilename, formatBytes, throwIfAborted, suggestOutputName } from '../../shared/util';

export function mount(root: HTMLElement) {
  let file: File | null = null;
  const operation = operationSlot();
  const info = h('div', {}, emptyState('No PDF selected', 'Choose a PDF to compress.'));
  const mode = select(
    'compression',
    [
      ['lossless', 'Lossless · preserve quality and text'],
      ['balanced', 'Balanced · image-only pages, 150 DPI'],
      ['small', 'Smaller file · image-only pages, 96 DPI'],
    ],
    'lossless',
  );
  const name = input('text', 'outName', '', { placeholder: 'Choose a file to suggest a name' });
  const suggestName = suggestOutputName(name, 'compressed');
  const tradeoff = h('div');
  const updateMode = () =>
    tradeoff.replaceChildren(
      notice(
        mode.value === 'lossless' ? 'info' : 'warn',
        mode.value === 'lossless' ? 'Keeps selectable text, image quality, links and forms. Already optimized PDFs may not shrink.' : 'Turns each visible page into a JPEG image. Text will no longer be selectable or searchable; links and forms become static. Use lossless compression to keep these features.',
      ),
    );
  mode.addEventListener('change', updateMode);
  updateMode();
  const picked = sourceSelection(suggestName, () => task.reset());
  const picker = filePicker({
    label: 'PDF file',
    accept: '.pdf,application/pdf',
    onFiles: ([selected]) => {
      const sameSource = picked.begin(selected);
      file = null;
      if (selected.size > LIMITS.fileBytes) {
        picked.reject();
        info.replaceChildren(notice('warn', `File exceeds ${formatBytes(LIMITS.fileBytes)}.`));
        return;
      }
      file = selected;
      picked.accept(selected, sameSource);
      info.replaceChildren(notice('info', `${selected.name} · ${formatBytes(selected.size)}. The source stays untouched.`));
    },
  });
  const task = taskControls(
    'compress-pdf',
    'Compress PDF',
    ({ signal, progress }) =>
      operation.run(signal, async (operationSignal) => {
        const source = file!,
          compression = mode.value as CompressionMode;
        const filename = sanitizeFilename(name.value, 'compressed.pdf').replace(/(?:\.pdf)?$/i, '.pdf');
        throwIfAborted(signal);
        const result = await compressPdf(await readFileBytes(source, operationSignal), compression, operationSignal, progress);
        throwIfAborted(signal);
        throwIfAborted(operationSignal);
        downloadBlob(bytesToBlob(result.bytes, 'application/pdf'), filename);
        const message = result.unchanged ? 'No size reduction with these settings. An unchanged copy downloaded.' : `Saved ${formatBytes(result.savedBytes)} (${result.savedPercent.toFixed(1)}%). PDF downloaded.`;
        return `${message} Original: ${formatBytes(result.originalSize)} → Output: ${formatBytes(result.bytes.length)} · ${result.pages} pages`;
      }),
    { validate: () => (file ? (name.value.trim() ? null : 'Enter an output filename.') : 'Choose a PDF first.') },
  );
  toolPage(root, 'compress-pdf', { config: [group(null, picker, info), group(null, field('Compression', mode), tradeoff, field('Output filename (without extension)', name))], actions: [task.el] });
  persistForm('compress-pdf', root);
  return () => {
    operation.abort();
    file = null;
  };
}
