import type { RefreshResult } from './PageSession';

const ACTIVE_MS = 3000;
const QUIET_MS = 10_000;
const IDLE_MS = 30_000;
const QUIET_AFTER_MS = 60_000;
const IDLE_AFTER_MS = 300_000;

/**
 * Decides when the open page asks for newer text. It asks every 3 seconds while the page is in use,
 * every 10 seconds after a quiet minute and every 30 seconds after five quiet minutes. Failed requests
 * double the wait (6, 12, 24, then 30 seconds) until one succeeds. `wake` asks at once.
 */
export class RefreshScheduler {
  private refresh: () => Promise<RefreshResult>;
  private visible: () => boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private failures = 0;
  private lastActivity = Date.now();
  private armedDelay = ACTIVE_MS;

  constructor(refresh: () => Promise<RefreshResult>, visible: () => boolean) {
    this.refresh = refresh;
    this.visible = visible;
  }

  start(): void {
    this.stopped = false;
    this.lastActivity = Date.now();
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The person is using the page: go back to the quick pace without restarting a quick timer. */
  activity(): void {
    this.lastActivity = Date.now();
    if (!this.stopped && this.armedDelay > ACTIVE_MS && this.failures === 0) this.arm();
  }

  /** Asks now (focus, page visible again, connection back). Simultaneous calls share one request. */
  wake(): Promise<void> {
    this.lastActivity = Date.now();
    return this.refreshNow();
  }

  private delay(): number {
    if (this.failures > 0) return Math.min(ACTIVE_MS * 2 ** this.failures, IDLE_MS);
    const quiet = Date.now() - this.lastActivity;
    return quiet >= IDLE_AFTER_MS ? IDLE_MS : quiet >= QUIET_AFTER_MS ? QUIET_MS : ACTIVE_MS;
  }

  private arm(): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.armedDelay = this.delay();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.visible()) void this.refreshNow();
      else this.arm();
    }, this.armedDelay);
  }

  private refreshNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    const request = this.refresh()
      .catch((): RefreshResult => 'failed')
      .then(result => {
        if (this.stopped) return;
        if (result === 'failed') this.failures += 1;
        else if (result !== 'skipped') this.failures = 0;
        if (result === 'changed') this.lastActivity = Date.now();
      })
      .finally(() => {
        if (this.running === request) this.running = undefined;
        this.arm();
      });
    this.running = request;
    return request;
  }
}
