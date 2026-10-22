import { createClient, navigatorLock, type SupabaseClient } from '@supabase/supabase-js';
import type { Cloud } from '../../application/ports';
import { normalizeCode, readPage, TextConflictError, validateName, validateText, validateUuid, type TextDropPage } from '../../domain/snippets/model';
import { discardDamagedSession, migrateLegacyAuthStorage, TEXTDROP_AUTH_KEY } from '../auth/sessionStorage';
import { fetchWithTimeout } from './requestTimeout';
import { listenForChanges } from './liveChanges';

interface ServiceError {
  code?: string;
  message?: string;
}

function ensureOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You are offline. Reconnect before opening or saving a snippet.');
  }
}

function serviceError(error: ServiceError, action: string): Error {
  if (error.message === 'TEXTDROP_INVALID_CODE') return new Error('That snippet code was not found. Check the code and try again.');
  if (error.message === 'TEXTDROP_ACCESS_DENIED') return new Error('You no longer have access to this snippet. Join again using its code.');
  if (error.message === 'TEXTDROP_PAGE_LIMIT') return new Error('This browser session has reached the supported number of shared snippets.');
  if (error.message === 'TEXTDROP_VERSION_LIMIT') return new Error('This snippet has reached its supported number of saves. Create a new snippet.');
  if (error.message === 'TEXTDROP_INVALID_NAME') return new Error('A snippet name supports up to 80 characters without control characters.');
  if (error.message === 'TEXTDROP_INVALID_TEXT') return new Error('A snippet supports up to 1 MiB of UTF-8 text.');
  if (error.message === 'TEXTDROP_INVALID_PAGE') return new Error('The snippet ID is invalid. Create a new snippet and try again.');
  if (error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42P01' || error.code === '42883') {
    return new Error('TextDrop needs database setup or an update. Follow apps/textdrop/supabase/README.md, then reload the app.');
  }
  if (/anonymous.*(?:disabled|not allowed)|anonymous_provider_disabled/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
    return new Error('Enable anonymous sign-ins in Supabase Authentication to share text snippets.');
  }
  if (error.message === 'TEXTDROP_AUTH_REQUIRED' || error.code === 'PGRST301' || error.code === 'PGRST303') {
    return new Error('Your TextDrop session could not be verified. Reload the app and try again.');
  }
  if (/fetch|network|connection|failed to send|load failed/i.test(error.message ?? '')) {
    return new Error('Could not connect to shared snippets. Check your connection and try again.');
  }
  return new Error(`Could not ${action}. ${error.message || 'Please try again.'}`);
}

async function call<T>(action: string, attempt: () => PromiseLike<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    const details = error && typeof error === 'object' ? (error as ServiceError) : {};
    throw serviceError(details, action);
  }
}

const INVALID_RESPONSE = 'The server returned invalid snippet data. Refresh the app or check the database setup.';

/** Whether a poll reply says the known version is still current; a malformed "unchanged" reply is an error. */
function isUnchanged(data: unknown, id: string, known: number): boolean {
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).unchanged !== true) return false;
  const reply = data as Record<string, unknown>;
  if (Object.keys(reply).sort().join() !== 'id,unchanged,version' || reply.id !== id || reply.version !== known) throw new Error(INVALID_RESPONSE);
  return true;
}

function privateKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  try {
    const encoded = key.split('.')[1];
    return Boolean(encoded && JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role');
  } catch {
    return false;
  }
}

async function textHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

