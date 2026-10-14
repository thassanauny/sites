import { createClient, navigatorLock, type SupabaseClient } from '@supabase/supabase-js';
import type { Board, BoardHead, Operation } from '../../domain/boards/types';
import {
  normalizeInviteCode,
  readBoard,
  readBoardHead,
  validateBoardDetails,
  validateOperation,
  validateUuid,
} from '../../domain/boards/board';
import {
  AUTH_STORAGE_KEY,
  migratePinboardSession,
  SessionRecoveryError,
  startNewPinboardSession,
} from '../auth/migrateSession';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
export const cloudConfigured = Boolean(supabaseUrl && supabaseKey);

/** Rows requested per page; the API may return fewer. */
const PAGE_SIZE = 100;
const BOARD_COLUMNS =
  'id,invite_code,title,description,columns,cards,revision,created_at,updated_at';
/** A stalled connection must end in an error instead of leaving every edit waiting. */
const REQUEST_TIMEOUT_MS = 30_000;

let client: SupabaseClient | undefined;
let authentication: Promise<void> | undefined;

interface ServiceError {
  code?: string;
  message?: string;
}

/** Every request, including sign-in, ends after the timeout. The timer is left running so a stalled response body is cut off too. */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  setTimeout(
    () => controller.abort(new DOMException('The request took too long.', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  );
  const caller = init?.signal;
  if (caller?.aborted) controller.abort(caller.reason);
  else
    caller?.addEventListener('abort', () => controller.abort(caller.reason), {
      once: true,
    });
  return fetch(input, { ...init, signal: controller.signal });
}

function getClient(): SupabaseClient {
  if (!cloudConfigured)
    throw new Error(
      'Board sharing is not configured. Add the Supabase settings and rebuild the app.',
    );
  if (!client) {
    try {
      client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: AUTH_STORAGE_KEY,
          ...(globalThis.navigator?.locks ? { lock: navigatorLock } : {}),
        },
        global: { fetch: fetchWithTimeout },
      });
    } catch {
      throw new Error(
        'The Supabase settings are invalid. Check the project URL and public API key.',
      );
    }
  }
  return client;
}

function ensureOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You are offline. Reconnect before loading or changing boards.');
  }
}

function serviceError(error: ServiceError, action: string): Error {
  if (error.message === 'PINBOARD_INVALID_INVITE')
    return new Error('That invite code was not found. Check the code and try again.');
  if (error.message === 'PINBOARD_ACCESS_DENIED')
    return new Error('You no longer have access to this board. Join again using its invite code.');
  if (error.message === 'PINBOARD_BOARD_LIMIT')
    return new Error('This session has reached the supported number of shared boards.');
  if (error.message === 'PINBOARD_INVALID_BOARD' || error.message === 'PINBOARD_INVALID_OPERATION')
    return new Error('The board action contains invalid data. Review the fields and try again.');
  if (error.message === 'PINBOARD_BOARD_TOO_LARGE')
    return new Error('This board is full. Delete some cards or shorten descriptions first.');
  if (error.message === 'PINBOARD_COLUMN_NOT_FOUND')
    return new Error('That column was removed. Refresh the board and choose another column.');
  if (error.message === 'PINBOARD_CARD_NOT_FOUND')
    return new Error('That card was removed. Refresh the board to see the latest changes.');
  if (
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    error.code === '42883'
  ) {
    return new Error(
      'Board sharing needs database setup. See everydayapps/apps/pinboard/supabase/README.md.',
    );
  }
  if (
    /anonymous.*(?:disabled|not allowed)|anonymous_provider_disabled/i.test(
      `${error.code ?? ''} ${error.message ?? ''}`,
    )
  ) {
    return new Error('Enable anonymous sign-ins in Supabase Authentication to use shared boards.');
  }
  if (
    error.message === 'PINBOARD_AUTH_REQUIRED' ||
    error.code === 'PGRST301' ||
    error.code === 'PGRST303'
  ) {
    return new Error('Your board session could not be verified. Reload the app and try again.');
  }
  if (/took too long|timed? ?out|timeout|abort/i.test(error.message ?? '')) {
    return new Error('The request took too long. Check your connection and try again.');
  }
  if (/fetch|network|connection|failed to send|load failed/i.test(error.message ?? '')) {
    return new Error('Could not connect to shared boards. Check your connection and try again.');
  }
  return new Error(`Could not ${action}. ${error.message || 'Please try again.'}`);
}

async function call<T>(action: string, attempt: () => PromiseLike<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    throw serviceError(error instanceof Error ? error : {}, action);
  }
}

/** Only the session is persisted. Boards are always loaded from Supabase. */
export async function initializeCloud(): Promise<void> {
  ensureOnline();
  if (!authentication) {
    authentication = (async () => {
      if (!client && typeof window !== 'undefined') {
        try {
          await migratePinboardSession(window.localStorage);
        } catch (failure) {
          if (failure instanceof SessionRecoveryError) throw failure;
          throw new Error(
            'Could not restore your saved board session. Your original credentials are preserved. Check browser storage and reload.',
          );
        }
      }
      const supabase = getClient();
      const { data, error } = await call('restore your board session', () =>
        supabase.auth.getSession(),
      );
      if (error) throw serviceError(error, 'restore your board session');
      if (data.session) return;
      ensureOnline();
      const result = await call('start your board session', () =>
        supabase.auth.signInAnonymously(),
      );
      if (result.error) throw serviceError(result.error, 'start your board session');
      if (!result.data.session)
        throw new Error('Supabase did not create a board session. Please try again.');
    })().finally(() => {
      authentication = undefined;
    });
  }
  await authentication;
}

