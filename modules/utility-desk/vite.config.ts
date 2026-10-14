import { defineConfig, type Plugin } from 'vite';
import { resolveBase } from './src/shared/base';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
/** Files pdf.js reads at run time (CJK cmaps, standard fonts), relative to its package folder. */
const pdfAssetPaths = (): string[] => ['cmaps', 'standard_fonts'].flatMap((dir) => readdirSync(join(pdfRoot, dir)).map((file) => `${dir}/${file}`));

/**
 * Build: copy the pdf.js assets next to the bundle as `pdfjs/...`.
 * Dev: serve exactly the same files at `<base>pdfjs/...`; without this the dev server answers those
 * URLs with the app's index.html, so PDFs that need a cmap or a standard font render wrongly under `make run`.
 */
const pdfAssets = (): Plugin => {
  let base = '/';
  return {
    name: 'utility-desk-pdf-assets',
    configResolved(config) {
      base = config.base;
    },
    generateBundle() {
      for (const path of pdfAssetPaths()) this.emitFile({ type: 'asset', fileName: `pdfjs/${path}`, source: readFileSync(join(pdfRoot, path)) });
    },
    configureServer(server) {
      const known = new Set(pdfAssetPaths());
      // The dev server always resolves a relative base ('./') to '/'; keep that assumption explicit.
      const prefix = `${base.startsWith('/') ? base.replace(/\/?$/, '/') : '/'}pdfjs/`;
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let pathname: string;
        try {
          pathname = new URL(req.url ?? '', 'http://localhost').pathname;
        } catch {
          return next();
        }
        if (!pathname.startsWith(prefix)) return next();
        let asset = '';
        try {
          asset = decodeURIComponent(pathname.slice(prefix.length));
        } catch {
          /* malformed escape: not a known file */
        }
        if (!known.has(asset)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const body = readFileSync(join(pdfRoot, asset));
        res.setHeader('Content-Type', asset.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream');
        res.setHeader('Content-Length', body.length);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      });
    },
  };
};

const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'";

/** Production-only CSP so the dev server's HMR socket keeps working. */
const csp = (): Plugin => ({
  name: 'utility-desk-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  base: resolveBase((globalThis as any).process?.env?.BASE_PATH),
  // Keep active dev-server modules intact when Make refreshes node_modules.
  cacheDir: '.vite',
  plugins: [csp(), pdfAssets()],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  // The largest script chunk (document converter, pdf-lib + fontkit) is about 740 kB: raise the limit only that far, so growth is reported.
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  worker: { format: 'es' },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
} as import('vite').UserConfig & { test: unknown });
