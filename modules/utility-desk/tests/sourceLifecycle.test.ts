import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount as documents } from '../src/features/documents/documentConverter';
import { mount as media } from '../src/features/media/mediaConverter';
import { mount as compressPdf } from '../src/features/pdf/compressPdf';
import { mount as unlockPdf } from '../src/features/pdf/unlockPdf';
import { mount as imagesToPdf } from '../src/features/pdf/imagesToPdf';
import { mount as crop } from '../src/features/images/cropImage';
import { mount as compressImage } from '../src/features/images/compressImage';
import { mainRoot, press, selectFiles, statuses } from './helpers';

vi.mock('../src/infrastructure/capabilities', () => ({ detectCapabilities: () => [{ id: 'ffmpeg', label: 'FFmpeg', state: 'Supported', detail: 'Test environment' }] }));

let root: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  root = mainRoot();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:fixture';
      }
      static revokeObjectURL() {}
    },
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  root.dispatchEvent(new Event('utility-desk:leave'));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const nameControl = () => root.querySelector<HTMLInputElement>('[name=outName], [name=outputName]')!;
const setField = (name: string, value: string) => {
  const control = root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Each case makes the primary action fail validation, so the status leaves "Ready." without running a conversion.
const cases = [
  { id: 'compress-pdf', mount: compressPdf, ext: 'pdf', suffix: 'compressed', primary: 'Compress PDF →', fail: () => setField('outName', '') },
  { id: 'unlock-pdf', mount: unlockPdf, ext: 'pdf', suffix: 'unlocked', primary: 'Unlock PDF →', fail: () => setField('outName', '') },
  {
    id: 'document-converter',
    mount: documents,
    ext: 'md',
    suffix: 'converted',
    primary: 'Convert document →',
    fail: () => {
      press(root, 'Preview document →');
    },
  },
  { id: 'media-converter', mount: media, ext: 'mp4', suffix: 'converted', primary: 'Convert media →', fail: () => setField('end', '0:99') },
  { id: 'crop-image', mount: crop, ext: 'png', suffix: 'cropped', primary: 'Export cropped image →', fail: () => setField('outName', '') },
  { id: 'compress-image', mount: compressImage, ext: 'png', suffix: 'compressed', primary: 'Compress Image →', fail: () => setField('outName', '') },
];

describe('task status follows the selected source', () => {
  it.each(cases)('$id keeps its status when the same file is chosen again and resets it for another file', async (tool) => {
    const cleanup = tool.mount(root);
    const file = (name: string) => new File(['fixture'], name, { lastModified: 123 });
    try {
      selectFiles(root, [file(`first.${tool.ext}`)]);
      await vi.waitFor(() => expect(nameControl().value).toBe(`first_${tool.suffix}`));
      if (tool.id === 'crop-image') await vi.waitFor(() => expect(root.textContent).toContain('first.png: 100×100'));
      if (tool.id === 'compress-image') await vi.waitFor(() => expect(root.textContent).toContain('100 × 100 pixels'));
      expect(statuses(root).every((status) => status === 'Ready.')).toBe(true);
      tool.fail();
      press(root, tool.primary);
      const failed = statuses(root);
      expect(failed.some((status) => status !== 'Ready.')).toBe(true);

      selectFiles(root, [file(`first.${tool.ext}`)]);
      await settle();
      expect(statuses(root)).toEqual(failed);

      selectFiles(root, [file(`second.${tool.ext}`)]);
      await vi.waitFor(() => expect(nameControl().value).toBe(`second_${tool.suffix}`));
      expect(statuses(root).every((status) => status === 'Ready.')).toBe(true);
    } finally {
      root.dispatchEvent(new Event('utility-desk:leave'));
      if (typeof cleanup === 'function') cleanup();
    }
  });
});

describe('images-to-pdf status follows the image list', () => {
  const image = (name: string) => new File(['fixture'], name, { type: 'image/png' });
  const action = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();

  it('resets a stale status when images are added, moved or removed', () => {
    const cleanup = imagesToPdf(root);
    try {
      selectFiles(root, [image('first.png'), image('second.png')]);
      const invalidate = () => {
        setField('dpi', '9');
        press(root, 'Create PDF →');
        expect(statuses(root)[0]).toBe('DPI must be a whole number from 72 to 600.');
      };
      invalidate();
      selectFiles(root, [image('third.png')]);
      expect(statuses(root)).toEqual(['Ready.']);
      invalidate();
      action('Move third.png up');
      expect(statuses(root)).toEqual(['Ready.']);
      invalidate();
      action('Remove second.png');
      expect(statuses(root)).toEqual(['Ready.']);
    } finally {
      root.dispatchEvent(new Event('utility-desk:leave'));
      if (typeof cleanup === 'function') cleanup();
    }
  });
});
