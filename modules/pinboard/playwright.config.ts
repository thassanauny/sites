import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:5197',
    viewport: { width: 1440, height: 960 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://pinboard-test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_test',
    },
  },
});
