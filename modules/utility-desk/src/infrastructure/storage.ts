/** Tool drafts live in memory until the page reloads. Only the last 30 activity entries persist, in localStorage. No file contents are stored. */
export interface Activity {
  id: string;
  tool: string;
  message: string;
  status: 'done' | 'failed' | 'cancelled';
  ts: number;
}

const PREFIX = 'utility-desk:v1:';
export const ACTIVITY_KEY = `${PREFIX}activity`;
export const MAX_ACTIVITY = 30;

function isActivity(value: unknown): value is Activity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && row.id.length > 0 && typeof row.tool === 'string' && row.tool.length > 0 && typeof row.message === 'string' && ['done', 'failed', 'cancelled'].includes(row.status as string) && typeof row.ts === 'number' && Number.isFinite(row.ts) && row.ts >= 0 && row.ts <= 8_640_000_000_000_000;
}

export class Store {
  private drafts = new Map<string, Record<string, string>>();
  constructor(private kv: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {}

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.kv?.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  private write(key: string, value: unknown): boolean {
    try {
      this.kv?.setItem(PREFIX + key, JSON.stringify(value));
      return !!this.kv;
    } catch {
      return false;
    }
  }

  getDraft(tool: string): Record<string, string> {
    return { ...this.drafts.get(tool) };
  }
  setDraft(tool: string, draft: Record<string, string>) {
    this.drafts.set(tool, { ...draft });
  }
  clearDraft(tool?: string) {
    if (tool) {
      this.drafts.delete(tool);
    } else this.drafts.clear();
  }

  getActivity(): Activity[] {
    const saved = this.read<unknown>('activity', []);
    if (!Array.isArray(saved)) return [];
    const seen = new Set<string>();
    const entries: Activity[] = [];
    for (const row of saved) {
      if (!isActivity(row) || seen.has(row.id)) continue;
      seen.add(row.id);
      entries.push(row);
      if (entries.length === MAX_ACTIVITY) break;
    }
    return entries;
  }
  addActivity(a: Omit<Activity, 'id' | 'ts'>): Activity {
    const entry: Activity = { ...a, id: Math.random().toString(36).slice(2, 10), ts: Date.now() };
    this.write('activity', [entry, ...this.getActivity()].slice(0, MAX_ACTIVITY));
    return entry;
  }
  clearActivity() {
    try {
      this.kv?.removeItem(`${PREFIX}activity`);
    } catch {
      /* ignore */
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
export const store = new Store(safeLocalStorage());
