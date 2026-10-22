import { vi } from 'vitest';

/** A fresh `<main id="main">` as the shared tool root, the way index.html and main.ts provide it. */
export function mainRoot(): HTMLElement {
  document.body.innerHTML = '<main id="main"></main>';
  return document.getElementById('main')!;
}

/** Hand files to a file input the way a browser picker does (jsdom's `files` is read-only). */
export function selectFiles(scope: ParentNode, files: File[], input: HTMLInputElement = scope.querySelector<HTMLInputElement>('input[type=file]')!) {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** A promise that the test resolves or rejects by hand. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Click the first button whose text is exactly `label`. */
export function press(scope: ParentNode, label: string) {
  const target = [...scope.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  if (!target) throw new Error(`No button named ${label}`);
  target.click();
}

/** Text of every task status line under `scope`. */
export const statuses = (scope: ParentNode) => [...scope.querySelectorAll('.status')].map((status) => status.textContent);

/** A File whose bytes can be read with `arrayBuffer()`, as in a browser (jsdom's File has no such method). */
export function bytesFile(name: string, content: Uint8Array | string, type = '', lastModified = 1_700_000_000_000): File {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const file = new File([bytes as BlobPart], name, { type, lastModified });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer });
  return file;
}

/** The bytes of a Blob (jsdom's Blob has no `arrayBuffer()`). */
export function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Record every file the page saves: its name and Blob. Restore with `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`. */
export function captureDownloads(): { name: string; blob: Blob }[] {
  const saved: { name: string; blob: Blob }[] = [];
  const blobs = new Map<string, Blob>();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL(blob: Blob) {
        const url = `blob:fixture-${blobs.size}`;
        blobs.set(url, blob);
        return url;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.href)! });
  });
  return saved;
}
