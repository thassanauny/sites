import { toolPage, group, outputPanel } from '../page';
import { h, field, input, select, filePicker, taskControls, notice, persistForm, button, option } from '../ui';
import { encodeWithinLimit, grayscale, sepia, contrast, autoContrast, sharpen, rotatedSize, sizeImage, type Sizing, detectUnsupportedImage, MAX_PIXELS, IMAGE_ACCEPT } from '../lib/imageops';
import { downloadBlob, baseName, sanitizeFilename, formatBytes, MAX_FILE_BYTES, throwIfAborted } from '../lib/util';

export function mount(root: HTMLElement) {
  let file: File | null = null;
  let bmp: ImageBitmap | null = null;
  let imageRequest = 0;
  const info = h('div'), canvas = h('canvas', { class: 'preview-img', 'aria-label': 'Edited image preview', role: 'img' });
  const f = (name: string, v: string, extra: Record<string, any> = {}) => input('number', name, v, extra);
  const w = f('width', '', { min: 1, placeholder: 'auto' }), hh = f('height', '', { min: 1, placeholder: 'auto' });
  const sizing = select('sizing', [['maximum', 'Maximum size · keep proportions'], ['cover', 'Exact size · crop to fit'], ['contain', 'Exact size · add padding'], ['stretch', 'Exact size · stretch']], 'maximum');
  const enlarge = input('checkbox', 'enlarge');
  const padding = select('padding', [['white', 'White'], ['black', 'Black'], ['transparent', 'Transparent']], 'white');
  const auto = input('checkbox', 'autoContrast');
  const rot = select('rotate', [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], '0');
  const flipH = input('checkbox', 'flipH'), flipV = input('checkbox', 'flipV'), gray = input('checkbox', 'gray'), sep = input('checkbox', 'sepia');
  const con = input('range', 'contrast', '0', { min: -100, max: 100 });
  const sharp = input('checkbox', 'sharpen');
  const fmt = select('format', [['image/png', 'PNG'], ['image/jpeg', 'JPEG'], ['image/webp', 'WebP']], 'image/png');
  const q = input('range', 'quality', '90', { min: 10, max: 100 });
  const limit = input('checkbox', 'limitSize');
  const maxSize = input('number', 'maxSize', '500', { min: 1, step: 'any' });
  const sizeUnit = select('sizeUnit', [['kb', 'KB'], ['mb', 'MB']], 'kb');
  const sizeBox = h('div', {}, h('div', { class: 'option-grid' }, field('Maximum file size', maxSize), field('Size unit', sizeUnit)), h('p', { class: 'field-hint' }, '1 KB = 1,000 bytes. Quality is lowered as needed; dimensions stay unchanged. If the limit cannot be met, no file is saved. Works with JPEG and WebP.'));
  const syncSize = () => { sizeBox.hidden = !limit.checked; };
  limit.addEventListener('change', syncSize); syncSize();

  /** Maximum sizing precedes rotation; exact sizing follows it. */
  function process(): HTMLCanvasElement {
    if (!bmp) throw new Error('Choose an image first.');
    const crop = { x: 0, y: 0, width: bmp.width, height: bmp.height };
    const width = w.value ? Number(w.value) : undefined, height = hh.value ? Number(hh.value) : undefined;
    const maximum = sizing.value === 'maximum';
    const before = maximum ? sizeImage(crop.width, crop.height, width, height, 'maximum', enlarge.checked) : { width: crop.width, height: crop.height };
    const rw = before.width, rh = before.height;
    const deg = Number(rot.value);
    const [ow, oh] = rotatedSize(rw, rh, deg);
    if (ow * oh > MAX_PIXELS) throw new Error('Output would be too large for browser memory. Reduce the size.');
    const c = document.createElement('canvas'); c.width = ow; c.height = oh;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'high';
    g.translate(ow / 2, oh / 2); g.rotate((deg * Math.PI) / 180);
    g.scale(flipH.checked ? -1 : 1, flipV.checked ? -1 : 1);
    g.drawImage(bmp, crop.x, crop.y, crop.width, crop.height, -rw / 2, -rh / 2, rw, rh);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const layout = maximum ? sizeImage(ow, oh, undefined, undefined, 'maximum', false) : sizeImage(ow, oh, width, height, sizing.value as Sizing, true);
    if (layout.width * layout.height > MAX_PIXELS) throw new Error('Output would be too large for browser memory. Reduce the dimensions.');
    const output = document.createElement('canvas'); output.width = layout.width; output.height = layout.height;
    const og = output.getContext('2d', { willReadFrequently: true })!;
    og.imageSmoothingQuality = 'high';
    if (fmt.value === 'image/jpeg' || (sizing.value === 'contain' && padding.value !== 'transparent')) { og.fillStyle = sizing.value === 'contain' && padding.value === 'black' ? 'black' : 'white'; og.fillRect(0, 0, output.width, output.height); }
    og.drawImage(c, layout.x, layout.y, layout.drawWidth, layout.drawHeight); c.width = c.height = 0;
    if (gray.checked || sep.checked || Number(con.value) || sharp.checked || auto.checked) {
      const img = og.getImageData(0, 0, output.width, output.height);
      if (sharp.checked) sharpen(img.data, output.width, output.height, 0.5);
      if (auto.checked) autoContrast(img.data);
      if (Number(con.value)) contrast(img.data, Number(con.value));
      if (gray.checked) grayscale(img.data);
      if (sep.checked) sepia(img.data);
      og.putImageData(img, 0, 0);
    }
    return output;
  }
  const refresh = () => {
    if (!bmp) return;
    info.querySelector('.err')?.remove();
    try {
      const out = process();
      const g = canvas.getContext('2d')!;
      const s = Math.min(1, 640 / out.width);
      canvas.width = Math.max(1, Math.round(out.width * s)); canvas.height = Math.max(1, Math.round(out.height * s));
      g.drawImage(out, 0, 0, canvas.width, canvas.height); out.width = out.height = 0;
    } catch (e) { canvas.width = canvas.height = 0; info.append(h('div', { class: 'err' }, notice('danger', (e as Error).message))); }
  };
  let t: ReturnType<typeof setTimeout>;
  const edits = h('div', { oninput: () => { clearTimeout(t); t = setTimeout(refresh, 120); }, onchange: refresh },
    group('Resize', field('Sizing method', sizing), h('div', { class: 'option-grid' }, field('Width (pixels)', w), field('Height (pixels)', hh)), option('Allow enlargement', 'Used for maximum sizing. Exact sizing always fills the requested dimensions.', enlarge), field('Padding color', padding), h('p', { class: 'field-hint' }, 'Leave both dimensions blank to keep the original size. Maximum sizing happens before rotation; exact sizing happens after rotation.')),
    group('Orientation', h('div', { class: 'option-grid' }, field('Rotate clockwise', rot)), option('Flip horizontally', 'Mirror the image left to right.', flipH), option('Flip vertically', 'Mirror the image top to bottom.', flipV)),
    group('Color & detail', field('Contrast', con, '-100 to 100. Zero leaves it unchanged.'), option('Automatic contrast', 'Expand the image’s color range.', auto), option('Grayscale', 'Remove color.', gray), option('Sepia', 'Apply a warm brown tone.', sep), option('Sharpen details', 'Apply light sharpening.', sharp)));
  const task = taskControls('image-workshop', 'Export image', async ({ signal }) => {
    const stem = sanitizeFilename(baseName(file!.name), 'image');
    const c = process();
    const type = fmt.value;
    const encode = (quality: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, quality));
    let blob: Blob | null;
    if (limit.checked) {
      const maxBytes = Math.floor(Number(maxSize.value) * (sizeUnit.value === 'mb' ? 1_000_000 : 1000));
      if (!(maxBytes >= 1000 && maxBytes <= 1_000_000_000)) throw new Error('Enter a size from 1 KB to 1,000 MB.');
      if (type === 'image/png') throw new Error('PNG is lossless, so quality cannot be lowered. Choose JPEG or WebP, or turn off the size limit.');
      blob = await encodeWithinLimit(encode, Number(q.value) / 100, maxBytes);
    } else blob = await encode(Number(q.value) / 100);
    c.width = c.height = 0;
    if (!blob || blob.type !== type) throw new Error(`This browser cannot encode ${type}. Pick another format.`);
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
    const name = `${stem}-edited.${ext}`;
    throwIfAborted(signal); downloadBlob(blob, name);
    return `${name} (${formatBytes(blob.size)})`;
  }, { validate: () => (bmp ? null : 'Choose an image first.') });
  const picker = filePicker({ label: 'Image', accept: IMAGE_ACCEPT, onFiles: async ([fl]) => {
    const request = ++imageRequest;
    clearTimeout(t); info.replaceChildren(); bmp?.close(); bmp = null; file = null;
    canvas.width = canvas.height = 0;
    const bad = detectUnsupportedImage(fl);
    if (bad) { info.append(notice('warn', bad)); return; }
    if (fl.size > MAX_FILE_BYTES) { info.append(notice('warn', `File exceeds ${formatBytes(MAX_FILE_BYTES)}.`)); return; }
    try {
      const decoded = await createImageBitmap(fl);
      if (request !== imageRequest) { decoded.close(); return; }
      bmp = decoded; file = fl;
      if (bmp.width * bmp.height > MAX_PIXELS) { bmp.close(); bmp = null; throw new Error('Image is too large to process in the browser.'); }
      info.append(notice('info', `${fl.name}: ${bmp.width}×${bmp.height}. The original file is never changed.`));
      refresh();
    } catch (e) { if (request === imageRequest) { info.append(notice('danger', `Cannot decode this image (${(e as Error).message}). The format may be unsupported by this browser.`)); } }
  } });
  const resetBtn = button('Reset edits', () => { root.querySelectorAll<HTMLInputElement>('[name]').forEach((e) => { if (e.type === 'checkbox') e.checked = false; else if (e.name === 'contrast') e.value = '0'; else if (e.tagName === 'SELECT' && e.name === 'sizing') e.value = 'maximum'; else if (e.tagName === 'SELECT' && e.name === 'padding') e.value = 'white'; else if (e.tagName === 'SELECT' && e.name === 'rotate') e.value = '0'; else if (['width', 'height'].includes(e.name)) e.value = ''; }); refresh(); }, { variant: 'secondary' });
  fmt.addEventListener('change', refresh);
  toolPage(root, 'image-workshop', { config: [group(null, picker, info), edits, group('Output', h('div', { class: 'option-grid' }, field('Output format', fmt), field('Quality (JPEG/WebP)', q)), option('Limit file size', 'Set a maximum size for the exported file.', limit), sizeBox, notice('info', 'Camera orientation is applied by the browser. Canvas export removes source metadata; retaining EXIF and profiles is unavailable. TIFF, GIF, BMP and AVIF encoding are unavailable in this edition.'))], actions: [task.el, resetBtn], output: [outputPanel('Preview', 'LIVE', canvas)] });
  persistForm('image-workshop', root);
  return () => { imageRequest++; clearTimeout(t); bmp?.close(); bmp = null; file = null; };
}
