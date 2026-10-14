// @vitest-environment node
// Vite (esbuild) refuses to load inside jsdom, and this file only exercises Node-side build configuration.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import config from '../vite.config';
import { pdfjsDocumentOptions } from '../src/domain/pdf/pdfjs';

const pdfRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const plugin = (config.plugins as Plugin[]).find((candidate) => candidate.name === 'utility-desk-pdf-assets')!;

interface Reply {
  status: number;
  headers: Record<string, string | number>;
  body: unknown;
  passedThrough: boolean;
}
type Middleware = (req: { url?: string; method?: string }, res: object, next: () => void) => void;

/** Runs the plugin's dev-server hooks the way Vite does, without starting a server. */
function request(url: string, { base = '/', method = 'GET' } = {}): Reply {
  const middlewares: Middleware[] = [];
  (plugin.configResolved as unknown as (resolved: { base: string }) => void)({ base });
  (plugin.configureServer as unknown as (server: unknown) => void)({
    middlewares: {
      use: (fn: Middleware) => {
        middlewares.push(fn);
      },
    },
  });
  const reply: Reply = { status: 200, headers: {}, body: undefined, passedThrough: false };
  const res = {
    get statusCode() {
      return reply.status;
    },
    set statusCode(value: number) {
      reply.status = value;
    },
    setHeader: (name: string, value: string | number) => {
      reply.headers[name.toLowerCase()] = value;
    },
    end: (body?: unknown) => {
      reply.body = body;
    },
  };
  middlewares[0]({ url, method }, res, () => {
    reply.passedThrough = true;
  });
  return reply;
}

const asset = (path: string) => readFileSync(join(pdfRoot, path));

describe('pdf.js assets in the dev server', () => {
  it('serves the standard fonts and character maps the app requests, byte for byte', () => {
    const font = request('/pdfjs/standard_fonts/LiberationSans-Regular.ttf');
    expect(font.passedThrough).toBe(false);
    expect(font.status).toBe(200);
    expect(font.headers['content-type']).toBe('font/ttf');
    expect(font.headers['content-length']).toBe(asset('standard_fonts/LiberationSans-Regular.ttf').length);
    expect(Buffer.compare(font.body as Buffer, asset('standard_fonts/LiberationSans-Regular.ttf'))).toBe(0);

    const cmap = readdirSync(join(pdfRoot, 'cmaps')).find((name) => name.endsWith('.bcmap'))!;
    const served = request(`/pdfjs/cmaps/${cmap}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.compare(served.body as Buffer, asset(`cmaps/${cmap}`))).toBe(0);
  });

  it('answers the URLs the document tools build from their pdf.js options', () => {
    vi.stubGlobal('location', new URL('http://localhost:3000/'));
    const options = pdfjsDocumentOptions(new Uint8Array());
    vi.unstubAllGlobals();
    const cmap = readdirSync(join(pdfRoot, 'cmaps'))[0];
    for (const url of [`${options.standardFontDataUrl}LiberationSans-Bold.ttf`, `${options.cMapUrl}${cmap}`]) {
      const reply = request(new URL(url).pathname + new URL(url).search);
      expect(reply.status, url).toBe(200);
      expect(reply.passedThrough, url).toBe(false);
    }
  });

  it('ignores a query string and answers HEAD requests like GET', () => {
    expect(request('/pdfjs/standard_fonts/LiberationSans-Regular.ttf?v=1#x').status).toBe(200);
    const head = request('/pdfjs/standard_fonts/LiberationSans-Regular.ttf', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.passedThrough).toBe(false);
  });

  it('follows the configured base path and leaves other URLs to Vite', () => {
    expect(request('/tools/lite/pdfjs/standard_fonts/LiberationSans-Regular.ttf', { base: '/tools/lite/' }).status).toBe(200);
    expect(request('/tools/lite/pdfjs/standard_fonts/LiberationSans-Regular.ttf', { base: '/tools/lite' }).status).toBe(200);
    expect(request('/pdfjs/standard_fonts/LiberationSans-Regular.ttf', { base: '/tools/lite/' }).passedThrough).toBe(true);
    // A relative base ('./') is resolved to '/' by the dev server.
    expect(request('/pdfjs/standard_fonts/LiberationSans-Regular.ttf', { base: './' }).status).toBe(200);
  });

  it('passes through every URL that is not a pdf.js asset request', () => {
    for (const url of ['/', '/index.html', '/src/main.ts', '/@vite/client', '/node_modules/.vite/deps/pdfjs-dist.js', '/pdfjs']) {
      expect(request(url).passedThrough, url).toBe(true);
    }
    expect(request('/pdfjs/standard_fonts/LiberationSans-Regular.ttf', { method: 'POST' }).passedThrough).toBe(true);
  });

  it('answers 404, never the app page, for unknown files and traversal attempts', () => {
    for (const url of ['/pdfjs/cmaps/does-not-exist.bcmap', '/pdfjs/package.json', '/pdfjs/cmaps/', '/pdfjs/cmaps', '/pdfjs/cmaps%2f..%2f..%2fpackage.json', '/pdfjs/standard_fonts/%E0%A4%A', '/pdfjs/other/LiberationSans-Regular.ttf']) {
      const reply = request(url);
      expect(reply.status, url).toBe(404);
      expect(reply.passedThrough, url).toBe(false);
      expect(reply.body, url).toBe('Not found');
    }
    // Dot segments (also when percent-encoded) are normalised before the prefix check, so they leave the pdf.js
    // folder, are handed back to Vite untouched, and never reach a file outside the allow-list through this middleware.
    for (const url of ['/pdfjs/cmaps/../../package.json', '/pdfjs/cmaps/%2e%2e/%2e%2e/package.json']) {
      expect(request(url).passedThrough, url).toBe(true);
    }
  });

  it('still copies the same files into the production bundle', () => {
    const emitted: { fileName: string; source: Buffer }[] = [];
    (plugin.generateBundle as unknown as (this: { emitFile: (file: { fileName: string; source: Buffer }) => void }) => void).call({
      emitFile: (file) => {
        emitted.push(file);
      },
    });
    const names = emitted.map((file) => file.fileName);
    expect(names).toContain('pdfjs/standard_fonts/LiberationSans-Regular.ttf');
    expect(names).toContain('pdfjs/standard_fonts/LiberationSans-Bold.ttf');
    expect(names.filter((name) => name.startsWith('pdfjs/cmaps/')).length).toBe(readdirSync(join(pdfRoot, 'cmaps')).length);
    expect(names.length).toBe(readdirSync(join(pdfRoot, 'cmaps')).length + readdirSync(join(pdfRoot, 'standard_fonts')).length);
  });
});
