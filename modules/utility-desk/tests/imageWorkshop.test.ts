import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '../src/tools/imageWorkshop';
import { store } from '../src/lib/storage';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('exports the full image after cropping moves to a separate utility, including when a previous draft contains crop fields', async () => {
  document.body.innerHTML = '<main></main>';
  const root = document.querySelector('main')!;
  store.setDraft('image-workshop', { cropX: '100', cropY: '50', cropW: '800', cropH: '600' });
  const source = { width: 1200, height: 800, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => source));
  const context = { drawImage() {}, translate() {}, rotate() {}, scale() {}, setTransform() {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  const encodedSizes: number[][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
    encodedSizes.push([this.width, this.height]); callback(new Blob(['fixture'], { type: type ?? 'image/png' }));
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:fixture'; } static revokeObjectURL() {} });
  const cleanup = mount(root);
  try {
    expect(root.querySelector('[name="cropW"]')).toBeNull();
    expect(root.querySelector('.crop-section')).toBeNull();
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['fixture'], 'sample.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('1200×800'));
    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Export image →')!.click();
    await vi.waitFor(() => expect(root.querySelector('.status')!.textContent).toContain('Done.'));
    expect(encodedSizes).toEqual([[1200, 800]]);
  } finally { root.dispatchEvent(new Event('utility-desk:leave')); cleanup(); }
});
