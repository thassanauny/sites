import { createClient, navigatorLock, type SupabaseClient } from '@supabase/supabase-js';
import type { Board, BoardHead, BoardSummary, Operation } from '../../domain/boards/types';
import { readBoardSummary } from '../../domain/boards/summary';
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

const BOARD_COLUMNS =
  'id,invite_code,title,description,columns,cards,revision,created_at,updated_at,card_fields';
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
  if (error.message === 'PINBOARD_ASSIGNEE_NOT_FOUND')
    return new Error('That assignee was removed. Choose another name or Unassigned.');
  if (
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    error.code === '42883' ||
    error.code === '42703' ||
    error.code === 'PGRST204'
  ) {
    return new Error('Board sharing needs database setup. See apps/pinboard/supabase/README.md.');
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

/** One request returns heads and changed summaries, never card documents. */
export async function loadBoardList(known: readonly BoardSummary[] = []): Promise<BoardSummary[]> {
  await initializeCloud();
  const { data, error } = await call('load your boards', () =>
    getClient().rpc('pinboard_sync_summaries', {
      p_known: Object.fromEntries(known.map((board) => [board.id, board.revision])),
    }),
  );
  if (error) throw serviceError(error, 'load your boards');
  if (data?.format !== 1 || !Array.isArray(data.heads) || !Array.isArray(data.boards))
    throw new Error('The server returned an invalid board list.');
  const held = new Map(known.map((board) => [board.id, board]));
  const changed = new Map<string, BoardSummary>();
  for (const row of data.boards) {
    const summary = readBoardSummary(row);
    if (changed.has(summary.id)) throw listChanged();
    changed.set(summary.id, summary);
  }
  const seen = new Set<string>();
  const result = data.heads.map((row: unknown) => {
    const head = readCloudHead(row);
    if (seen.has(head.id)) throw listChanged();
    seen.add(head.id);
    const summary = changed.get(head.id) || held.get(head.id);
    if (!summary || summary.revision !== head.revision) throw listChanged();
    return summary;
  });
  if ([...changed.keys()].some((id) => !seen.has(id))) throw listChanged();
  return result;
}

export async function loadBoard(id: string): Promise<Board> {
  const boardId = validateUuid(id, 'Board ID');
  await initializeCloud();
  ensureOnline();
  const { data, error } = await call('load your board', () =>
    getClient()
      .from('pinboard_boards')
      .select(BOARD_COLUMNS)
      .in('id', [boardId])
      .order('id', { ascending: true }),
  );
  if (error) throw serviceError(error, 'load your board');
  if (!Array.isArray(data) || data.length !== 1) throw listChanged();
  const board = readCloudBoard(data[0]);
  if (board.id !== boardId) throw listChanged();
  return board;
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
