import { MAX_SNIPPET_NAME_LENGTH, normalizeCode, validateName, type DeviceSnippet } from '../../domain/snippets/model';

export const DEVICE_SNIPPETS_KEY = 'textdrop-snippets';
type SnippetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>;
const prefix = `${DEVICE_SNIPPETS_KEY}:`;
const removalPrefix = `${prefix}removed:`;
const openingPrefix = `${prefix}opened:`;
const namePrefix = `${prefix}name:`;
interface StoredSnippet extends DeviceSnippet {
  removalToken?: string;
}
interface StoredState {
  row: string | null;
  marker: string | null;
}

function newestFirst(snippets: DeviceSnippet[]): DeviceSnippet[] {
  return snippets.sort((left, right) => right.openedAt.localeCompare(left.openedAt) || left.code.localeCompare(right.code));
}

function normalizedName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** The JSON object stored for a code, or null when it is missing, malformed or belongs to another code. */
function readRow(code: string, saved: string | null): Record<string, unknown> | null {
  if (saved === null) return null;
  try {
    const row: unknown = JSON.parse(saved);
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    return normalizeCode((row as Record<string, unknown>).code) === code ? (row as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readName(code: string, saved: string | null): string | undefined {
  const name = readRow(code, saved)?.name;
  if (typeof name !== 'string') return undefined;
  const normalized = normalizedName(name);
  return normalized && Array.from(normalized).length <= MAX_SNIPPET_NAME_LENGTH ? normalized : undefined;
}

function readEntry(code: string, saved: string | null): StoredSnippet | null {
  const row = readRow(code, saved);
  if (!row) return null;
  const { openedAt, removed, removalToken } = row;
  if (removed === true || typeof openedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(openedAt)) return null;
  const date = new Date(openedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== openedAt) return null;
  if (removalToken !== undefined && (typeof removalToken !== 'string' || !removalToken)) return null;
  return { code, openedAt, ...(removalToken === undefined ? {} : { removalToken }) };
}

function readRemovalToken(code: string, saved: string | null): string | null {
  const row = readRow(code, saved);
  return row?.removed === true && typeof row.token === 'string' && row.token ? row.token : null;
}

function snapshotOf(state: StoredState): string | null {
  return state.row === null && state.marker === null ? null : JSON.stringify([state.row, state.marker]);
}

function openingKey(code: string, token: string | null): string {
  return token === null ? `${prefix}${code}` : `${openingPrefix}${code}:${token}`;
}

function isRemovedState(code: string, state: StoredState): boolean {
  return (readEntry(code, state.row)?.removalToken ?? null) !== readRemovalToken(code, state.marker);
}

/** Device history stores invitations, opening times and optional names, never snippet content. */
export class DeviceSnippets {
  private getStorage: () => SnippetStorage;
  private now: () => Date;

  constructor(getStorage: () => SnippetStorage = () => window.localStorage, now: () => Date = () => new Date()) {
    this.getStorage = getStorage;
    this.now = now;
  }

  /** Whether a `storage` event key shows that another tab changed the list (a null key means all storage was cleared). */
  changedBy(key: string | null): boolean {
    return key === null || key.startsWith(prefix);
  }

  private storage(): SnippetStorage {
    try {
      return this.getStorage();
    } catch {
      throw new Error('Could not read snippets saved on this device. Check browser storage permissions.');
    }
  }

  private state(storage: SnippetStorage, code: string): StoredState {
    try {
      // Choose the opening for the current removal epoch. Retry a changing
      // marker so a snapshot never combines a new removal with an old row.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const marker = storage.getItem(`${removalPrefix}${code}`);
        const row = storage.getItem(openingKey(code, readRemovalToken(code, marker)));
        if (storage.getItem(`${removalPrefix}${code}`) === marker) return { row, marker };
      }
    } catch {
      throw new Error('Could not read snippets saved on this device. Check browser storage permissions.');
    }
    throw new Error('Snippets on this device changed while reading. Try again.');
  }

  /** A new removal epoch never shows the rows of earlier epochs again. Deleting them keeps storage from growing with every remove and reopen. */
  private pruneEarlierEpochs(storage: SnippetStorage, code: string, current: string): void {
    try {
      const earlier: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null && key !== current && (key === openingKey(code, null) || key.startsWith(`${openingPrefix}${code}:`))) earlier.push(key);
      }
      for (const key of earlier) storage.removeItem(key);
    } catch {
      /* The rows are only garbage: nothing reads an earlier epoch's opening. */
    }
  }

  private read(storage: SnippetStorage): DeviceSnippet[] {
    const snippets: DeviceSnippet[] = [];
    try {
      const codes = new Set<string>();
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix) && /^[a-f\d]{32}$/.test(key.slice(prefix.length))) codes.add(key.slice(prefix.length));
        else if (key?.startsWith(removalPrefix) && /^[a-f\d]{32}$/.test(key.slice(removalPrefix.length))) codes.add(key.slice(removalPrefix.length));
      }
      for (const code of codes) {
        const state = this.state(storage, code);
        const snippet = readEntry(code, state.row);
        if (snippet && !isRemovedState(code, state)) {
          const name = readName(code, storage.getItem(`${namePrefix}${code}`));
          snippets.push({ code, openedAt: snippet.openedAt, ...(name === undefined ? {} : { name }) });
        }
      }
    } catch {
      throw new Error('Could not read snippets saved on this device. Check browser storage permissions.');
    }
    return newestFirst(snippets);
  }

  list(): DeviceSnippet[] {
    return this.read(this.storage());
  }

  /** Cache shared metadata without opening or restoring a snippet. */
  sharedName(code: string, name: string | null, version: number, pending = false): DeviceSnippet[] {
    const normalized = normalizeCode(code);
    const storage = this.storage();
    const current = readRow(normalized, storage.getItem(namePrefix + normalized));
    const known = typeof current?.version === 'number' ? current.version : 0;
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('The snippet version is invalid.');
    if (version < known && !pending) return this.read(storage);
    const next = JSON.stringify({ code: normalized, name: validateName(name) ?? '', version: Math.max(version, known) });
    if (storage.getItem(namePrefix + normalized) !== next) storage.setItem(namePrefix + normalized, next);
    return this.read(storage);
  }

  /** An opaque opening guard includes both the row and its independent removal. */
  snapshot(code: string): string | null {
    const normalized = normalizeCode(code);
    return snapshotOf(this.state(this.storage(), normalized));
  }

  isRemoved(code: string): boolean {
    const normalized = normalizeCode(code);
    return isRemovedState(normalized, this.state(this.storage(), normalized));
  }

  remember(code: string, expected?: string | null): DeviceSnippet[] {
    const normalized = normalizeCode(code);
    const storage = this.storage();
    const previous = this.read(storage);
    const observed = this.state(storage, normalized);
    // Only an explicit opening with a fresh guard can acknowledge a removal.
    if ((expected !== undefined && snapshotOf(observed) !== expected) || (expected === undefined && isRemovedState(normalized, observed))) return this.read(storage);
    const opened = this.now();
    if (!Number.isFinite(opened.getTime())) throw new Error('Could not record when this snippet was opened.');
    const removalToken = readRemovalToken(normalized, observed.marker);
    const key = openingKey(normalized, removalToken);
    try {
      // Never rewrite a removal or another epoch's opening. A late reply can
      // neither undo a removal nor hide a successful rejoin after that removal.
      storage.setItem(key, JSON.stringify({ code: normalized, openedAt: opened.toISOString(), ...(removalToken === null ? {} : { removalToken }) }));
    } catch {
      throw new Error('Could not save the snippet on this device. Check browser storage permissions or available space.');
    }
    if (removalToken !== null && observed.row === null) this.pruneEarlierEpochs(storage, normalized, key);
    // The row is committed. If visibility cannot be checked, omit it until the
    // next successful read instead of displaying a possibly concurrent removal.
    try {
      return this.read(storage);
    } catch {
      return previous.filter(row => row.code !== normalized);
    }
  }

  remove(code: string): DeviceSnippet[] {
    const normalized = normalizeCode(code);
    const storage = this.storage();
    const previous = this.read(storage);
    try {
      const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      storage.setItem(`${removalPrefix}${normalized}`, JSON.stringify({ code: normalized, removed: true, token }));
    } catch {
      throw new Error('Could not remove the snippet from this device. Check browser storage permissions.');
    }
    try {
      return this.read(storage);
    } catch {
      return previous.filter(row => row.code !== normalized);
    }
  }
}
