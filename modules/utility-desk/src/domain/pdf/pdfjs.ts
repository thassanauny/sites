import type * as Pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let loading: Promise<typeof Pdfjs> | undefined;

/** The only place that imports pdf.js, so it is fetched when a tool first reads or renders a PDF and its worker is set once. */
export function loadPdfjs(): Promise<typeof Pdfjs> {
  loading ??= import('pdfjs-dist').then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    },
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** Where the build copies the pdf.js character maps and standard fonts (see vite.config.ts), next to the app. */
export function pdfjsAssetRoot(): string {
  return new URL('pdfjs/', new URL(import.meta.env.BASE_URL, location.href)).href;
}

/** `getDocument` parameters shared by every tool: bundled fonts and character maps, no `eval`. */
export function pdfjsDocumentOptions(data: Uint8Array) {
  const root = pdfjsAssetRoot();
  return { data, cMapUrl: `${root}cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}standard_fonts/`, isEvalSupported: false };
}
