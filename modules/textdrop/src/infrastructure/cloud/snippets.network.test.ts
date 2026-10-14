// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloud } from './snippets';
import { REQUEST_TIMEOUT_MS } from './requestTimeout';
import { TEXTDROP_AUTH_KEY } from '../auth/sessionStorage';

// These tests use the real Supabase client with a stubbed network, unlike snippets.test.ts.
const page = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'a'.repeat(32),
  text: 'Shared text',
  version: 1,
  updatedAt: '2026-10-10T01:00:00.123456+00:00',
};
const reply = () => new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } });
const stalled = () => new Promise<Response>(() => {});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  localStorage.clear();
  // A saved anonymous session that is valid for an hour, so no sign-in request is needed.
  localStorage.setItem(
    TEXTDROP_AUTH_KEY,
    JSON.stringify({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '33333333-3333-4333-8333-333333333333', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-10T00:00:00Z' },
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('snippet requests on a stalled connection', () => {
  it('fails a save or a poll that gets no answer so the draft stays and Retry can send it again', async () => {
    const network = vi
      .fn()
      .mockImplementationOnce(stalled)
      .mockImplementationOnce(stalled)
      .mockImplementation(async () => reply());
    vi.stubGlobal('fetch', network);
    // One client for the whole test: a second one with the same storage key makes the SDK warn.
    const cloud = createCloud('https://test-project.supabase.co', 'public-test-key');
    const unreachable = 'Could not connect to shared snippets. Check your connection and try again.';

    const saving = expect(cloud.savePage(page.id, 'Typed text')).rejects.toThrow(unreachable);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1000);
    await saving;
    const polling = expect(cloud.loadPage(page.id)).rejects.toThrow(unreachable);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1000);
    await polling;
    expect(network).toHaveBeenCalledTimes(2);

    await expect(cloud.savePage(page.id, 'Typed text')).resolves.toEqual(page);
    await expect(cloud.loadPage(page.id)).resolves.toEqual(page);
    expect(network.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/rest/v1/rpc/textdrop_save_page',
      '/rest/v1/rpc/textdrop_load_page',
      '/rest/v1/rpc/textdrop_save_page',
      '/rest/v1/rpc/textdrop_load_page',
    ]);
  });
});
