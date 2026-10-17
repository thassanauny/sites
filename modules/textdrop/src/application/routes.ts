import { normalizeCode } from '../domain/snippets/model';

export type Route = { kind: 'home' } | { kind: 'page'; code: string } | { kind: 'invalid' };

export function readRoute(hash: string): Route {
  if (!hash || hash === '#' || hash === '#/') return { kind: 'home' };
  if (!hash.startsWith('#/p/')) return { kind: 'invalid' };
  try {
    return { kind: 'page', code: normalizeCode(decodeURIComponent(hash.slice(4))) };
  } catch {
    return { kind: 'invalid' };
  }
}

const NO_CODE_IN_LINK = 'That link does not contain a snippet code. Copy the invitation link again.';

export function joinCode(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    let hash: string;
    try {
      hash = new URL(trimmed).hash;
    } catch {
      throw new Error(NO_CODE_IN_LINK);
    }
    const route = readRoute(hash);
    if (route.kind === 'page') return route.code;
    throw new Error(NO_CODE_IN_LINK);
  }
  return normalizeCode(trimmed);
}

export function pageHash(code: string): string {
  return `#/p/${normalizeCode(code)}`;
}

export function invitationLink(code: string, currentUrl: string): string {
  const url = new URL(currentUrl);
  url.search = '';
  url.hash = pageHash(code);
  return url.href;
}
