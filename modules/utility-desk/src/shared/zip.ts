import { Zip, ZipPassThrough } from 'fflate';

/** Hands out `name`, then `name-2`, `name-3`… so no entry replaces another. Names compare case-insensitively. */
export function nameAllocator(): (name: string) => string {
  const used = new Set<string>();
  return (name) => {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name,
      extension = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

/** Entry names may contain "/" for subfolders, but never "..", absolute paths or backslashes. */
export function safeZipPath(p: string): string {
  const parts = p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..');
  return parts.join('/') || 'file';
}

export interface ZipWriter {
  /** Add a stored entry. A name that is already taken gets `-2`, `-3`… before its extension. */
  add(name: string, data: Uint8Array): void;
  /** Bytes of archive written so far. */
  readonly size: number;
  /** Close the archive. The writer cannot be used afterwards. */
  finish(): Blob;
}

/**
 * Builds a ZIP entry by entry, so a caller can let go of each source as soon as it is added instead of holding all of
 * them next to the finished archive. Entries are stored, not compressed: PNG, JPEG and PDF pages are compressed already.
 */
export function zipWriter(): ZipWriter {
  const chunks: Uint8Array[] = [];
  const nameFor = nameAllocator();
  let size = 0,
    failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else {
      chunks.push(chunk);
      size += chunk.length;
    }
  });
  const check = () => {
    if (failure) throw failure;
  };
  return {
    add(name, data) {
      const entry = new ZipPassThrough(nameFor(safeZipPath(name)));
      zip.add(entry);
      entry.push(data, true);
      check();
    },
    get size() {
      return size;
    },
    finish() {
      zip.end();
      check();
      const archive = new Blob(chunks as BlobPart[], { type: 'application/zip' });
      chunks.length = 0;
      return archive;
    },
  };
}
