import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloud } from './snippets';
import { MAX_TEXT_BYTES, SessionDamagedError } from '../../domain/snippets/model';
import { TEXTDROP_AUTH_KEY } from '../auth/sessionStorage';

const mock = vi.hoisted(() => {
  const getSession = vi.fn();
  const signInAnonymously = vi.fn();
  const rpc = vi.fn();
  const stopAutoRefresh = vi.fn();
  const client = { auth: { getSession, signInAnonymously, stopAutoRefresh }, rpc };
  return { getSession, signInAnonymously, stopAutoRefresh, rpc, createClient: vi.fn(() => client) };
});
vi.mock('@supabase/supabase-js', async original => ({ ...(await original<object>()), createClient: mock.createClient }));

const page = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'a'.repeat(32),
  text: 'Shared text',
  name: null as string | null,
  version: 1,
  updatedAt: '2026-10-10T01:00:00.123456+00:00',
};
const receipt = ({ id, code, version, updatedAt, name }: typeof page) => ({ id, code, version, updatedAt, name });

function cloud() {
  return createCloud(' https://test-project.supabase.co ', ' public-test-key ');
}

const operationId = '55555555-5555-4555-8555-555555555555';
const baseHash = '3d9b693b09d65a614b9eb60d0f3d99bcdc63ec0336089dad85c9d09085070864';
function save(shared: ReturnType<typeof cloud>, id: string, text: string) {
  return shared.saveCheckedPage(id, text, { baseVersion: page.version, baseText: page.text, operationId });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { onLine: true });
  mock.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null });
  mock.signInAnonymously.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null });
  mock.rpc.mockResolvedValue({ data: page, error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('online snippet sharing', () => {
  it('requires public configuration and never initializes a client with secret keys', async () => {
    await expect(createCloud('', '').pollPage(page.id, 0)).rejects.toThrow('not configured');
    await expect(createCloud('https://test-project.supabase.co', 'sb_secret_private').pollPage(page.id, 0)).rejects.toThrow('public anon');
    const serviceKey = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
    await expect(createCloud('https://test-project.supabase.co', serviceKey).pollPage(page.id, 0)).rejects.toThrow('public anon');
    expect(mock.createClient).not.toHaveBeenCalled();
  });

  it('blocks saved authentication with malformed current credentials before creating a new identity', async () => {
    const values = new Map([[TEXTDROP_AUTH_KEY, '{malformed']]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    vi.stubGlobal('window', { localStorage: storage });
    await expect(cloud().pollPage(page.id, 0)).rejects.toBeInstanceOf(SessionDamagedError);
    expect(values.get(TEXTDROP_AUTH_KEY)).toBe('{malformed');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('reports browser storage read failures before creating a cloud client', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('Storage denied');
        },
      },
    });
    await expect(cloud().pollPage(page.id, 0)).rejects.toThrow('Could not preserve your existing TextDrop session');
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('shares concurrent auth checks and stores only a session under its own key', async () => {
    const shared = cloud();
    await Promise.all([shared.pollPage(page.id, 0), shared.pollPage(page.id, 0), shared.joinPage(page.code)]);
    expect(mock.getSession).toHaveBeenCalledTimes(1);
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(mock.createClient).toHaveBeenCalledWith('https://test-project.supabase.co', 'public-test-key', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'textdrop-auth' },
      global: { fetch: expect.any(Function) },
    });
  });

  it('coordinates ordinary auth writers across tabs through the SDK browser lock', async () => {
    vi.stubGlobal('navigator', { onLine: true, locks: { request: vi.fn() } });
    await cloud().pollPage(page.id, 0);
    const options = (mock.createClient.mock.calls as unknown[][])[0]![2] as { auth: { lock: unknown } };
    const { navigatorLock } = await import('@supabase/supabase-js');
    expect(options.auth.lock).toBe(navigatorLock);
  });

  it('starts one anonymous identity when concurrent actions lack a saved session', async () => {
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const shared = cloud();
    await Promise.all([shared.pollPage(page.id, 0), shared.joinPage(page.code)]);
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1);
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await shared.pollPage(page.id, 0);
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(2);
  });

  it('can retry authentication after a network error or a missing returned session', async () => {
    const shared = cloud();
    mock.getSession.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(shared.pollPage(page.id, 0)).rejects.toThrow('Check your connection');
    await expect(shared.pollPage(page.id, 0)).resolves.toEqual(page);
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    mock.signInAnonymously.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(shared.pollPage(page.id, 0)).rejects.toThrow('did not create');
  });

  it('refuses offline reads, creation, joins, and writes without contacting Supabase', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const shared = cloud();
    await expect(shared.createPage(page.id)).rejects.toThrow('offline');
    await expect(shared.joinPage(page.code)).rejects.toThrow('offline');
    await expect(shared.pollPage(page.id, 0)).rejects.toThrow('offline');
    await expect(save(shared, page.id, 'Changes')).rejects.toThrow('offline');
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('checks connectivity again after session restoration', async () => {
    mock.getSession.mockImplementationOnce(async () => {
      vi.stubGlobal('navigator', { onLine: false });
      return { data: { session: {} }, error: null };
    });
    await expect(save(cloud(), page.id, 'Changes')).rejects.toThrow('offline');
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('does not create an anonymous identity after disconnecting during session restoration and can retry online', async () => {
    const shared = cloud();
    mock.getSession.mockImplementationOnce(async () => {
      vi.stubGlobal('navigator', { onLine: false });
      return { data: { session: null }, error: null };
    });
    await expect(shared.joinPage(page.code)).rejects.toThrow('offline');
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', { onLine: true });
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(shared.joinPage(page.code)).resolves.toEqual(page);
    expect(mock.createClient).toHaveBeenCalledTimes(1);
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('textdrop_join_page', { p_code: page.code });
  });

  it('uses only app RPCs and returns whole-snippet server versions with checked save metadata', async () => {
    const shared = cloud();
    await shared.createPage(page.id);
    await shared.joinPage(` ${'A'.repeat(16)}-${'A'.repeat(16)}\n`);
    await shared.pollPage(page.id, 0);
    const saved = { ...page, text: 'A new text\n  ', version: 2 };
    mock.rpc.mockResolvedValueOnce({ data: receipt(saved), error: null });
    await expect(save(shared, page.id, saved.text)).resolves.toEqual(saved);
    expect(mock.rpc.mock.calls).toEqual([
      ['textdrop_create_page', { p_id: page.id }],
      ['textdrop_join_page', { p_code: page.code }],
      ['textdrop_poll_page', { p_id: page.id, p_known: 0 }],
      ['textdrop_save_checked', { p_id: page.id, p_text: saved.text, p_expected: 1, p_base_hash: baseHash, p_operation_id: operationId }],
    ]);
  });

  it('keeps create IDs stable after a lost response and never silently retries a text write', async () => {
    const shared = cloud();
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await expect(shared.createPage(page.id)).rejects.toThrow('Check your connection');
    await expect(shared.createPage(page.id)).resolves.toEqual(page);
    expect(mock.rpc.mock.calls.slice(0, 2)).toEqual([
      ['textdrop_create_page', { p_id: page.id }],
      ['textdrop_create_page', { p_id: page.id }],
    ]);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await expect(save(shared, page.id, 'Changes')).rejects.toThrow('Check your connection');
    expect(mock.rpc).toHaveBeenCalledTimes(3);
  });

  it('validates inputs before authentication or network requests', async () => {
    const shared = cloud();
    await expect(shared.createPage('bad')).rejects.toThrow('ID');
    await expect(shared.pollPage('bad', 0)).rejects.toThrow('ID');
    await expect(shared.joinPage('abc')).rejects.toThrow('32-character');
    await expect(save(shared, page.id, 'x'.repeat(MAX_TEXT_BYTES + 1))).rejects.toThrow('1 MiB');
    await expect(save(shared, page.id, '\u0000')).rejects.toThrow('cannot be saved');
    expect(mock.getSession).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('rejects missing save text before authentication while allowing an intentional empty snippet', async () => {
    const shared = cloud();
    await expect(save(shared, page.id, undefined as unknown as string)).rejects.toThrow('must contain text');
    expect(mock.getSession).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.rpc.mockResolvedValueOnce({ data: receipt({ ...page, version: 2 }), error: null });
    await expect(save(shared, page.id, '')).resolves.toEqual({ ...page, text: '', version: 2 });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('textdrop_save_checked', { p_id: page.id, p_text: '', p_expected: 1, p_base_hash: baseHash, p_operation_id: operationId });
  });

  it('rejects malformed responses or a response for another snippet or code', async () => {
    const shared = cloud();
    mock.rpc.mockResolvedValueOnce({ data: { ...page, version: 0 }, error: null });
    await expect(shared.pollPage(page.id, 0)).rejects.toThrow('invalid snippet data');
    mock.rpc.mockResolvedValueOnce({ data: receipt({ ...page, id: '33333333-3333-4333-8333-333333333333' }), error: null });
    await expect(save(shared, page.id, 'Changes')).rejects.toThrow('invalid snippet data');
    mock.rpc.mockResolvedValueOnce({ data: { ...page, code: 'b'.repeat(32) }, error: null });
    await expect(shared.joinPage(page.code)).rejects.toThrow('different code');
  });

  it('explains schema, access, code, limit, and disabled-auth errors', async () => {
    const shared = cloud();
    for (const [error, expected] of [
      [{ code: 'PGRST202', message: 'missing function' }, 'supabase/README.md'],
      [{ message: 'TEXTDROP_ACCESS_DENIED' }, 'Join again'],
      [{ message: 'TEXTDROP_INVALID_CODE' }, 'not found'],
      [{ message: 'TEXTDROP_PAGE_LIMIT' }, 'supported number'],
      [{ message: 'TEXTDROP_INVALID_TEXT' }, '1 MiB'],
      [{ message: 'TEXTDROP_AUTH_REQUIRED' }, 'could not be verified'],
    ] as const) {
      mock.rpc.mockResolvedValueOnce({ data: null, error });
      await expect(shared.pollPage(page.id, 0)).rejects.toThrow(expected);
    }
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    mock.signInAnonymously.mockResolvedValueOnce({ data: { session: null }, error: { code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' } });
    await expect(shared.pollPage(page.id, 0)).rejects.toThrow('Enable anonymous sign-ins');
  });

  it('acknowledges a maximum-size literal text from one small receipt without a follow-up read', async () => {
    const shared = cloud();
    const text = '😀'.repeat(MAX_TEXT_BYTES / 4);
    mock.rpc.mockResolvedValueOnce({ data: receipt({ ...page, version: 2 }), error: null });
    await expect(save(shared, page.id, text)).resolves.toEqual({ ...page, text, version: 2 });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('textdrop_save_checked', { p_id: page.id, p_text: text, p_expected: 1, p_base_hash: baseHash, p_operation_id: operationId });
  });

  it.each(['PGRST202', '42883'])('reports missing checked save setup without resending the write (%s)', async code => {
    const shared = cloud();
    mock.rpc.mockResolvedValue({ data: null, error: { code, message: 'missing function' } });
    await expect(save(shared, page.id, page.text)).rejects.toThrow('database setup');
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('textdrop_save_checked', { p_id: page.id, p_text: page.text, p_expected: 1, p_base_hash: baseHash, p_operation_id: operationId });
  });

  it('never retries a rejected, uncertain or malformed receipt save', async () => {
    const shared = cloud();
    for (const error of [{ code: '42501', message: 'TEXTDROP_ACCESS_DENIED' }, { message: 'Failed to fetch' }, { code: '57014', message: 'query canceled' }]) {
      mock.rpc.mockResolvedValueOnce({ data: null, error });
      await expect(save(shared, page.id, 'Changes')).rejects.toThrow();
    }
    for (const data of [null, [], page, receipt({ ...page, version: 0 }), { ...receipt(page), extra: true }]) {
      mock.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(save(shared, page.id, 'Changes')).rejects.toThrow('invalid snippet data');
    }
    expect(mock.rpc).toHaveBeenCalledTimes(8);
    expect(mock.rpc.mock.calls.every(([name]) => name === 'textdrop_save_checked')).toBe(true);
  });

  it('polls conditionally: an unchanged reply is null, a changed reply is the whole snippet', async () => {
    const shared = cloud();
    mock.rpc.mockResolvedValueOnce({ data: { id: page.id, unchanged: true, version: 1 }, error: null });
    await expect(shared.pollPage(page.id, 1)).resolves.toBeNull();
    expect(mock.rpc).toHaveBeenLastCalledWith('textdrop_poll_page', { p_id: page.id, p_known: 1 });
    const newer = { ...page, text: 'Newer', version: 2 };
    mock.rpc.mockResolvedValueOnce({ data: newer, error: null });
    await expect(shared.pollPage(page.id, 1)).resolves.toEqual(newer);
    for (const reply of [
      { id: page.id, unchanged: true, version: 2 },
      { id: 'x', unchanged: true, version: 1 },
      { id: page.id, unchanged: true, version: 1, text: 'leak' },
    ]) {
      mock.rpc.mockResolvedValueOnce({ data: reply, error: null });
      await expect(shared.pollPage(page.id, 1)).rejects.toThrow('invalid snippet data');
    }
    mock.rpc.mockResolvedValueOnce({ data: { ...newer, id: '33333333-3333-4333-8333-333333333333' }, error: null });
    await expect(shared.pollPage(page.id, 1)).rejects.toThrow('different snippet');
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'TEXTDROP_ACCESS_DENIED' } });
    await expect(shared.pollPage(page.id, 1)).rejects.toThrow('no longer have access');
    expect(mock.rpc.mock.calls.every(([name]) => name === 'textdrop_poll_page')).toBe(true);
  });

  it.each(['PGRST202', '42883'])('reports missing poll setup without downloading full text (%s)', async code => {
    const shared = cloud();
    mock.rpc.mockResolvedValue({ data: null, error: { code, message: 'missing function' } });
    await expect(shared.pollPage(page.id, 1)).rejects.toThrow('database setup');
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('textdrop_poll_page', { p_id: page.id, p_known: 1 });
  });

  it('does not treat a missing table or other poll errors as a missing function', async () => {
    const shared = cloud();
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'missing table' } });
    await expect(shared.pollPage(page.id, 1)).rejects.toThrow('needs database setup');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('starts a new session by setting damaged credentials aside and using a fresh client', async () => {
    const values = new Map([[TEXTDROP_AUTH_KEY, '{malformed']]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    vi.stubGlobal('window', { localStorage: storage });
    const shared = cloud();
    await expect(shared.pollPage(page.id, 0)).rejects.toBeInstanceOf(SessionDamagedError);
    expect(mock.createClient).not.toHaveBeenCalled();
    await shared.startNewSession();
    expect(values.has(TEXTDROP_AUTH_KEY)).toBe(false);
    expect(values.get(`${TEXTDROP_AUTH_KEY}-damaged`)).toBe('{malformed');
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(shared.pollPage(page.id, 0)).resolves.toEqual(page);
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('points to the one-time schema setup when an RPC is missing', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing function' } });
    const error = await cloud()
      .pollPage(page.id, 0)
      .catch(failure => failure as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Follow apps/textdrop/supabase/README.md');
    expect((error as Error).message).not.toMatch(/upgrade|earlier installation/i);
  });
});

it('sends a checked baseline and stable operation ID, through the current checked endpoint', async () => {
  const { createHash } = await import('node:crypto');
  const shared = cloud();
  const save = { baseVersion: 1, baseText: 'Original', operationId: '33333333-3333-4333-8333-333333333333' };
  mock.rpc.mockResolvedValueOnce({ data: receipt({ ...page, version: 2 }), error: null });
  expect(await shared.saveCheckedPage!(page.id, 'New text', save)).toMatchObject({ text: 'New text', version: 2 });
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('textdrop_save_checked', {
    p_id: page.id,
    p_text: 'New text',
    p_expected: 1,
    p_base_hash: createHash('sha256').update('Original').digest('hex'),
    p_operation_id: save.operationId,
  });
  mock.rpc.mockResolvedValueOnce({ data: { conflict: { ...page, text: 'Other device', version: 3 } }, error: null });
  await expect(shared.saveCheckedPage!(page.id, 'New text', save)).rejects.toMatchObject({ page: { text: 'Other device', version: 3 } });
  mock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
  await expect(shared.saveCheckedPage!(page.id, 'New text', save)).rejects.toThrow('database setup');
  expect(mock.rpc).toHaveBeenCalledTimes(3);
  expect(mock.rpc.mock.calls.every(([name]) => name === 'textdrop_save_checked')).toBe(true);
});
