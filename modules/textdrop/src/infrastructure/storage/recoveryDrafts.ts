import type { TextDropPage } from '../../domain/snippets/model';

const PREFIX = 'textdrop-recovery.v1:';
interface RecordValue {
  pageId: string;
  code: string;
  text: string;
  updatedAt: number;
}

/** Separate copies per editor prevent tabs from overwriting one another's recovery text. */
export class RecoveryDrafts {
  private owner = crypto.randomUUID();
  private observed = new Map<string, Map<string, string>>();
  private storage: () => Storage;
  constructor(storage: () => Storage = () => localStorage) {
    this.storage = storage;
  }

  read(page: TextDropPage): string | undefined {
    const storage = this.storage();
    const copies = new Map<string, string>();
    let latest: { value: RecordValue; key: string; raw: string } | undefined;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(`${PREFIX}${page.code}:`)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw) as RecordValue;
      if (value.pageId !== page.id || value.code !== page.code || typeof value.text !== 'string' || !Number.isFinite(value.updatedAt))
        throw new Error('A recovery copy could not be read. It has been kept on this device.');
      if (!latest || value.updatedAt >= latest.value.updatedAt) latest = { value, key, raw };
    }
    if (latest) copies.set(latest.key, latest.raw);
    this.observed.set(page.code, copies);
    return latest?.value.text;
  }

  write(page: TextDropPage, text: string): void {
    const key = `${PREFIX}${page.code}:${this.owner}`;
    const raw = JSON.stringify({ pageId: page.id, code: page.code, text, updatedAt: Date.now() });
    this.storage().setItem(key, raw);
    const copies = this.observed.get(page.code) ?? new Map<string, string>();
    copies.set(key, raw);
    this.observed.set(page.code, copies);
  }

  /** Clear only copies actually accepted or discarded, never newer edits from another tab. */
  clear(page: TextDropPage): void {
    const storage = this.storage();
    for (const [key, raw] of this.observed.get(page.code) ?? []) {
      if (storage.getItem(key) === raw) storage.removeItem(key);
    }
    this.observed.delete(page.code);
  }
}
