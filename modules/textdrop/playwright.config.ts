import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: { baseURL: 'http://127.0.0.1:4198', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'make preview PORT=4198',
    url: 'http://127.0.0.1:4198',
    timeout: 60_000,
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://textdrop-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_test' },
  },
});
