import { VitePWA } from 'vite-plugin-pwa';
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { validatePublicConfig } from "./build-config.ts";

/** Settings are read relative to the app folder, so starting Vite from another directory still finds them. */
export function createConfig(appDirectory: string) {
  return defineConfig(({ mode, command }) => {
    const testing =
      process.env.VITEST === "true" && mode === "test" && command !== "build";
    // Reuse publishing's shared public settings; this app can override either value.
    const shared = loadEnv(
      mode,
      resolve(appDirectory, "../../websites"),
      "VITE_",
    );
    const local = loadEnv(mode, appDirectory, "VITE_");
    const url =
      process.env.VITE_SUPABASE_URL !== undefined
        ? process.env.VITE_SUPABASE_URL.trim()
        : local.VITE_SUPABASE_URL?.trim() ||
          shared.VITE_SUPABASE_URL?.trim() ||
          "";
    const key =
      process.env.VITE_SUPABASE_ANON_KEY !== undefined
        ? process.env.VITE_SUPABASE_ANON_KEY.trim()
        : local.VITE_SUPABASE_ANON_KEY?.trim() ||
          shared.VITE_SUPABASE_ANON_KEY?.trim() ||
          "";
    if (command === "build" && (!url || !key)) {
      throw new Error(
        "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in this app or the shared publishing settings before building Blueprint.",
      );
    }
    if (!testing && (url || key)) validatePublicConfig(url, key);
    return {
      base: "./",
      cacheDir: process.env.BLUEPRINT_VITE_CACHE_DIR || "node_modules/.vite",
      build: {
        rolldownOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('@xyflow')) return 'canvas';
              if (id.includes('@supabase')) return 'supabase';
            },
          },
        },
      },
      plugins: [react(), VitePWA({ registerType: 'autoUpdate', includeAssets: ['favicon.svg', 'icons/*.png'], manifest: {
name: 'Blueprint', short_name: 'Blueprint', description: 'A little space for big systems.',
start_url: './', scope: './', display: 'standalone', theme_color: '#064c3d', background_color: '#f7f6f2',
icons: [
{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
{ src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
],
}, workbox: { globPatterns: ['**/*.{js,css,html,woff2,svg,png}'], navigateFallback: 'index.html', cleanupOutdatedCaches: true } })],
      define: testing
        ? undefined
        : {
            "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
            "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(key),
          },
      server: { host: "127.0.0.1", port: 5173 },
      preview: { host: "127.0.0.1", port: 4173 },
      test: { include: ["tests/*.test.ts", "vite.config.test.ts"] },
    };
  });
}

export default createConfig(import.meta.dirname);
