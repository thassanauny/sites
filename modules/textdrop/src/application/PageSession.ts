import { SessionDamagedError, validateText, type TextDropPage } from '../domain/snippets/model';
import { errorMessage } from './errorMessage';
import type { Cloud, DraftRecovery } from './ports';

export interface SessionState {
  page: TextDropPage | null;
  draft: string;
  phase: 'home' | 'opening' | 'ready' | 'saving';
  dirty: boolean;
  online: boolean;
  error: string;
  /** The error comes from a damaged saved browser session, which "Start a new session" repairs. */
  sessionDamaged: boolean;
  recoveryError: string;
}

/** What a poll found: newer text, nothing new, a failure, or nothing to ask (offline, no page, replaced page). */
export type RefreshResult = 'changed' | 'unchanged' | 'failed' | 'skipped';

function newPageId(): string {
  const randomness = globalThis.crypto;
  if (typeof randomness?.randomUUID === 'function') return randomness.randomUUID();
  if (typeof randomness?.getRandomValues !== 'function') throw new Error('Secure randomness is unavailable.');
  const bytes = randomness.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Local recovery never retries or publishes a restored draft without user action. */
export class PageSession {
  state: SessionState = {
    page: null,
    draft: '',
    phase: 'home',
    dirty: false,
    online: true,
    error: '',
    sessionDamaged: false,
    recoveryError: '',
  };
  private generation = 0;
  private edits = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saveInFlight: Promise<void> | undefined;
  private refreshInFlight: Promise<RefreshResult> | undefined;
  private createId: string | undefined;
  private firstEditAt: number | undefined;
  private listeners = new Set<(state: SessionState) => void>();
  private cloud: Cloud;
  private delay: number;
  private maxWait: number;

  /** `delay` is the pause after the last keystroke; `maxWait` is the longest an edit waits while typing continues. */
  private recovery?: DraftRecovery;
  constructor(cloud: Cloud, delay = 650, maxWait = 10_000, recovery?: DraftRecovery) {
    this.recovery = recovery;
    this.cloud = cloud;
    this.delay = delay;
    this.maxWait = maxWait;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<SessionState>): void {
    // Any new error text replaces the old cause; only `failure` knows whether the session is damaged.
    const cause = 'error' in patch && !('sessionDamaged' in patch) ? { sessionDamaged: false } : {};
    this.state = { ...this.state, ...patch, ...cause };
    for (const listener of this.listeners) listener(this.state);
  }

  private cancelTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.firstEditAt = undefined;
  }

  private schedule(): void {
    const burstStart = this.firstEditAt ?? Date.now();
    this.cancelTimer();
    if (this.state.online && this.state.dirty && !this.state.error) {
      // Each keystroke restarts the pause, but never beyond `maxWait` after the first unsaved edit.
      this.firstEditAt = burstStart;
      const wait = Math.min(this.delay, Math.max(0, burstStart + this.maxWait - Date.now()));
      this.timer = setTimeout(() => {
        void this.save();
      }, wait);
    }
  }

  private message(error: unknown): string {
    return errorMessage(error, 'Could not connect. Please try again.');
  }

  /** The state patch for a failed request. */
  private failure(error: unknown): Pick<SessionState, 'error' | 'sessionDamaged'> {
    return { error: this.message(error), sessionDamaged: error instanceof SessionDamagedError };
  }

  private async open(fetchPage: () => Promise<TextDropPage>): Promise<boolean> {
    const generation = ++this.generation;
    this.cancelTimer();
    this.saveInFlight = undefined;
    this.refreshInFlight = undefined;
    this.update({ page: null, draft: '', dirty: false, phase: 'opening', error: '' });
    try {
      const page = await fetchPage();
      if (generation !== this.generation) return false;
      let recovered: string | undefined;
      let recoveryError = '';
      try {
        recovered = this.recovery?.read(page);
      } catch {
        recoveryError = 'Could not read the local recovery copy. It has been kept on this device.';
      }
      const dirty = recovered !== undefined && recovered !== page.text;
      this.update({
        page,
        draft: dirty ? recovered! : page.text,
        dirty,
        phase: 'ready',
        recoveryError,
        error: dirty ? 'Recovered unsaved text from this device. Review it and choose Retry save to publish it.' : '',
      });
      return true;
    } catch (error) {
      if (generation === this.generation) this.update({ phase: 'home', ...this.failure(error) });
      return false;
    }
  }

  async create(): Promise<boolean> {
    try {
      this.createId ??= newPageId();
    } catch {
      this.update({ error: 'Could not create a snippet in this browser. Open the app over HTTPS or try another browser.' });
      return false;
    }
    const id = this.createId;
    const opened = await this.open(() => this.cloud.createPage(id));
    if (opened) this.createId = undefined;
    return opened;
  }

  join(code: string): Promise<boolean> {
    return this.open(() => this.cloud.joinPage(code));
  }

  discardRecovery(): boolean {
    if (!this.state.page) return true;
    try {
      this.recovery?.clear(this.state.page);
      return true;
    } catch {
      this.update({ recoveryError: 'Could not discard the local recovery copy. Your draft is kept.' });
      return false;
    }
  }

  home(): void {
    ++this.generation;
    this.cancelTimer();
    this.saveInFlight = undefined;
    this.refreshInFlight = undefined;
    this.update({ page: null, draft: '', dirty: false, phase: 'home', error: '', recoveryError: '' });
  }

  setOnline(online: boolean): void {
    this.update({
      online,
      ...(!online && this.state.dirty
        ? {
            error: 'Reconnect and choose Retry save. Keep this page open until your text is saved.',
          }
        : {}),
    });
    if (!online) this.cancelTimer();
    // Reconnection doesn't silently publish a failed draft. The user can retry.
  }

  edit(text: string): void {
    if (!this.state.page || !this.state.online || this.state.phase === 'opening') return;
    ++this.edits;
    let error = '';
    try {
      validateText(text);
    } catch (reason) {
      error = this.message(reason);
    }
    let recoveryError = '';
    try {
      this.recovery?.write(this.state.page, text);
    } catch {
      recoveryError = 'Could not save a local recovery copy. Keep this page open or download your text.';
    }
    this.update({ draft: text, dirty: true, error, recoveryError });
    this.schedule();
  }

  private remember(page: TextDropPage): void {
    const current = this.state.page;
    if (!current || current.id !== page.id || page.version <= current.version) return;
    this.update({ page, ...(!this.state.dirty ? { draft: page.text } : {}) });
  }

  refresh(): Promise<RefreshResult> {
    const page = this.state.page;
    const generation = this.generation;
    if (!page || !this.state.online) return Promise.resolve('skipped');
    if (this.refreshInFlight) return this.refreshInFlight;
    const request = Promise.resolve().then(async (): Promise<RefreshResult> => {
      try {
        if (generation !== this.generation || !this.state.online) return 'skipped';
        const remote = await this.cloud.pollPage(page.id, page.version);
        if (generation !== this.generation) return 'skipped';
        const known = this.state.page?.version;
        if (remote) this.remember(remote);
        // Only a sync error needs an update; an unchanged poll must not redraw the page.
        if (this.state.error && !this.state.dirty && this.state.phase === 'ready') this.update({ error: '' });
        return this.state.page?.version === known ? 'unchanged' : 'changed';
      } catch (error) {
        if (generation !== this.generation) return 'skipped';
        // A save completed after this poll began already confirmed a newer
        // server version. An older failed read must not replace that status.
        if (!this.state.dirty && this.state.page?.version === page.version) {
          this.update(this.failure(error));
        }
        return 'failed';
      } finally {
        if (this.refreshInFlight === request) this.refreshInFlight = undefined;
      }
    });
    this.refreshInFlight = request;
    return request;
  }

  /**
   * Sends an edit that is still waiting for its timer, for a page that is being hidden or closed.
   * It never retries a failed save or sends while offline: nothing is waiting then.
   */
  flush(): Promise<void> {
    if (this.timer === undefined) return Promise.resolve();
    const inFlight = this.saveInFlight;
    if (!inFlight) return this.save();
    const generation = this.generation;
    return inFlight.then(() => (generation === this.generation && this.timer !== undefined ? this.save() : undefined));
  }

  save(): Promise<void> {
    this.cancelTimer();
    if (this.saveInFlight) return this.saveInFlight;
    if (!this.state.page || !this.state.dirty || !this.state.online) return Promise.resolve();
    try {
      validateText(this.state.draft);
    } catch (error) {
      this.update({ error: this.message(error) });
      return Promise.resolve();
    }
    const generation = this.generation;
    const edit = this.edits;
    const page = this.state.page;
    const text = this.state.draft;
    this.update({ phase: 'saving', error: '' });
    const request = Promise.resolve().then(async () => {
      try {
        if (generation !== this.generation) return;
        if (!this.state.online) {
          this.update({ phase: 'ready' });
          return;
        }
        const saved = await this.cloud.savePage(page.id, text);
        if (generation !== this.generation) return;
        this.remember(saved);
        if (edit === this.edits) {
          // A newer poll may have arrived before this response. Keep that version.
          let recoveryError = '';
          try {
            this.recovery?.clear(page);
          } catch {
            recoveryError = 'Saved online, but the local recovery copy could not be cleared.';
          }
          this.update({ dirty: false, draft: this.state.page!.text, phase: 'ready', error: '', recoveryError });
        } else {
          this.update({ phase: 'ready' });
        }
      } catch (error) {
        if (generation === this.generation) {
          this.update({ phase: 'ready', ...this.failure(error) });
        }
      } finally {
        if (generation === this.generation) {
          this.saveInFlight = undefined;
          this.schedule();
        }
      }
    });
    this.saveInFlight = request;
    return request;
  }

  /** Repairs a damaged saved session; the next request signs in again. Text and codes on this device stay. */
  async startNewSession(): Promise<boolean> {
    try {
      await this.cloud.startNewSession();
    } catch (error) {
      this.update({ error: this.message(error), sessionDamaged: true });
      return false;
    }
    this.update({ error: '' });
    return true;
  }

  dispose(): void {
    ++this.generation;
    this.cancelTimer();
    this.saveInFlight = undefined;
    this.refreshInFlight = undefined;
    this.listeners.clear();
  }
}