/** Back up a damaged stored session and clear it so the next start can begin a new one. */
export async function startNewSession(): Promise<void> {
  try {
    await startNewPinboardSession(window.localStorage);
  } catch (failure) {
    if (failure instanceof SessionRecoveryError) throw failure;
    throw new Error('Could not start a new session. Check browser storage and reload.');
  }
}

function readCloudBoard(input: unknown): Board {
  try {
    return readBoard(input);
  } catch {
    throw new Error(
      'The server returned invalid board data. Refresh the app or check the database setup.',
    );
  }
}

function readCloudHead(input: unknown): BoardHead {
  try {
    return readBoardHead(input);
  } catch {
    throw new Error(
      'The server returned invalid board data. Refresh the app or check the database setup.',
    );
  }
}

const listChanged = () => new Error('The board list changed while loading. Refresh and try again.');

/** Walk the joined boards in stable ID order, however many rows each page returns. */
async function readPages<T extends { id: string }>(
  select: string,
  read: (row: unknown) => T,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    ensureOnline();
    // RLS restricts this table to joined boards; stable ID order survives other members' edits.
    const { data, error, count } = await call('load your boards', () =>
      getClient()
        .from('pinboard_boards')
        .select(select, { count: 'exact' })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1),
    );
    if (error) throw serviceError(error, 'load your boards');
    if (
      !Array.isArray(data) ||
      !Number.isSafeInteger(count) ||
      count === null ||
      count < 0 ||
      offset + data.length > count ||
      (data.length === 0 && offset < count)
    ) {
      throw new Error('The server returned an invalid board list.');
    }
    for (const row of data) {
      const item = read(row);
      if (seen.has(item.id)) throw listChanged();
      seen.add(item.id);
      items.push(item);
    }
    offset += data.length;
    if (offset >= count) return items;
  }
}

/** Fetch whole boards by ID. A board that cannot be returned means the list changed, never a partial result. */
async function readBoardsById(ids: string[]): Promise<Board[]> {
  const boards: Board[] = [];
  const received = new Set<string>();
  let pending = ids;
  while (pending.length > 0) {
    const wanted = pending.slice(0, PAGE_SIZE);
    ensureOnline();
    const { data, error } = await call('load your boards', () =>
      getClient()
        .from('pinboard_boards')
        .select(BOARD_COLUMNS)
        .in('id', wanted)
        .order('id', { ascending: true }),
    );
    if (error) throw serviceError(error, 'load your boards');
    if (!Array.isArray(data) || data.length === 0) throw listChanged();
    for (const row of data) {
      const board = readCloudBoard(row);
      if (!wanted.includes(board.id) || received.has(board.id)) throw listChanged();
      received.add(board.id);
      boards.push(board);
    }
    pending = pending.filter((id) => !received.has(id));
  }
  return boards;
}

/**
 * Every joined board. When the caller already holds boards, a poll first reads only each board's ID and revision
 * and downloads just the boards whose revision differs, so an idle tab costs a few bytes per board.
 */
export async function loadBoards(known: readonly Board[] = []): Promise<Board[]> {
  await initializeCloud();
  if (known.length === 0) return readPages(BOARD_COLUMNS, readCloudBoard);
  const heads = await readPages('id,revision', readCloudHead);
  const held = new Map(known.map((board) => [board.id, board]));
  const changed = heads
    .filter((head) => held.get(head.id)?.revision !== head.revision)
    .map((head) => head.id);
  const downloaded = new Map((await readBoardsById(changed)).map((board) => [board.id, board]));
  return heads.map((head) => downloaded.get(head.id) ?? held.get(head.id)!);
}

export async function createBoard(id: string, title: string, description: string): Promise<Board> {
  const boardId = validateUuid(id, 'Board ID');
  const details = validateBoardDetails(title, description);
  await initializeCloud();
  ensureOnline();
  // The caller retains this ID until success so a lost response can be retried safely.
  const { data, error } = await call('create the board', () =>
    getClient().rpc('pinboard_create_board', {
      p_id: boardId,
      p_title: details.title,
      p_description: details.description,
    }),
  );
  if (error) throw serviceError(error, 'create the board');
  const board = readCloudBoard(data);
  if (board.id !== boardId)
    throw new Error('The server returned a different board. Refresh the app and try again.');
  return board;
}

export async function joinBoard(code: string): Promise<Board> {
  const normalized = normalizeInviteCode(code);
  await initializeCloud();
  ensureOnline();
  const { data, error } = await call('join the board', () =>
    getClient().rpc('pinboard_join_board', { p_code: normalized }),
  );
  if (error) throw serviceError(error, 'join the board');
  const board = readCloudBoard(data);
  if (board.invite_code !== normalized)
    throw new Error('The server returned a different invitation. Check the code and try again.');
  return board;
}

export async function mutateBoard(boardId: string, operation: Operation): Promise<Board> {
  const id = validateUuid(boardId, 'Board ID');
  const payload = validateOperation(operation);
  await initializeCloud();
  ensureOnline();
  const { data, error } = await call('save your changes', () =>
    getClient().rpc('pinboard_mutate_board', {
      p_board_id: id,
      p_operation: payload,
    }),
  );
  if (error) throw serviceError(error, 'save your changes');
  const board = readCloudBoard(data);
  if (board.id !== id)
    throw new Error('The server returned a different board. Refresh the app and try again.');
  return board;
}