/** Remote API; the offline adapter separately owns cached content and pending edits. */
export function createCloud(url: string, key: string): Cloud {
  const projectUrl = url.trim();
  const publicKey = key.trim();
  let client: SupabaseClient | undefined;
  let authentication: Promise<void> | undefined;

  function getClient(): SupabaseClient {
    if (!projectUrl || !publicKey) throw new Error('Text sharing is not configured. Add the public Supabase settings and rebuild the app.');
    if (privateKey(publicKey)) throw new Error('Use the Supabase public anon or publishable key for text sharing.');
    if (!client) {
      try {
        client = createClient(projectUrl, publicKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: TEXTDROP_AUTH_KEY, ...(globalThis.navigator?.locks ? { lock: navigatorLock } : {}) },
          global: { fetch: fetchWithTimeout() },
        });
      } catch {
        throw new Error('The Supabase settings are invalid. Check the project URL and public API key.');
      }
    }
    return client;
  }

  async function initialize(): Promise<void> {
    ensureOnline();
    if (!authentication) {
      authentication = (async () => {
        await migrateLegacyAuthStorage();
        const supabase = getClient();
        const { data, error } = await call('restore your TextDrop session', () => supabase.auth.getSession());
        if (error) throw serviceError(error, 'restore your TextDrop session');
        if (data.session) return;
        ensureOnline();
        const result = await call('start your TextDrop session', () => supabase.auth.signInAnonymously());
        if (result.error) throw serviceError(result.error, 'start your TextDrop session');
        if (!result.data.session) throw new Error('Supabase did not create a TextDrop session. Please try again.');
      })().finally(() => {
        authentication = undefined;
      });
    }
    await authentication;
    ensureOnline();
  }

  async function rpc(action: string, name: string, args: Record<string, unknown>): Promise<TextDropPage> {
    await initialize();
    const { data, error } = await call(action, () => getClient().rpc(name, args));
    if (error) throw serviceError(error, action);
    return parsePage(data);
  }

  function parsePage(data: unknown): TextDropPage {
    try {
      if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'name')) throw new Error(INVALID_RESPONSE);
      return readPage(data);
    } catch {
      throw new Error(INVALID_RESPONSE);
    }
  }

  return {
    initialize,
    subscribeChanges: (listener, health = () => {}) => {
      health(false);
      let stopped = false;
      let dispose: (() => void) | undefined;
      void initialize()
        .then(() => {
          if (!stopped) dispose = listenForChanges(getClient(), listener, health);
        })
        .catch(() => {});
      return () => {
        stopped = true;
        dispose?.();
        health(false);
      };
    },
    renameCheckedPage: async (id, name, cached) => {
      const pageId = validateUuid(id);
      if (cached.id !== pageId) throw new Error(INVALID_RESPONSE);
      const hash = await textHash(validateText(cached.text));
      await initialize();
      const action = 'save the snippet name';
      const { data, error } = await call(action, () => getClient().rpc('textdrop_rename_checked', { p_id: pageId, p_name: validateName(name), p_text_hash: hash }));
      if (error) throw serviceError(error, action);
      const page = parsePage({ text: cached.text, ...data });
      if (page.id !== pageId) throw new Error(INVALID_RESPONSE);
      return page;
    },
    saveCheckedPage: async (id, text, save) => {
      const pageId = validateUuid(id);
      const sent = validateText(text);
      const base = validateText(save.baseText);
      if (!Number.isSafeInteger(save.baseVersion) || save.baseVersion < 1) throw new Error(INVALID_RESPONSE);
      const operationId = validateUuid(save.operationId ?? crypto.randomUUID());
      const baseHash = await textHash(base);
      await initialize();
      const action = 'save the snippet';
      const { data, error } = await call(action, () =>
        getClient().rpc('textdrop_save_checked', { p_id: pageId, p_text: sent, p_expected: save.baseVersion, p_base_hash: baseHash, p_operation_id: operationId }),
      );
      if (error) throw serviceError(error, action);
      if (data && typeof data === 'object' && Object.keys(data).join() === 'conflict') {
        const page = parsePage(data.conflict);
        if (page.id !== pageId) throw new Error(INVALID_RESPONSE);
        throw new TextConflictError(page);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.hasOwn(data, 'text')) throw new Error(INVALID_RESPONSE);
      const page = parsePage({ ...data, text: sent });
      if (page.id !== pageId) throw new Error(INVALID_RESPONSE);
      return page;
    },
    renamePage: async (id, name) => {
      const pageId = validateUuid(id);
      const page = await rpc('save the snippet name', 'textdrop_rename_page', { p_id: pageId, p_name: validateName(name) });
      if (page.id !== pageId) throw new Error(INVALID_RESPONSE);
      return page;
    },
    listNames: async codes => {
      const normalized = codes.map(normalizeCode);
      if (normalized.length > 1000) throw new Error('Too many snippets to refresh.');
      if (!normalized.length) return [];
      await initialize();
      const { data, error } = await call('refresh snippet names', () => getClient().rpc('textdrop_names', { p_codes: normalized }));
      if (error) throw serviceError(error, 'refresh snippet names');
      if (!Array.isArray(data)) throw new Error(INVALID_RESPONSE);
      const seen = new Set<string>();
      return data.map(row => {
        if (
          !row ||
          typeof row !== 'object' ||
          Object.keys(row).sort().join() !== 'code,name,version' ||
          !normalized.includes(row.code) ||
          seen.has(row.code) ||
          !Number.isSafeInteger(row.version) ||
          row.version < 1
        )
          throw new Error(INVALID_RESPONSE);
        seen.add(row.code);
        return { code: row.code, name: validateName(row.name), version: row.version };
      });
    },
    createPage: async id => {
      const pageId = validateUuid(id);
      const page = await rpc('create the snippet', 'textdrop_create_page', { p_id: pageId });
      if (page.id !== pageId) throw new Error('The server returned a different snippet. Refresh the app and try again.');
      return page;
    },
    joinPage: async code => {
      const normalized = normalizeCode(code);
      const page = await rpc('join the snippet', 'textdrop_join_page', { p_code: normalized });
      if (page.code !== normalized) throw new Error('The server returned a different code. Check the code and try again.');
      return page;
    },
    pollPage: async (id, knownVersion) => {
      const pageId = validateUuid(id);
      await initialize();
      const action = 'load the snippet';
      const { data, error } = await call(action, () => getClient().rpc('textdrop_poll_page', { p_id: pageId, p_known: knownVersion }));
      if (error) throw serviceError(error, action);
      if (isUnchanged(data, pageId, knownVersion)) return null;
      const page = parsePage(data);
      if (page.id !== pageId) throw new Error('The server returned a different snippet. Refresh the app and try again.');
      return page;
    },
    startNewSession: async () => {
      await discardDamagedSession();
      await client?.auth.stopAutoRefresh();
      client = undefined;
      authentication = undefined;
    },
    savePage: async (id, text) => {
      const pageId = validateUuid(id);
      const sent = validateText(text);
      await initialize();
      const action = 'save the snippet';
      const { data, error } = await call(action, () => getClient().rpc('textdrop_save_page_receipt', { p_id: pageId, p_text: sent }));
      if (error) throw serviceError(error, action);
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.hasOwn(data, 'text')) throw new Error(INVALID_RESPONSE);
      // The receipt acknowledges the exact literal text sent, under the same server save/lock rules.
      const page = parsePage({ ...data, text: sent });
      if (page.id !== pageId) throw new Error('The server returned a different snippet. Refresh the app and try again.');
      return page;
    },
  };
}
