import { describe, it, expect } from 'vitest';

const modules = import.meta.glob<{ mount(root: HTMLElement): (() => void) | void }>('../src/features/**/*.ts');

describe('tool pages mount', () => {
  for (const id of ['dateTime', 'documentConverter', 'imagesToPdf', 'mergePdfs', 'splitPdf', 'compressPdf', 'unlockPdf', 'qrGenerator', 'imageWorkshop', 'cropImage', 'compressImage']) {
    it(`renders ${id} with shared layout`, async () => {
      document.body.innerHTML = '<main id="m"></main>';
      const root = document.getElementById('m')!;
      const source = Object.keys(modules).find(path => path.endsWith(`/${id}.ts`))!;
      const mod = await modules[source]();
      const cleanup = mod.mount(root);
      expect(root.querySelector('h1')).toBeTruthy();
      expect(root.querySelector('.page-heading .tool-mark')).toBeTruthy();
      expect(root.querySelectorAll('.side-panels .panel').length).toBeGreaterThan(0);
      if (typeof cleanup === 'function') cleanup();
    });
  }
});
