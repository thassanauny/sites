/** Per-editor recovery records: no automatic replay and no shared-board cache. */
export class RecoveryDraft<T> {
  private owner = crypto.randomUUID();
  private observed?: { key: string; raw: string };
  private ownRaw?: string;
  private prefix: string;
  private storage: () => Storage;
  constructor(key: string, storage: () => Storage = () => localStorage) {
    this.storage = storage;
    this.prefix = `pinboard-recovery.v1:${key}:`;
  }
  read(validate: (value: unknown) => value is T): T | undefined {
    const storage = this.storage();
    let latest: { value: T; time: number; key: string; raw: string } | undefined;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(this.prefix)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const record = JSON.parse(raw) as { value: unknown; time: number };
      if (!validate(record.value) || !Number.isFinite(record.time))
        throw new Error('Unreadable recovery copy');
      if (!latest || record.time >= latest.time)
        latest = { value: record.value, time: record.time, key, raw };
    }
    if (latest) this.observed = latest;
    return latest?.value;
  }
  write(value: T): void {
    const raw = JSON.stringify({ value, time: Date.now() });
    this.storage().setItem(this.prefix + this.owner, raw);
    this.ownRaw = raw;
  }
  clear(): void {
    const storage = this.storage();
    if (this.ownRaw && storage.getItem(this.prefix + this.owner) === this.ownRaw)
      storage.removeItem(this.prefix + this.owner);
    if (this.observed && storage.getItem(this.observed.key) === this.observed.raw)
      storage.removeItem(this.observed.key);
    this.ownRaw = undefined;
    this.observed = undefined;
  }
}
