import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '../src/lib/storage';
import { mount as document } from '../src/tools/documentConverter';
import { mount as media } from '../src/tools/mediaConverter';
import { mount as compress } from '../src/tools/compressPdf';
import { mount as unlock } from '../src/tools/unlockPdf';
import { mount as images } from '../src/tools/imagesToPdf';
import { mount as merge } from '../src/tools/mergePdfs';
import { mount as crop } from '../src/tools/cropImage';
vi.mock('../src/lib/caps', () => ({ detectCapabilities: () => [
  { id: 'ffmpeg', label: 'FFmpeg', state: 'Supported', detail: 'Test environment' },
] }));
let root: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  window.document.body.innerHTML = '<main id="main"></main>';
  root = window.document.getElementById('main')!;
});
afterEach(() => { root.dispatchEvent(new Event('utility-desk:leave')); });
it.each([
  ['document-converter', document], ['media-converter', media], ['compress-pdf', compress],
  ['unlock-pdf', unlock], ['images-to-pdf', images], ['merge-pdfs', merge], ['crop-image', crop],
] as const)('%s resets its output name instead of restoring a saved name', (id, mount) => {
  store.setDraft(id, {outName: 'old_output', outputName: 'old_output'});
  const cleanup = mount(root);
  const control = root.querySelector<HTMLInputElement>('[name=outName], [name=outputName]')!;
  expect(control.value).toBe(id === 'merge-pdfs' ? 'merged' : '');
  control.value = 'edited'; control.dispatchEvent(new Event('input', {bubbles: true}));
  root.dispatchEvent(new Event('utility-desk:leave'));
  if (id !== 'unlock-pdf') {
    expect(store.getDraft(id).outName).toBeUndefined();
    expect(store.getDraft(id).outputName).toBeUndefined();
  }
  if (typeof cleanup === 'function') cleanup();
});

function addImages(files: File[]) {
  const picker = root.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(picker, 'files', { configurable: true, value: files });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
}
function listAction(label: string) {
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
}

it.each(['custom_book', ''])('keeps output name %j while later images change', (chosenName) => {
  images(root);
  addImages([new File(['first'], 'first.png'), new File(['second'], 'second.png')]);
  const name = root.querySelector<HTMLInputElement>('[name=outName]')!;
  expect(name.value).toBe('first_images');
  name.value = chosenName;
  addImages([new File(['third'], 'third.png')]);
  expect(name.value).toBe(chosenName);
  listAction('Move third.png up');
  expect(name.value).toBe(chosenName);
  listAction('Remove second.png');
  expect(name.value).toBe(chosenName);
  addImages([new File(['unsupported'], 'picture.heic', { type: 'image/heic' })]);
  expect(name.value).toBe(chosenName);
  listAction('Move first.png down');
  expect(name.value).toBe('third_images');
  name.value = chosenName;
  listAction('Remove third.png');
  expect(name.value).toBe('first_images');
  listAction('Remove first.png');
  expect(name.value).toBe('');
});

it('refreshes the suggestion when a different first image has the same filename', () => {
  images(root);
  addImages([new File(['first'], 'same.png'), new File(['second'], 'same.png')]);
  const name = root.querySelector<HTMLInputElement>('[name=outName]')!;
  name.value = 'custom';
  listAction('Move same.png down');
  expect(name.value).toBe('same_images');
});
