import { toolPage } from '../../application/page';
import { taskControls, persistForm, sourceSelection, operationSlot } from '../../application/tasks';
import { group } from '../../ui/layout';
import { h, field, input, select, filePicker, notice, button, rangeField, qualityScale } from '../../ui/elements';
import { clampCrop, detectUnsupportedImage, encodeCanvas, previewSize, IMAGE_ACCEPT } from '../../domain/images/operations';
import { decodeImage } from '../../domain/images/decode';
import { LIMITS } from '../../shared/limits';
import { downloadBlob, sanitizeFilename, formatBytes, throwIfAborted, suggestOutputName } from '../../shared/util';

export function mount(root: HTMLElement) {
  let bmp: ImageBitmap | null = null;
  let imageRequest = 0,
    disposed = false;
  const operation = operationSlot();
  const info = h('div');
  const f = (name: string, value: string, extra: Record<string, any> = {}) => input('number', name, value, extra);
  const cx = f('cropX', '0', { min: 0, max: 100000 }),
    cy = f('cropY', '0', { min: 0, max: 100000 }),
    cw = f('cropW', '', { min: 1, max: 20000, placeholder: 'full' }),
    ch = f('cropH', '', { min: 1, max: 20000, placeholder: 'full' });
  const cropCanvas = h('canvas', { role: 'img', 'aria-label': 'Original image with the kept crop outlined' });
  const cropOutline = h('div', { class: 'crop-outline', 'aria-hidden': true });
  const cropFrame = h('div', { class: 'crop-frame', hidden: true }, cropCanvas, cropOutline);
  const cropEmpty = h('p', { class: 'crop-empty' }, 'Choose an image to see its dimensions and the area you will keep.');
  const cropStats = h('div', { class: 'crop-stats', 'aria-live': 'polite' });
  const cropLegend = h('p', { class: 'field-hint', hidden: true }, 'The outlined area is kept. Shaded areas are removed.');
  const cropPreview = h('div', { class: 'crop-preview' }, h('strong', {}, 'Crop preview'), cropEmpty, cropFrame, cropLegend, cropStats);
  const fmt = select(
    'format',
    [
      ['image/png', 'PNG'],
      ['image/jpeg', 'JPEG'],
      ['image/webp', 'WebP'],
    ],
    'image/png',
  );
  const slider = rangeField({ id: 'crop-quality', name: 'quality', label: 'Encoding quality', value: '90', min: 1, max: 100, step: 1, footer: qualityScale() });
  const quality = slider.control,
    qualityField = slider.el;
  const name = input('text', 'outName', '', { placeholder: 'Choose a file to suggest a name' });
  const suggestName = suggestOutputName(name, 'cropped');
  function selectedCrop() {
    if (!bmp) throw new Error('Choose an image first.');
    for (const [control, min, max, blank] of [
      [cx, 0, 100000, false],
      [cy, 0, 100000, false],
      [cw, 1, 20000, true],
      [ch, 1, 20000, true],
    ] as const) {
      if (blank && control.value === '') continue;
      if (!/^\d+$/.test(control.value) || Number(control.value) < min || Number(control.value) > max) throw new Error('Use whole pixel values: sizes from 1 to 20,000, and offsets from 0 to 100,000.');
    }
    return clampCrop({ x: Number(cx.value) || 0, y: Number(cy.value) || 0, width: Number(cw.value) || bmp.width, height: Number(ch.value) || bmp.height }, bmp.width, bmp.height);
  }
  function updateCropPreview() {
    cropEmpty.hidden = !!bmp;
    cropFrame.hidden = cropLegend.hidden = !bmp;
    cropStats.replaceChildren();
    if (!bmp) {
      cropCanvas.width = cropCanvas.height = 0;
      cw.placeholder = ch.placeholder = 'full';
      return null;
    }
    let crop: ReturnType<typeof selectedCrop>;
    try {
      crop = selectedCrop();
    } catch (error) {
      cropOutline.hidden = true;
      cropStats.append(notice('warn', (error as Error).message));
      return null;
    }
    cropOutline.hidden = false;
    Object.assign(cropOutline.style, { left: `${(crop.x / bmp.width) * 100}%`, top: `${(crop.y / bmp.height) * 100}%`, width: `${(crop.width / bmp.width) * 100}%`, height: `${(crop.height / bmp.height) * 100}%` });
    cw.placeholder = String(bmp.width - crop.x);
    ch.placeholder = String(bmp.height - crop.y);
    const removed = 100 * (1 - (crop.width * crop.height) / (bmp.width * bmp.height));
    cropStats.append(
      h('div', { class: 'crop-dimensions' }, h('div', {}, h('span', {}, 'Original'), h('strong', {}, `${bmp.width} × ${bmp.height} px`)), h('div', {}, h('span', {}, 'Keep'), h('strong', {}, `${crop.width} × ${crop.height} px`))),
      h('p', { class: 'crop-removal' }, removed === 0 ? 'No cropping · the whole image is kept.' : `${removed.toFixed(1)}% of the image area removed.`),
      h('p', { class: 'crop-edges' }, `Removed from edges: left ${crop.x} px · top ${crop.y} px · right ${bmp.width - crop.x - crop.width} px · bottom ${bmp.height - crop.y - crop.height} px.`),
    );
    cropCanvas.setAttribute('aria-label', `Original ${bmp.width} by ${bmp.height} pixels. Keep ${crop.width} by ${crop.height} pixels, starting ${crop.x} pixels from the left and ${crop.y} pixels from the top.`);
    return crop;
  }

  function process() {
    if (!bmp) throw new Error('Choose an image first.');
    const crop = selectedCrop(),
      out = document.createElement('canvas');
    out.width = crop.width;
    out.height = crop.height;
    const context = out.getContext('2d')!;
    if (fmt.value === 'image/jpeg') {
      context.fillStyle = 'white';
      context.fillRect(0, 0, out.width, out.height);
    }
    context.drawImage(bmp, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return out;
  }
  const cropSection = group(
    'Crop',
    h('p', { class: 'crop-intro' }, 'Choose the width and height to keep, then set where the crop starts from the left and top edges. Measurements use the original image with camera orientation applied.'),
    h(
      'div',
      { class: 'crop-workspace' },
      h(
        'div',
        { class: 'crop-controls' },
        h('div', { class: 'option-grid' }, field('Width to keep (px)', cw), field('Height to keep (px)', ch)),
        h('div', { class: 'option-grid' }, field('Start from left (px)', cx), field('Start from top (px)', cy)),
        h('p', { class: 'field-hint' }, '0 starts at the edge. Blank width extends to the right edge; blank height extends to the bottom. Crops stay within the image.'),
        button(
          'Keep whole image',
          () => {
            cx.value = cy.value = '0';
            cw.value = ch.value = '';
            updateCropPreview();
            cx.dispatchEvent(new Event('input', { bubbles: true }));
          },
          { variant: 'secondary' },
        ),
      ),
      cropPreview,
    ),
  );
  cropSection.classList.add('crop-section');
  cropSection.addEventListener('input', updateCropPreview);
  cropSection.addEventListener('change', updateCropPreview);
  const task = taskControls(
    'crop-image',
    'Export cropped image',
    ({ signal }) =>
      operation.run(signal, async (operationSignal) => {
        const request = imageRequest;
        let out: HTMLCanvasElement | undefined;
        try {
          throwIfAborted(signal);
          out = process();
          const type = fmt.value;
          const blob = await encodeCanvas(out, type, Number(quality.value) / 100, operationSignal);
          throwIfAborted(signal);
          throwIfAborted(operationSignal);
          if (disposed || request !== imageRequest) throw new DOMException('Cancelled', 'AbortError');
          if (!blob || blob.type !== type) throw new Error('This browser cannot encode the selected format. Pick another format.');
          const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
          const filename = `${sanitizeFilename(name.value.replace(/\.(png|jpe?g|webp)$/i, ''), 'cropped')}.${extension}`;
          downloadBlob(blob, filename);
          return `${filename} (${formatBytes(blob.size)})`;
        } finally {
          if (out) out.width = out.height = 0;
        }
      }),
    {
      validate: () => {
        try {
          selectedCrop();
        } catch (error) {
          return (error as Error).message;
        }
        return name.value.trim() ? null : 'Enter an output filename.';
      },
    },
  );
  const picked = sourceSelection(suggestName, () => task.reset());
  const picker = filePicker({
    label: 'Image',
    accept: IMAGE_ACCEPT,
    onFiles: async ([fl]) => {
      if (disposed) return;
      const request = ++imageRequest;
      const sameSource = picked.begin(fl);
      info.replaceChildren();
      bmp?.close();
      bmp = null;
      updateCropPreview();
      const bad = detectUnsupportedImage(fl);
      if (bad) {
        picked.reject();
        info.append(notice('warn', bad));
        return;
      }
      if (fl.size > LIMITS.fileBytes) {
        picked.reject();
        info.append(notice('warn', `File exceeds ${formatBytes(LIMITS.fileBytes)}.`));
        return;
      }
      picked.accept(fl, sameSource);
      try {
        const decoded = await decodeImage(fl);
        if (request !== imageRequest) {
          decoded.close();
          return;
        }
        bmp = decoded;
        info.append(notice('info', `${fl.name}: ${bmp.width}×${bmp.height}. The original file is never changed.`));
        const shown = previewSize(bmp.width, bmp.height);
        cropCanvas.width = shown.width;
        cropCanvas.height = shown.height;
        cropFrame.style.maxWidth = `${cropCanvas.width}px`;
        cropCanvas.getContext('2d')!.drawImage(bmp, 0, 0, cropCanvas.width, cropCanvas.height);
        updateCropPreview();
      } catch (e) {
        if (request === imageRequest) {
          picked.reject();
          bmp?.close();
          bmp = null;
          updateCropPreview();
          info.append(notice('danger', `Cannot decode this image (${(e as Error).message}). The format may be unsupported by this browser.`));
        }
      }
    },
  });
  toolPage(root, 'crop-image', {
    config: [
      group(null, picker, info),
      cropSection,
      group(
        'Output',
        h('div', { class: 'option-grid' }, field('Output format', fmt), qualityField),
        field('Output filename (without extension)', name),
        h('p', { class: 'field-hint' }, 'Photos are rotated upright automatically. PNG/WebP keep transparency; JPEG turns it white. Camera details, location and comments are removed. Your original stays unchanged.'),
      ),
    ],
    actions: [task.el],
  });
  persistForm('crop-image', root, ['cropX', 'cropY', 'cropW', 'cropH']);
  return () => {
    disposed = true;
    imageRequest++;
    operation.abort();
    bmp?.close();
    bmp = null;
    cropCanvas.width = cropCanvas.height = 0;
  };
}
