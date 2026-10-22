import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { validatePublicConfig } from './build-config.ts';

export default defineConfig(({ mode, command }) => {
  const testing = process.env.VITEST === 'true' && mode === 'test' && command !== 'build';
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const shared = loadEnv(mode, resolve(process.cwd(), '../../websites'), 'VITE_');
  const local = loadEnv(mode, process.cwd(), 'VITE_');
  const url = process.env.VITE_SUPABASE_URL !== undefined ? process.env.VITE_SUPABASE_URL.trim() : local.VITE_SUPABASE_URL?.trim() || shared.VITE_SUPABASE_URL?.trim() || '';
  const key = process.env.VITE_SUPABASE_ANON_KEY !== undefined ? process.env.VITE_SUPABASE_ANON_KEY.trim() : local.VITE_SUPABASE_ANON_KEY?.trim() || shared.VITE_SUPABASE_ANON_KEY?.trim() || '';
  if (command === 'build' && (!url || !key)) {
    throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in TextDrop or the shared publishing settings before building.');
  }
  if (!testing && (url || key)) validatePublicConfig(url, key);
  return {
    base: './',
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['logo.svg', 'icons/*.png'],
        manifest: {
          name: 'TextDrop',
          short_name: 'TextDrop',
          description: 'Copy here. Open anywhere.',
          start_url: './',
          scope: './',
          display: 'standalone',
          theme_color: '#064c3d',
          background_color: '#f7f6f2',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: { globPatterns: ['**/*.{js,css,html,woff2,svg,png}'], navigateFallback: 'index.html', cleanupOutdatedCaches: true },
      }),
    ],
    define: testing
      ? undefined
      : {
          'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
          'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(key),
          __APP_VERSION__: JSON.stringify(version),
        },
    server: { host: '127.0.0.1', port: 5175 },
    preview: { host: '127.0.0.1', port: 4175 },
    test: {
      maxWorkers: 2,
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts', '*.test.ts'],
    },
  };
});
