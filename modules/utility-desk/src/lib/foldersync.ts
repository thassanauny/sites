export interface FileEntry { path: string; size: number; mtime: number }
export interface SyncReport {
  added: FileEntry[]; changed: FileEntry[]; unchanged: FileEntry[]; destOnly: FileEntry[];
  bytesToCopy: number;
}

/** Portable subset of rsync patterns: *, **, ?, with slash-aware matching. */
export function excluded(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const p = pattern.trim();
    if (!p) return false;
    let re = '';
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '*' && p[i + 1] === '*') { re += '.*'; i++; }
      else if (p[i] === '*') re += '[^/]*';
      else if (p[i] === '?') re += '[^/]';
      else re += p[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const start = p.startsWith('/') ? '^' : '(?:^|/)';
    if (p.startsWith('/')) re = re.slice(1);
    return new RegExp(start + re + (p.endsWith('/') ? '.*$' : '(?:$|/)')).test(path);
  });
}

export async function compareContents(source: FileEntry[], dest: FileEntry[], sourceFiles: Map<string, File>, destFiles: Map<string, File>, signal?: AbortSignal): Promise<SyncReport> {
  const r = compareFolders(source, dest);
  r.changed = []; r.unchanged = [];
  const dmap = new Map(dest.map((d) => [d.path, d]));
  for (const s of source) {
    const d = dmap.get(s.path);
    if (!d) continue;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    let same = false;
    if (s.size === d.size) {
      const hash = async (f: File) => new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()));
      const a = await hash(sourceFiles.get(s.path)!), b = await hash(destFiles.get(s.path)!);
      same = a.every((v, i) => v === b[i]);
    }
    (same ? r.unchanged : r.changed).push(s);
  }
  r.bytesToCopy = [...r.added, ...r.changed].reduce((n, f) => n + f.size, 0);
  return r;
}

export async function removeFromHandle(dest: any, path: string) {
  const parts = normalizePath(path).split('/');
  let dir = dest;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  await dir.removeEntry(parts[parts.length - 1]);
}
/** mtime comparison tolerance (FAT/zip rounding is up to 2s). */
export const MTIME_TOLERANCE_MS = 2000;

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
}

export function compareFolders(source: FileEntry[], dest: FileEntry[]): SyncReport {
  const dmap = new Map(dest.map((d) => [d.path, d]));
  const smap = new Set(source.map((s) => s.path));
  const r: SyncReport = { added: [], changed: [], unchanged: [], destOnly: [], bytesToCopy: 0 };
  for (const s of source) {
    const d = dmap.get(s.path);
    if (!d) r.added.push(s);
    else if (s.size !== d.size || Math.abs(s.mtime - d.mtime) > MTIME_TOLERANCE_MS) r.changed.push(s);
    else r.unchanged.push(s);
  }
  r.destOnly = dest.filter((d) => !smap.has(d.path));
  r.bytesToCopy = [...r.added, ...r.changed].reduce((n, f) => n + f.size, 0);
  return r;
}

export function reportText(r: SyncReport, srcName: string, dstName: string, mirror = false): string {
  const L = (t: string, xs: FileEntry[]) => [`${t} (${xs.length})`, ...xs.map((x) => `  ${x.path}  [${x.size} B]`)];
  return [
    `Utility Desk Lite change report (${mirror ? 'mirror mode, destination-only files will be deleted' : 'archive mode, nothing deleted'})`,
    `Source: ${srcName}   Destination: ${dstName}`,
    ...L('New', r.added), ...L('Changed', r.changed),
    `Unchanged (${r.unchanged.length})`,
    ...L(mirror ? 'Destination-only (delete after copying)' : 'Destination-only (kept, never deleted)', r.destOnly),
  ].join('\n');
}

/** Build FileEntry list from a <input webkitdirectory> selection; strips the top-level folder name. */
export function entriesFromFileList(files: File[]): { root: string; entries: FileEntry[]; fileMap: Map<string, File> } {
  const fileMap = new Map<string, File>();
  let root = 'folder';
  const entries = files.map((f) => {
    const rel = normalizePath((f as any).webkitRelativePath || f.name);
    const parts = rel.split('/');
    if (parts.length > 1) root = parts[0];
    const path = parts.length > 1 ? parts.slice(1).join('/') : rel;
    fileMap.set(path, f);
    return { path, size: f.size, mtime: f.lastModified };
  });
  return { root, entries, fileMap };
}

export async function entriesFromHandle(dir: any, signal?: AbortSignal, prefix = '', fileMap = new Map<string, File>()): Promise<{ entries: FileEntry[]; fileMap: Map<string, File> }> {
  const entries: FileEntry[] = [];
  for await (const [name, h] of dir.entries()) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (h.kind === 'file') {
      const f: File = await h.getFile();
      const path = prefix + name;
      fileMap.set(path, f);
      entries.push({ path, size: f.size, mtime: f.lastModified });
    } else {
      entries.push(...(await entriesFromHandle(h, signal, `${prefix}${name}/`, fileMap)).entries);
    }
  }
  return { entries, fileMap };
}

export async function writeToHandle(dest: any, path: string, file: File) {
  const parts = normalizePath(path).split('/');
  let dir = dest;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  try { await w.write(file); } finally { await w.close(); }
}
