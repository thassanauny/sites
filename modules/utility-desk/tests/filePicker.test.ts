import { afterEach, describe, expect, it, vi } from 'vitest';
import { filePicker, guardFileDrops } from '../src/ui/elements';
import { mount as mountMedia } from '../src/features/media/mediaConverter';
import { mount as mountImages } from '../src/features/pdf/imagesToPdf';

function choose(picker: HTMLElement, files: File[]) {
  const input = picker.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function drop(picker: HTMLElement, files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  picker.dispatchEvent(event);
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('files dropped outside a drop zone', () => {
  function drag(type: 'dragover' | 'drop', target: Element, types: string[] = ['Files']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const dataTransfer = { types, dropEffect: 'copy' };
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    target.dispatchEvent(event);
    return { prevented: event.defaultPrevented, dropEffect: dataTransfer.dropEffect };
  }
  const page = () => {
    document.body.innerHTML = '<main id="main"><p id="outside">Text</p><div class="dropzone"><span id="inside">Drop here</span></div></main>';
    return { outside: document.getElementById('outside')!, inside: document.getElementById('inside')! };
  };

  it('are ignored so the browser does not open them and discard the page', () => {
    const { outside } = page();
    const stop = guardFileDrops(window);
    try {
      expect(drag('dragover', outside)).toEqual({ prevented: true, dropEffect: 'none' });
      expect(drag('drop', outside).prevented).toBe(true);
      expect(drag('drop', document.body).prevented).toBe(true);
    } finally {
      stop();
    }
  });

  it('leave drop zones and other drags alone', () => {
    const { outside, inside } = page();
    const stop = guardFileDrops(window);
    try {
      expect(drag('dragover', inside)).toEqual({ prevented: false, dropEffect: 'copy' });
      expect(drag('drop', inside).prevented).toBe(false);
      expect(drag('dragover', outside, ['text/plain'])).toEqual({ prevented: false, dropEffect: 'copy' });
      expect(drag('drop', outside, ['text/plain']).prevented).toBe(false);
    } finally {
      stop();
    }
  });

  it('stop being ignored once the guard is removed', () => {
    const { outside } = page();
    guardFileDrops(window)();
    expect(drag('drop', outside).prevented).toBe(false);
  });

  it('are still delivered to a picker, which handles them itself', () => {
    const onFiles = vi.fn();
    const picker = filePicker({ label: 'PDF file', accept: '.pdf', onFiles });
    document.body.append(picker);
    const stop = guardFileDrops(window);
    try {
      const file = new File(['a'], 'a.pdf');
      drop(picker, [file]);
      expect(onFiles).toHaveBeenCalledWith([file]);
    } finally {
      stop();
    }
  });
});

describe('supported file selection', () => {
  it.each([choose, drop])('validates selected and dropped files consistently', (selectFiles) => {
    const onFiles = vi.fn();
    const picker = filePicker({ label: 'PDFs', accept: ' .pdf, application/pdf ', multiple: true, onFiles });
    document.body.append(picker);
    const pdf = new File(['pdf'], 'UPPER.PDF'),
      typedPdf = new File(['pdf'], 'document', { type: 'application/pdf' });
    selectFiles(picker, [new File(['text'], 'wrong.txt'), pdf, typedPdf]);
    expect(onFiles).toHaveBeenCalledWith([pdf, typedPdf]);
    expect(picker.textContent).toContain('Unsupported files were skipped');
    selectFiles(picker, [new File(['text'], 'wrong.txt')]);
    expect(onFiles).toHaveBeenCalledOnce();
  });

  it('accepts common FFmpeg inputs with no MIME type, including animated GIF', () => {
    vi.stubGlobal('Worker', class {});
    const root = document.body.appendChild(document.createElement('main'));
    const cleanup = mountMedia(root);
    for (const name of ['clip.mkv', 'clip.mov', 'clip.avi', 'sound.flac', 'sound.opus', 'animation.gif']) {
      choose(root, [new File(['fixture'], name)]);
      expect(root.textContent).toContain(`${name} ·`);
      drop(root.querySelector<HTMLElement>('.dropzone')!, [new File(['fixture'], name)]);
      expect(root.textContent).toContain(`${name} ·`);
    }
    cleanup?.();
  });

  it('uses the first file of a single-file picker and says that the others were ignored', () => {
    const onFiles = vi.fn();
    const picker = filePicker({ label: 'PDF file', accept: '.pdf', onFiles });
    document.body.append(picker);
    const first = new File(['a'], 'a.pdf'),
      second = new File(['b'], 'b.pdf');
    choose(picker, [first, second]);
    expect(onFiles).toHaveBeenCalledWith([first]);
    expect(picker.textContent).toContain('Only the first file was used (a.pdf). This picker takes one file at a time.');
    choose(picker, [second]);
    expect(onFiles).toHaveBeenLastCalledWith([second]);
    expect(picker.textContent).not.toContain('Only the first file');
  });

  it('says nothing about extra files when the picker takes several', () => {
    const onFiles = vi.fn();
    const picker = filePicker({ label: 'PDFs', accept: '.pdf', multiple: true, onFiles });
    document.body.append(picker);
    choose(picker, [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')]);
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
    expect(picker.textContent).not.toContain('Only the first file');
  });

  it('accepts common browser image inputs without an OS-provided MIME type', () => {
    const root = document.body.appendChild(document.createElement('main'));
    mountImages(root);
    for (const name of ['photo.PNG', 'photo.jpeg', 'picture.webp', 'animation.gif', 'picture.avif', 'picture.bmp', 'drawing.svg']) {
      drop(root.querySelector<HTMLElement>('.dropzone')!, [new File(['fixture'], name)]);
      expect(root.querySelector('.file-list')?.textContent).toContain(name);
    }
  });
});
