import { toolPage } from '../../application/page';
import { taskControls, persistForm, operationSlot } from '../../application/tasks';
import { group } from '../../ui/layout';
import { h, field, input, select, filePicker, fileList, notice } from '../../ui/elements';
import { imagesToPdf, type PageSizeName, type Fit, type PdfImage } from '../../domain/pdf/operations';
import { detectUnsupportedImage, IMAGE_ACCEPT } from '../../domain/images/operations';
import { toPdfImage } from '../../domain/images/pdfImage';
import { LIMITS } from '../../shared/limits';
import { downloadBlob, bytesToBlob, sanitizeFilename, formatBytes, throwIfAborted, suggestOutputName } from '../../shared/util';

export function mount(root: HTMLElement) {
  const items: { name: string; size: number; file: File }[] = [];
  const operation = operationSlot();
  const msg = h('div');
  // The status line describes the list it was produced from, so any change to the list clears it.
  const listChanged = () => {
    syncName();
    task.reset();
  };
  const list = fileList(items, listChanged);
  const picker = filePicker({
    label: 'Add images',
    accept: IMAGE_ACCEPT,
    multiple: true,
    onFiles: (files) => {
      msg.replaceChildren();
      for (const f of files) {
        const bad = detectUnsupportedImage(f);
        if (bad) {
          msg.append(notice('warn', `${f.name}: ${bad}`));
          continue;
        }
        if (items.length >= LIMITS.files || f.size > LIMITS.fileBytes || items.reduce((n, i) => n + i.size, 0) + f.size > LIMITS.totalBytes) {
          msg.append(notice('warn', `${f.name} skipped: maximum ${LIMITS.files} images, ${formatBytes(LIMITS.fileBytes)} each, ${formatBytes(LIMITS.totalBytes)} total.`));
          continue;
        }
        items.push({ name: f.name, size: f.size, file: f });
      }
      list.refresh();
      listChanged();
    },
  });
  const size = select(
    'pageSize',
    [
      ['A4', 'A4'],
      ['Letter', 'Letter'],
      ['Fit', 'Match each image'],
    ],
    'A4',
  );
  const orient = select(
    'orientation',
    [
      ['auto', 'Auto'],
      ['portrait', 'Portrait'],
      ['landscape', 'Landscape'],
    ],
    'auto',
  );
  const updateOrientation = () => {
    orient.disabled = size.value === 'Fit';
  };
  size.addEventListener('change', updateOrientation);
  const fit = select(
    'fit',
    [
      ['contain', 'Fit inside'],
      ['cover', 'Fill (crop)'],
      ['stretch', 'Stretch'],
      ['original', 'Original size at DPI'],
    ],
    'contain',
  );
  const dpi = input('number', 'dpi', '150', { min: 72, max: 600 });
  const margin = input('number', 'margin', '0', { min: 0, max: 144 });
  const name = input('text', 'outName', '', { placeholder: 'Choose a file to suggest a name' });
  const suggestName = suggestOutputName(name, 'images');
  let firstSource: File | undefined;
  function syncName() {
    const source = items[0]?.file;
    if (source === firstSource) return;
    firstSource = source;
    suggestName(source?.name);
  }
  const task = taskControls(
    'images-to-pdf',
    'Create PDF',
    ({ signal, progress }) =>
      operation.run(signal, async (operationSignal) => {
        const sources = items.map((item) => item.file);
        const options = { pageSize: size.value as PageSizeName, orientation: orient.value as 'portrait' | 'landscape' | 'auto', fit: fit.value as Fit, dpi: Number(dpi.value), marginPt: Number(margin.value) || 0 };
        let n = sanitizeFilename(name.value, 'images.pdf');
        if (!/\.pdf$/i.test(n)) n += '.pdf';
        const imgs: PdfImage[] = [];
        let converted = 0;
        try {
          throwIfAborted(signal);
          for (let i = 0; i < sources.length; i++) {
            throwIfAborted(operationSignal);
            const image = await toPdfImage(sources[i], operationSignal);
            converted += image.bytes.length;
            if (converted > LIMITS.totalBytes) throw new Error(`The converted images exceed ${formatBytes(LIMITS.totalBytes)}. Add fewer or smaller images.`);
            imgs.push(image);
            progress((i / sources.length) * 0.5);
          }
          const out = await imagesToPdf(imgs, options, operationSignal, (p) => progress(0.5 + p / 2));
          throwIfAborted(signal);
          throwIfAborted(operationSignal);
          downloadBlob(bytesToBlob(out, 'application/pdf'), n);
          return `${n} (${formatBytes(out.length)}, ${sources.length} pages)`;
        } finally {
          imgs.length = 0;
        }
      }),
    { validate: () => (!items.length ? 'Add at least one image.' : !Number.isInteger(Number(dpi.value)) || Number(dpi.value) < 72 || Number(dpi.value) > 600 ? 'DPI must be a whole number from 72 to 600.' : Number(margin.value) < 0 || Number(margin.value) > 144 ? 'Margin must be from 0 to 144 points.' : null) },
  );
  toolPage(root, 'images-to-pdf', {
    config: [
      group('Image order', h('p', { class: 'field-hint' }, 'Reorder with the arrow buttons. HEIC/TIFF are unavailable. Camera orientation is applied, transparency flattened onto white, and metadata removed. JPEG photos stay JPEG (quality 92) in the PDF; other formats are stored losslessly.'), picker, msg, list.el),
      group(
        'Page settings',
        h('div', { class: 'option-grid' }, field('Page size', size), field('Orientation', orient)),
        h('p', { class: 'field-hint' }, 'Auto follows each image’s proportions. Orientation applies to A4 and Letter; Match each image keeps the image’s dimensions.'),
        h('div', { class: 'option-grid' }, field('Image fitting', fit), field('DPI', dpi)),
        field('Margin (pt)', margin),
      ),
      group(null, field('Output filename (without extension)', name)),
    ],
    actions: [task.el],
  });
  persistForm('images-to-pdf', root);
  updateOrientation();
  return () => {
    operation.abort();
    items.length = 0;
  };
}
