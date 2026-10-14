const MiB = 1024 * 1024;

/** Every size and count limit the tools enforce. Messages are built from these numbers; usage.md quotes them. */
export const LIMITS = {
  /** One source file. */
  fileBytes: 200 * MiB,
  /** All sources, or all rendered outputs, of one run. */
  totalBytes: 500 * MiB,
  /** Sources in a list (Merge PDFs, Images to PDF). */
  files: 50,
  /** One document-converter input. */
  documentBytes: 50 * MiB,
  /** One FFmpeg input (WebAssembly memory). */
  mediaBytes: 256 * MiB,
  /** PDF pages one run reads, selects or writes. */
  pdfPages: 1000,
  /** Characters of text one document conversion handles. */
  documentChars: 2_000_000,
  /** One decoded image, in pixels. */
  imagePixels: 100_000_000,
  /** One rendered PDF page, in pixels. */
  pagePixels: 50_000_000,
  /** Inflated size of one PDF stream during lossless compression, and of all entries of one EPUB together. */
  inflatedBytes: 128 * MiB,
  /** Entries in one EPUB archive. */
  archiveEntries: 10_000,
  /** One inflated EPUB entry. */
  archiveEntryBytes: 32 * MiB,
  /** Text one MOBI file may expand to. */
  mobiTextBytes: 32 * MiB,
} as const;
