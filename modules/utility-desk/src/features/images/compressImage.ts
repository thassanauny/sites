import { toolPage } from '../../application/page';
import { taskControls, persistForm, sourceSelection, operationSlot } from '../../application/tasks';
import { group } from '../../ui/layout';
import { h, field, input, select, filePicker, notice, emptyState, option, rangeField, qualityScale } from '../../ui/elements';
import { encodeCanvas, encodeWithinLimit, sizeImage, type Sizing, detectUnsupportedImage, previewSize, IMAGE_ACCEPT } from '../../domain/images/operations';
import { decodeImage } from '../../domain/images/decode';
import { LIMITS } from '../../shared/limits';
import { downloadBlob, sanitizeFilename, formatBytes, throwIfAborted, suggestOutputName } from '../../shared/util';

export function mount(root: HTMLElement) {
  let file: File | null = null,
    bitmap: ImageBitmap | null = null;
  let imageRequest = 0,
    disposed = false;
  const operation = operationSlot();
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  let limitController: AbortController | null = null;
  let limitGeneration = 0;
  const info = h('div', {}, emptyState('No image selected', 'Choose an image to compress.'));
  const previewCanvas = h('canvas', { role: 'img', 'aria-label': 'Image sizing preview', width: 0, height: 0 });
  const previewFrame = h('div', { class: 'image-frame', hidden: true }, previewCanvas);
  const previewEmpty = h('p', { class: 'image-empty' }, 'Choose an image to preview its size and padding.');
  const previewStats = h('div', { class: 'image-preview-stats', 'aria-live': 'polite' });
  const previewHint = h('p', { class: 'field-hint', hidden: true }, 'Shows sizing and transparency. Compression quality and final file size are checked when you export.');
  const preview = h('div', { class: 'image-preview' }, h('strong', {}, 'Image preview'), previewEmpty, previewFrame, previewStats, previewHint);
  const resize = input('checkbox', 'resize');
  const sizing = select(
    'sizing',
    [
      ['maximum', 'Maximum size · keep proportions'],
      ['cover', 'Exact size · crop to fit'],
      ['contain', 'Exact size · add padding'],
      ['stretch', 'Exact size · stretch'],
    ],
    'maximum',
  );
  const width = input('number', 'width', '', { min: 1, max: 20000, step: 1, placeholder: 'auto' });
  const height = input('number', 'height', '', { min: 1, max: 20000, step: 1, placeholder: 'auto' });
  const enlarge = input('checkbox', 'enlarge');
  const enlargeField = option('Allow enlargement', 'Let maximum sizing make a smaller image larger.', enlarge);
  const padding = select(
    'padding',
    [
      ['white', 'White'],
      ['black', 'Black'],
      ['transparent', 'Transparent'],
    ],
    'white',
  );
  const paddingField = field('Padding color', padding);
  const resizeHint = h('p', { class: 'field-hint' });
  const dimensions = h('p', { class: 'field-hint image-dimensions', 'aria-live': 'polite' });
  const resizeBox = h('div', {}, field('Sizing method', sizing), h('div', { class: 'option-grid' }, field('Width (pixels)', width), field('Height (pixels)', height)), enlargeField, paddingField, resizeHint);
  const format = select(
    'format',
    [
      ['image/png', 'PNG'],
      ['image/jpeg', 'JPEG'],
      ['image/webp', 'WebP'],
    ],
    'image/jpeg',
  );
  const slider = rangeField({ id: 'compress-image-quality', name: 'quality', label: 'Encoding quality', value: '75', min: 1, max: 100, step: 1, footer: qualityScale() });
  const quality = slider.control,
    qualityField = slider.el;
  const limit = input('checkbox', 'limitSize');
  const maxSize = input('number', 'maxSize', '500', { min: 1, step: 'any' });
  const sizeUnit = select(
    'sizeUnit',
    [
      ['kb', 'KB'],
      ['mb', 'MB'],
    ],
    'kb',
  );
  const limitStatus = h('p', { id: 'compress-image-limit-status', class: 'field-hint', 'aria-live': 'polite', hidden: true });
  const sizeBox = h(
    'div',
    {},
    h('div', { class: 'option-grid' }, field('Maximum file size', maxSize), field('Size unit', sizeUnit)),
    h('p', { class: 'field-hint' }, '1 KB = 1,000 bytes. JPEG/WebP quality is lowered within your chosen output dimensions. PNG must meet the limit with lossless encoding. If the limit cannot be met, no file is saved.'),
    limitStatus,
  );
  const tradeoff = h('div');
  const name = input('text', 'outName', '', { placeholder: 'Choose a file to suggest a name' });
  const suggestName = suggestOutputName(name, 'compressed');
  const updateSettings = () => {
    slider.update();
    quality.disabled = format.value === 'image/png';
    resizeBox.hidden = !resize.checked;
    enlargeField.hidden = sizing.value !== 'maximum';
    paddingField.hidden = sizing.value !== 'contain';
    resizeHint.textContent =
      sizing.value === 'maximum'
        ? 'Enter a width, height, or both as maximum bounds. Proportions stay the same. Use whole pixels from 1 to 20,000.'
        : sizing.value === 'cover'
          ? 'Enter both dimensions. The image fills the exact size with its proportions kept; edges are cropped to fit. Use whole pixels from 1 to 20,000.'
          : sizing.value === 'contain'
            ? 'Enter both dimensions. The whole image fits inside the exact size with its proportions kept; padding fills the remaining space. JPEG makes transparent areas white. Use whole pixels from 1 to 20,000.'
            : 'Enter both dimensions. The image stretches to the exact size; its proportions may change. Use whole pixels from 1 to 20,000.';
    sizeBox.hidden = !limit.checked;
    const message =
      format.value === 'image/png'
        ? 'PNG is lossless: quality settings do not reduce its size, and the file may grow. PNG keeps transparency. Choose JPEG or WebP for stronger compression.'
        : `${format.value === 'image/jpeg' ? 'JPEG makes transparent areas white.' : 'WebP keeps transparency.'} Lower quality can reduce fine detail. Dimensions stay unchanged unless Resize image is enabled; already compressed images may not shrink.`;
    tradeoff.replaceChildren(notice(format.value === 'image/png' ? 'warn' : 'info', message));
    updateDimensions();
    updatePreview();
    scheduleLimitCheck();
  };
  for (const control of [format, quality, limit, resize, sizing, width, height, enlarge, padding]) control.addEventListener('change', updateSettings);
  quality.addEventListener('input', updateSettings);
  width.addEventListener('input', updateSettings);
  height.addEventListener('input', updateSettings);
  maxSize.addEventListener('input', updateSettings);
  maxSize.addEventListener('change', updateSettings);
  sizeUnit.addEventListener('change', updateSettings);
  updateSettings();

  function selectedLayout(source = bitmap) {
    if (!source) throw new Error('Choose an image first.');
    const mode = resize.checked ? (sizing.value as Sizing) : 'maximum';
    const targetWidth = resize.checked && width.value ? Number(width.value) : undefined;
    const targetHeight = resize.checked && height.value ? Number(height.value) : undefined;
    if (resize.checked && mode === 'maximum' && targetWidth === undefined && targetHeight === undefined) throw new Error('Enter a width, height, or both.');
    if (resize.checked && mode !== 'maximum' && (targetWidth === undefined || targetHeight === undefined)) throw new Error('Exact sizing requires both width and height.');
    const layout = sizeImage(source.width, source.height, targetWidth, targetHeight, mode, resize.checked && enlarge.checked);
    if (layout.width * layout.height > LIMITS.imagePixels) throw new Error('Output would be too large for browser memory. Reduce the dimensions.');
    return layout;
  }
  function updateDimensions() {
    if (!resize.checked) {
      dimensions.textContent = bitmap ? `Keep original dimensions · ${bitmap.width} × ${bitmap.height} pixels.` : 'Keep original dimensions.';
      return;
    }
    if (!bitmap) {
      dimensions.textContent = 'Choose an image to see its output dimensions.';
      return;
    }
    try {
      const layout = selectedLayout();
      dimensions.textContent = `Output dimensions: ${layout.width} × ${layout.height} pixels · Original: ${bitmap.width} × ${bitmap.height} pixels.`;
    } catch (error) {
      dimensions.textContent = (error as Error).message;
    }
  }
  function drawLayout(canvas: HTMLCanvasElement, source: ImageBitmap, layout: ReturnType<typeof sizeImage>, type: string) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot process images.');
    const sx = canvas.width / layout.width,
      sy = canvas.height / layout.height;
    const x = layout.x * sx,
      y = layout.y * sy,
      drawWidth = layout.drawWidth * sx,
      drawHeight = layout.drawHeight * sy;
    context.imageSmoothingQuality = 'high';
    if (type === 'image/jpeg') {
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (resize.checked && sizing.value === 'contain' && padding.value !== 'transparent') {
      // Paint only the padding bands, leaving source transparency intact.
      context.fillStyle = padding.value;
      context.fillRect(0, 0, canvas.width, y);
      context.fillRect(0, y + drawHeight, canvas.width, canvas.height - y - drawHeight);
      context.fillRect(0, y, x, drawHeight);
      context.fillRect(x + drawWidth, y, canvas.width - x - drawWidth, drawHeight);
    }
    context.drawImage(source, x, y, drawWidth, drawHeight);
  }
  function updatePreview() {
    previewCanvas.width = previewCanvas.height = 0;
    previewFrame.hidden = previewHint.hidden = true;
    previewEmpty.hidden = !!bitmap;
    previewStats.replaceChildren();
    if (!bitmap) return;
    try {
      const layout = selectedLayout();
      const shown = previewSize(layout.width, layout.height);
      previewCanvas.width = shown.width;
      previewCanvas.height = shown.height;
      drawLayout(previewCanvas, bitmap, layout, format.value);
      previewFrame.style.maxWidth = `${previewCanvas.width}px`;
      previewFrame.hidden = previewHint.hidden = false;
      previewCanvas.setAttribute('aria-label', `Output ${layout.width} by ${layout.height} pixels. Original ${bitmap.width} by ${bitmap.height} pixels.`);
      previewStats.append(h('div', { class: 'image-preview-dimensions' }, h('div', {}, h('span', {}, 'Original'), h('strong', {}, `${bitmap.width} × ${bitmap.height} px`)), h('div', {}, h('span', {}, 'Output'), h('strong', {}, `${layout.width} × ${layout.height} px`))));
    } catch (error) {
      previewCanvas.width = previewCanvas.height = 0;
      previewStats.append(notice('warn', (error as Error).message));
    }
  }

  function selectedQuality() {
    if (format.value === 'image/png') return 0.9;
    const value = Number(quality.value);
    if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('Choose an encoding quality from 1 to 100.');
    return value / 100;
  }
  function maximumBytes() {
    if (!limit.checked) return undefined;
    const bytes = Math.floor(Number(maxSize.value) * (sizeUnit.value === 'mb' ? 1_000_000 : 1000));
    if (!(bytes >= 1000 && bytes <= 1_000_000_000)) throw new Error('Enter a size from 1 KB to 1,000 MB.');
    return bytes;
  }
  function cancelLimitCheck(clear = true) {
    clearTimeout(limitTimer);
    limitController?.abort();
    limitController = null;
    limitGeneration++;
    if (clear) {
      limitStatus.hidden = true;
      limitStatus.textContent = '';
      limitStatus.className = 'field-hint';
    }
  }
  function scheduleLimitCheck() {
    cancelLimitCheck();
    if (!limit.checked || !bitmap || disposed || operation.active) return;
    limitStatus.hidden = false;
    let layout: ReturnType<typeof selectedLayout>, bytes: number, startQuality: number;
    try {
      layout = selectedLayout();
      bytes = maximumBytes()!;
      startQuality = selectedQuality();
    } catch (error) {
      limitStatus.className = 'notice notice-warn';
      limitStatus.textContent = (error as Error).message;
      return;
    }
    limitStatus.textContent = 'Checking file size limit…';
    const generation = limitGeneration,
      source = bitmap,
      type = format.value;
    limitTimer = setTimeout(async () => {
      const controller = new AbortController();
      limitController = controller;
      const canvas = document.createElement('canvas');
      const current = () => !disposed && generation === limitGeneration && !controller.signal.aborted;
      try {
        canvas.width = layout.width;
        canvas.height = layout.height;
        drawLayout(canvas, source, layout, type);
        const encode = async (value: number) => {
          const blob = await encodeCanvas(canvas, type, value, controller.signal);
          throwIfAborted(controller.signal);
          if (!blob || blob.type !== type) throw new Error('This browser cannot encode the selected format. Pick another format.');
          return blob;
        };
        const first = await encode(startQuality);
        if (first.size > bytes) {
          if (type === 'image/png') throw new Error('PNG is lossless and exceeds the file size limit. Choose JPEG or WebP, or raise the limit. Nothing was saved.');
          const floor = await encode(0.01);
          if (floor.size > bytes) throw new Error('Cannot reach that file size by lowering quality. Reduce the dimensions or raise the limit. Nothing was saved.');
        }
        if (current()) limitStatus.textContent = 'This image can fit the selected file size limit.';
      } catch (error) {
        if (current()) {
          limitStatus.className = 'notice notice-warn';
          limitStatus.textContent = (error as Error).message;
        }
      } finally {
        canvas.width = canvas.height = 0;
        if (limitController === controller) limitController = null;
      }
    }, 350);
  }
  root.addEventListener('utility-desk:leave', () => cancelLimitCheck(), { once: true });
  const task = taskControls(
    'compress-image',
    'Compress Image',
    async ({ signal, progress }) => {
      cancelLimitCheck(false);
      const source = file!,
        decoded = bitmap!,
        request = imageRequest;
      const type = format.value,
        startQuality = selectedQuality(),
        maxBytes = maximumBytes();
      const layout = selectedLayout(decoded);
      const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
      const filename = `${sanitizeFilename(name.value.replace(/\.(png|jpe?g|webp)$/i, ''), 'compressed')}.${extension}`;
      try {
        return await operation.run(signal, async (operationSignal) => {
          const checkCurrent = () => {
            throwIfAborted(signal);
            throwIfAborted(operationSignal);
            if (disposed || request !== imageRequest) throw new DOMException('Cancelled', 'AbortError');
          };
          const canvas = document.createElement('canvas');
          try {
            checkCurrent();
            progress(0.1, 'Preparing image…');
            canvas.width = layout.width;
            canvas.height = layout.height;
            drawLayout(canvas, decoded, layout, type);
            let encodes = 0;
            const encode = async (value: number) => {
              checkCurrent();
              progress(Math.min(0.9, 0.2 + encodes++ * 0.075), maxBytes ? 'Compressing to the size limit…' : 'Compressing image…');
              const blob = await encodeCanvas(canvas, type, value, operationSignal);
              checkCurrent();
              if (!blob || blob.type !== type) throw new Error('This browser cannot encode the selected format. Pick another format.');
              return blob;
            };
            const blob = maxBytes === undefined || type === 'image/png' ? await encode(startQuality) : await encodeWithinLimit(encode, startQuality, maxBytes);
            if (maxBytes !== undefined && blob.size > maxBytes) throw new Error('PNG is lossless and exceeds the file size limit. Choose JPEG or WebP, or raise the limit. Nothing was saved.');
            checkCurrent();
            progress(1, 'Downloading image…');
            downloadBlob(blob, filename);
            const saved = source.size - blob.size;
            const message = saved > 0 ? `Saved ${formatBytes(saved)} (${((saved / source.size) * 100).toFixed(1)}%). Image downloaded.` : saved === 0 ? 'No size reduction with these settings. Image downloaded.' : `Output is ${formatBytes(-saved)} larger with these settings. Image downloaded.`;
            return `${message} Original: ${formatBytes(source.size)} → Output: ${formatBytes(blob.size)} · Dimensions: ${decoded.width} × ${decoded.height} → ${layout.width} × ${layout.height} pixels`;
          } finally {
            canvas.width = canvas.height = 0;
          }
        });
      } finally {
        scheduleLimitCheck();
      }
    },
    {
      validate: () => {
        if (!file || !bitmap) return 'Choose an image first.';
        if (!name.value.trim()) return 'Enter an output filename.';
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(format.value)) return 'Choose an output format.';
        try {
          selectedLayout();
          selectedQuality();
          maximumBytes();
        } catch (error) {
          return (error as Error).message;
        }
        return null;
      },
    },
  );
  const picked = sourceSelection(suggestName, () => task.reset());
  const picker = filePicker({
    label: 'Image file',
    accept: IMAGE_ACCEPT,
    onFiles: async ([selected]) => {
      if (disposed) return;
      const request = ++imageRequest;
      const sameSource = picked.begin(selected);
      cancelLimitCheck();
      operation.abort();
      bitmap?.close();
      bitmap = null;
      file = null;
      if (!sameSource) {
        width.value = '';
        height.value = '';
      }
      updateDimensions();
      updatePreview();
      info.replaceChildren();
      const bad = detectUnsupportedImage(selected);
      if (bad) {
        picked.reject();
        info.append(notice('warn', bad));
        return;
      }
      if (selected.size > LIMITS.fileBytes) {
        picked.reject();
        info.append(notice('warn', `File exceeds ${formatBytes(LIMITS.fileBytes)}.`));
        return;
      }
      picked.accept(selected, sameSource);
      try {
        info.append(notice('info', 'Reading image…'));
        const decoded = await decodeImage(selected);
        if (disposed || request !== imageRequest) {
          decoded.close();
          return;
        }
        bitmap = decoded;
        file = selected;
        if (!sameSource) {
          width.value = String(decoded.width);
          height.value = String(decoded.height);
        }
        info.replaceChildren(notice('info', `${selected.name} · ${formatBytes(selected.size)} · ${decoded.width} × ${decoded.height} pixels. The source stays untouched.`));
        updateDimensions();
        updatePreview();
        scheduleLimitCheck();
      } catch (error) {
        if (!disposed && request === imageRequest) {
          picked.reject();
          info.replaceChildren(notice('danger', `Cannot decode this image (${(error as Error).message}). The format may be unsupported by this browser.`));
        }
      }
    },
  });
  const sizingSection = group('Image size', h('div', { class: 'image-workspace' }, h('div', { class: 'image-controls' }, option('Resize image', 'Choose smaller bounds or an exact output size.', resize), resizeBox, dimensions), preview));
  sizingSection.classList.add('image-section');
  toolPage(root, 'compress-image', {
    config: [
      group(null, picker, info),
      sizingSection,
      group(
        null,
        field('Output format', format),
        qualityField,
        tradeoff,
        option('Limit file size', 'Set a maximum size for the compressed file.', limit),
        sizeBox,
        field('Output filename (without extension)', name),
        h('p', { class: 'field-hint' }, 'Saved camera rotation is applied automatically. The saved copy removes camera details, location and comments; your original stays unchanged.'),
      ),
    ],
    actions: [task.el],
  });
  persistForm('compress-image', root, ['width', 'height']);
  return () => {
    disposed = true;
    imageRequest++;
    cancelLimitCheck();
    operation.abort();
    bitmap?.close();
    bitmap = null;
    file = null;
    updatePreview();
  };
}
