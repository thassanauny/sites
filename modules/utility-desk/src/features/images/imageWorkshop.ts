import { toolPage } from '../../application/page';
import { taskControls, persistForm, operationSlot } from '../../application/tasks';
import { group } from '../../ui/layout';
import { h, field, input, select, filePicker, notice, button, option, rangeField } from '../../ui/elements';
import { encodeCanvas, grayscale, sepia, contrast, autoContrast, sharpen, rotatedSize, detectUnsupportedImage, previewSize, IMAGE_ACCEPT } from '../../domain/images/operations';
import { decodeImage } from '../../domain/images/decode';
import { LIMITS } from '../../shared/limits';
import { downloadBlob, baseName, sanitizeFilename, formatBytes, throwIfAborted } from '../../shared/util';

/** Long edge of the reduced copy that live previews work on, so slider edits do not reprocess a full-size photo. */
const PREVIEW_EDGE = 1200;

export function mount(root: HTMLElement) {
  let file: File | null = null;
  let bmp: ImageBitmap | null = null;
  let working: HTMLCanvasElement | null = null;
  let imageRequest = 0,
    disposed = false;
  const operation = operationSlot();
  const info = h('div'),
    canvas = h('canvas', { class: 'preview-img', 'aria-label': 'Edited image preview', role: 'img', width: 0, height: 0 });
  const previewFrame = h('div', { class: 'image-frame', hidden: true }, canvas);
  const previewEmpty = h('p', { class: 'image-empty' }, 'Choose an image to preview your edits.');
  const previewStats = h('div', { class: 'image-preview-stats', 'aria-live': 'polite' });
  const previewNote = h('p', { class: 'field-hint', hidden: true }, 'This image is large, so the preview works on a reduced copy. The saved file uses the full resolution.');
  const preview = h('div', { class: 'image-preview' }, h('strong', {}, 'Edited preview'), previewEmpty, previewFrame, previewStats, previewNote);
  const auto = input('checkbox', 'autoContrast');
  const rot = select(
    'rotate',
    [
      ['0', 'No rotation'],
      ['90', '90°'],
      ['180', '180°'],
      ['270', '270°'],
    ],
    '0',
  );
  const flip = select(
    'flip',
    [
      ['none', 'No flip'],
      ['horizontal', 'Horizontal'],
      ['vertical', 'Vertical'],
      ['both', 'Both'],
    ],
    'none',
  );
  const colorStyle = select(
    'colorStyle',
    [
      ['original', 'Original colors'],
      ['grayscale', 'Grayscale'],
      ['sepia', 'Sepia'],
    ],
    'original',
  );
  const contrastSlider = rangeField({ id: 'workshop-contrast', name: 'contrast', label: 'Contrast', value: '0', min: -100, max: 100, footer: h('p', { class: 'field-hint' }, '-100 to 100. Zero leaves it unchanged.') });
  const con = contrastSlider.control,
    contrastField = contrastSlider.el;
  const sharp = input('checkbox', 'sharpen');
  const fmt = select(
    'format',
    [
      ['image/png', 'PNG'],
      ['image/jpeg', 'JPEG'],
      ['image/webp', 'WebP'],
    ],
    'image/png',
  );
  /** Apply the edits to `source` (the full image for export, the reduced copy for live previews). */
  function process(source: ImageBitmap | HTMLCanvasElement | null = bmp): HTMLCanvasElement {
    if (!source) throw new Error('Choose an image first.');
    const deg = Number(rot.value);
    const [ow, oh] = rotatedSize(source.width, source.height, deg);
    if (ow * oh > LIMITS.imagePixels) throw new Error('Output would be too large for browser memory. Reduce the size.');
    const output = document.createElement('canvas');
    output.width = ow;
    output.height = oh;
    try {
      const og = output.getContext('2d', { willReadFrequently: true });
      if (!og) throw new Error('This browser cannot process images.');
      og.imageSmoothingQuality = 'high';
      og.translate(ow / 2, oh / 2);
      og.scale(flip.value === 'horizontal' || flip.value === 'both' ? -1 : 1, flip.value === 'vertical' || flip.value === 'both' ? -1 : 1);
      og.rotate((deg * Math.PI) / 180);
      og.drawImage(source, 0, 0, source.width, source.height, -source.width / 2, -source.height / 2, source.width, source.height);
      og.setTransform(1, 0, 0, 1, 0, 0);
      if (colorStyle.value === 'grayscale' || colorStyle.value === 'sepia' || Number(con.value) || sharp.checked || auto.checked) {
        const img = og.getImageData(0, 0, output.width, output.height);
        if (sharp.checked) sharpen(img.data, output.width, output.height, 0.5);
        if (auto.checked) autoContrast(img.data);
        if (Number(con.value)) contrast(img.data, Number(con.value));
        if (colorStyle.value === 'grayscale') grayscale(img.data);
        else if (colorStyle.value === 'sepia') sepia(img.data);
        og.putImageData(img, 0, 0);
      }
      if (fmt.value === 'image/jpeg') {
        og.globalCompositeOperation = 'destination-over';
        og.fillStyle = 'white';
        og.fillRect(0, 0, output.width, output.height);
        og.globalCompositeOperation = 'source-over';
      }
      return output;
    } catch (error) {
      output.width = output.height = 0;
      throw error;
    }
  }
  function reducedCopy(source: ImageBitmap): HTMLCanvasElement | null {
    const scale = PREVIEW_EDGE / Math.max(source.width, source.height);
    if (scale >= 1) return null;
    const copy = document.createElement('canvas');
    copy.width = Math.max(1, Math.round(source.width * scale));
    copy.height = Math.max(1, Math.round(source.height * scale));
    const context = copy.getContext('2d');
    if (!context) return null;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, copy.width, copy.height);
    return copy;
  }
  function clearPreview() {
    canvas.width = canvas.height = 0;
    previewFrame.hidden = true;
    previewEmpty.hidden = false;
    previewNote.hidden = true;
    previewStats.replaceChildren();
    if (working) working.width = working.height = 0;
    working = null;
  }
  const refresh = () => {
    if (disposed) return;
    if (!bmp) return;
    info.querySelector('.err')?.remove();
    previewStats.replaceChildren();
    previewEmpty.hidden = true;
    let out: HTMLCanvasElement | undefined;
    try {
      out = process(working ?? bmp);
      const g = canvas.getContext('2d');
      if (!g) throw new Error('This browser cannot preview images.');
      const [outputWidth, outputHeight] = rotatedSize(bmp.width, bmp.height, Number(rot.value));
      const shown = previewSize(out.width, out.height);
      canvas.width = shown.width;
      canvas.height = shown.height;
      g.drawImage(out, 0, 0, canvas.width, canvas.height);
      previewFrame.style.maxWidth = `${canvas.width}px`;
      previewFrame.hidden = false;
      previewNote.hidden = !working;
      canvas.setAttribute('aria-label', `Edited output ${outputWidth} by ${outputHeight} pixels. Original ${bmp.width} by ${bmp.height} pixels.`);
      previewStats.append(h('div', { class: 'image-preview-dimensions' }, h('div', {}, h('span', {}, 'Original'), h('strong', {}, `${bmp.width} × ${bmp.height} px`)), h('div', {}, h('span', {}, 'Output'), h('strong', {}, `${outputWidth} × ${outputHeight} px`))));
    } catch (e) {
      canvas.width = canvas.height = 0;
      previewFrame.hidden = true;
      previewStats.append(notice('danger', (e as Error).message));
    } finally {
      if (out) out.width = out.height = 0;
    }
  };
  let t: ReturnType<typeof setTimeout>;
  const edits = h(
    'div',
    {
      class: 'image-controls',
      oninput: () => {
        clearTimeout(t);
        t = setTimeout(refresh, 120);
      },
      onchange: () => {
        clearTimeout(t);
        refresh();
      },
    },
    group('Orientation', h('p', { class: 'field-hint' }, 'Camera orientation is corrected automatically.'), h('div', { class: 'option-grid' }, field('Rotate clockwise', rot), field('Flip', flip))),
    group('Color & detail', field('Color style', colorStyle), contrastField, option('Automatic contrast', 'Expand the image’s color range.', auto), option('Sharpen details', 'Apply light sharpening.', sharp)),
  );
  const task = taskControls(
    'image-workshop',
    'Export image',
    ({ signal }) =>
      operation.run(signal, async (operationSignal) => {
        const request = imageRequest;
        const stem = sanitizeFilename(baseName(file!.name), 'image');
        const type = fmt.value;
        const checkCurrent = () => {
          throwIfAborted(signal);
          throwIfAborted(operationSignal);
          if (disposed || request !== imageRequest) throw new DOMException('Cancelled', 'AbortError');
        };
        let c: HTMLCanvasElement | undefined;
        clearTimeout(t);
        try {
          checkCurrent();
          c = process();
          const blob = await encodeCanvas(c, type, 0.9, operationSignal);
          checkCurrent();
          if (!blob || blob.type !== type) throw new Error(`This browser cannot encode ${type}. Pick another format.`);
          const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
          const name = sanitizeFilename(`${stem}-edited.${ext}`);
          downloadBlob(blob, name);
          return `${name} (${formatBytes(blob.size)})`;
        } finally {
          if (c) c.width = c.height = 0;
        }
      }),
    { validate: () => (bmp ? null : 'Choose an image first.') },
  );
  const picker = filePicker({
    label: 'Image',
    accept: IMAGE_ACCEPT,
    onFiles: async ([fl]) => {
      if (disposed) return;
      const request = ++imageRequest;
      clearTimeout(t);
      operation.abort();
      task.reset();
      info.replaceChildren();
      bmp?.close();
      bmp = null;
      file = null;
      clearPreview();
      const bad = detectUnsupportedImage(fl);
      if (bad) {
        info.append(notice('warn', bad));
        return;
      }
      if (fl.size > LIMITS.fileBytes) {
        info.append(notice('warn', `File exceeds ${formatBytes(LIMITS.fileBytes)}.`));
        return;
      }
      try {
        const decoded = await decodeImage(fl);
        if (disposed || request !== imageRequest) {
          decoded.close();
          return;
        }
        bmp = decoded;
        file = fl;
        working = reducedCopy(decoded);
        info.append(notice('info', `${fl.name}: ${bmp.width}×${bmp.height}. The original file is never changed.`));
        refresh();
      } catch (e) {
        if (!disposed && request === imageRequest) {
          info.append(notice('danger', `Cannot decode this image (${(e as Error).message}). The format may be unsupported by this browser.`));
        }
      }
    },
  });
  const resetBtn = button(
    'Reset edits',
    () => {
      clearTimeout(t);
      root.querySelectorAll<HTMLInputElement>('[name]').forEach((e) => {
        if (e.type === 'checkbox') e.checked = false;
        else if (e.name === 'contrast') e.value = '0';
        else if (e.tagName === 'SELECT' && e.name === 'rotate') e.value = '0';
        else if (e.name === 'flip') e.value = 'none';
        else if (e.name === 'colorStyle') e.value = 'original';
      });
      contrastSlider.update();
      root.dispatchEvent(new Event('change', { bubbles: true }));
      refresh();
    },
    { variant: 'secondary' },
  );
  fmt.addEventListener('change', refresh);
  const workspace = group('Image edits', h('div', { class: 'image-workspace' }, edits, preview));
  workspace.classList.add('image-section');
  toolPage(root, 'image-workshop', {
    config: [
      group(null, picker, info),
      workspace,
      group(
        'Output',
        field('Output format', fmt),
        h('p', { class: 'field-hint' }, 'JPEG/WebP export uses high quality. Use ', h('a', { href: '#/compress-image' }, 'Compress Image'), ' to resize, choose compression quality or set a maximum file size.'),
        notice('info', 'Camera orientation is applied by the browser. Canvas export removes source metadata; retaining EXIF and profiles is unavailable. TIFF, GIF, BMP and AVIF encoding are unavailable in this edition.'),
      ),
    ],
    actions: [task.el, resetBtn],
  });
  persistForm('image-workshop', root);
  contrastSlider.update();
  return () => {
    disposed = true;
    imageRequest++;
    clearTimeout(t);
    operation.abort();
    bmp?.close();
    bmp = null;
    file = null;
    clearPreview();
  };
}
