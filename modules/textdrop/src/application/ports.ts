import type { DeviceSnippet, TextDropPage } from '../domain/snippets/model';

/** Shared snippet storage. The Supabase client in `infrastructure/cloud` implements it. */
export interface Cloud {
  subscribeSync?(listener: (at: Date) => void): () => void;
  offlineCapable?: boolean;
  stagePage?(id: string, text: string): Promise<TextDropPage>;
  syncPending?(): Promise<void>;
  renamePage?(id: string, name: string | null): Promise<TextDropPage>;
  listNames?(codes: string[]): Promise<{ code: string; name: string | null; version: number }[]>;
  createPage(id: string): Promise<TextDropPage>;
  joinPage(code: string): Promise<TextDropPage>;
  /**
   * Resolves to `null` when the server still has `knownVersion`, so a poll of unchanged text
   * costs a few bytes. Requires the current database's conditional poll API.
   */
  pollPage(id: string, knownVersion: number): Promise<TextDropPage | null>;
  savePage(id: string, text: string): Promise<TextDropPage>;
  /** Sets a damaged saved session aside so the next request signs in again. Valid sessions are never touched. */
  startNewSession(): Promise<void>;
}

/** The snippets this device has opened. Browser storage in `infrastructure/storage` implements it. */
export interface DeviceList {
  list(): DeviceSnippet[];
  /** An opaque guard that changes when the snippet is opened again or removed in another tab. */
  snapshot(code: string): string | null;
  isRemoved(code: string): boolean;
  remember(code: string, expected?: string | null): DeviceSnippet[];
  rename(code: string, name: string): DeviceSnippet[];
  sharedName?(code: string, name: string | null, version: number, pending?: boolean): DeviceSnippet[];
  remove(code: string): DeviceSnippet[];
  /** Whether a `storage` event key shows that another tab changed the list. */
  changedBy(key: string | null): boolean;
}

/** Unsaved editor recovery copies, separate from the durable automatic sync queue. */
export interface DraftRecovery {
  read(page: TextDropPage): string | undefined;
  write(page: TextDropPage, text: string): void;
  clear(page: TextDropPage): void;
}
