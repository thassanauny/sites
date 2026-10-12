/** Page-session drafts; local-only preferences and activity. No file contents are stored. */
export interface Activity { id: string; tool: string; message: string; status: 'done' | 'failed' | 'cancelled'; ts: number }
export interface Prefs { lastTool?: string }

const PREFIX = 'utility-desk:v1:';
export const MAX_ACTIVITY = 30;

export class Store {
  private drafts = new Map<string, Record<string, string>>();
  constructor(private kv: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {}

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.kv?.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch { return fallback; }
  }
  private write(key: string, value: unknown): boolean {
    try { this.kv?.setItem(PREFIX + key, JSON.stringify(value)); return !!this.kv; } catch { return false; }
  }

  getPrefs(): Prefs { return { ...this.read<Partial<Prefs>>('prefs', {}) }; }
  setPrefs(p: Partial<Prefs>) { this.write('prefs', { ...this.getPrefs(), ...p }); }

  getDraft(tool: string): Record<string, string> {
    this.removeSavedDraft(tool);
    return { ...this.drafts.get(tool) };
  }
  setDraft(tool: string, draft: Record<string, string>) { this.removeSavedDraft(tool); this.drafts.set(tool, { ...draft }); }
  clearDraft(tool?: string) {
    if (tool) { this.drafts.delete(tool); this.removeSavedDraft(tool); }
    else this.drafts.clear();
  }
  private removeSavedDraft(tool: string) {
    try { this.kv?.removeItem(`${PREFIX}draft:${tool}`); } catch { /* ignore */ }
  }

  getActivity(): Activity[] { return this.read<Activity[]>('activity', []); }
  addActivity(a: Omit<Activity, 'id' | 'ts'>): Activity {
    const entry: Activity = { ...a, id: Math.random().toString(36).slice(2, 10), ts: Date.now() };
    this.write('activity', [entry, ...this.getActivity()].slice(0, MAX_ACTIVITY));
    return entry;
  }
  clearActivity() { try { this.kv?.removeItem(`${PREFIX}activity`); } catch { /* ignore */ } }
}

function safeLocalStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
export const store = new Store(safeLocalStorage());
