export interface TextDropPage {
  id: string;
  code: string;
  text: string;
  version: number;
  updatedAt: string;
  name: string | null;
  /** A durable local edit that has not yet been acknowledged by the server. */
  localPending?: boolean;
  /** Both versions remain on this device until the user resolves a conflicting queued edit. */
  localConflict?: TextDropPage;
}

export class TextConflictError extends Error {
  readonly page: TextDropPage;
  constructor(page: TextDropPage) {
    super('Shared text changed on another device. Your text is kept on this device. Compare both versions before saving.');
    this.name = 'TextConflictError';
    this.page = page;
  }
}

/** The saved browser session is unreadable or conflicts with itself; "Start a new session" is the way out. */
export class SessionDamagedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionDamagedError';
  }
}

export const MAX_TEXT_BYTES = 1_048_576;
export const MAX_SNIPPET_NAME_LENGTH = 80;

/** A snippet this device has opened: its invitation code, when it was last opened and a cached optional shared name. */
export interface DeviceSnippet {
  code: string;
  openedAt: string;
  name?: string;
}
const PAGE_KEYS = ['id', 'code', 'text', 'version', 'updatedAt', 'name'];
const encoder = new TextEncoder();

export function validateName(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'string') throw new Error('Enter a snippet name or leave it blank.');
  const name = input.trim();
  if (Array.from(name).length > MAX_SNIPPET_NAME_LENGTH || /[\p{Cc}\p{Cs}]/u.test(name)) throw new Error('A snippet name supports up to 80 characters without control characters.');
  return name || null;
}

export function validateUuid(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(input)) {
    throw new Error('The snippet ID is invalid.');
  }
  return input.toLowerCase();
}

/** Accept spaces, tabs, line breaks, and hyphens when someone copies a code. */
export function normalizeCode(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Enter the complete 32-character snippet code.');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the tab-to-carriage-return range is the whitespace set the database ignores too
  const normalized = input.replace(/[\u0009-\u000d\u0020-]+/g, '').toLowerCase();
  if (!/^[a-f\d]{32}$/.test(normalized)) throw new Error('Enter the complete 32-character snippet code.');
  return normalized;
}

export function textBytes(input: string): number {
  return encoder.encode(input).byteLength;
}

/**
 * Whether the text is over the limit. Each UTF-16 unit takes one to three UTF-8 bytes,
 * so only lengths between a third and the whole limit need an exact count.
 */
export function exceedsLimit(input: string): boolean {
  if (input.length > MAX_TEXT_BYTES) return true;
  if (input.length * 3 <= MAX_TEXT_BYTES) return false;
  return textBytes(input) > MAX_TEXT_BYTES;
}

/** The first and last six characters of a code, as the snippet list shows it. */
export function shortCode(code: string): string {
  return `${code.slice(0, 6)}…${code.slice(-6)}`;
}

/**
 * A file name for downloaded text: the snippet's shared name, otherwise today's date.
 * It never contains the code, because files travel and the code is the credential.
 */
export function exportFileName(name: string | undefined, now: Date): string {
  const cleaned = (name ?? '')
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '') // text-direction controls can disguise a file extension
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  if (cleaned) return `${cleaned}.txt`;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `textdrop-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.txt`;
}

/** Lines separated by line feeds; an empty text has one. */
export function countLines(input: string): number {
  let lines = 1;
  for (let at = input.indexOf('\n'); at !== -1; at = input.indexOf('\n', at + 1)) lines += 1;
  return lines;
}

/** Preserve exact text; PostgreSQL text cannot store NUL or malformed Unicode. */
export function validateText(input: unknown): string {
  if (typeof input !== 'string') throw new Error('The snippet must contain text.');
  if (input.includes('\u0000') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(input)) {
    throw new Error('The text contains a character that cannot be saved.');
  }
  if (exceedsLimit(input)) throw new Error('A snippet supports up to 1 MiB of UTF-8 text.');
  return input;
}

function timestamp(input: unknown): string {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(input)) {
    throw new Error('The snippet update time is invalid.');
  }
  const calendar = new Date(`${input.slice(0, 10)}T00:00:00Z`);
  if (input.startsWith('0000-') || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== input.slice(0, 10) || !Number.isFinite(Date.parse(input))) {
    throw new Error('The snippet update time is invalid.');
  }
  return input;
}

export function readPage(input: unknown): TextDropPage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The snippet must be an object.');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('The snippet must be a plain object.');
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !PAGE_KEYS.includes(key) || !descriptor || !('value' in descriptor)) {
      throw new Error('The snippet contains an unsupported field.');
    }
  }
  const page = input as Record<string, unknown>;
  if (typeof page.code !== 'string' || !/^[a-f\d]{32}$/.test(page.code)) throw new Error('The snippet code is invalid.');
  if (typeof page.version !== 'number' || !Number.isSafeInteger(page.version) || page.version < 1) throw new Error('The snippet version is invalid.');
  return {
    id: validateUuid(page.id),
    code: page.code,
    text: validateText(page.text),
    version: page.version,
    updatedAt: timestamp(page.updatedAt),
    name: validateName(page.name),
  };
}
