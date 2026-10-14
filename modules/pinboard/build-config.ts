/** Cleartext http is only for a Supabase stack running on this machine. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Reject private settings before Vite can expose them in a static bundle. */
export function validatePublicConfig(url: string, key: string): void {
  try {
    const parsed = new URL(url);
    const allowed =
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && LOCAL_HOSTS.includes(parsed.hostname));
    if (!allowed || parsed.username || parsed.password) throw new Error();
  } catch {
    throw new Error(
      'Pinboard requires a valid Supabase project URL. Plain http:// is accepted only for localhost.',
    );
  }
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  try {
    const pieces = key.split('.');
    if (
      pieces.length === 3 &&
      JSON.parse(Buffer.from(pieces[1]!, 'base64url').toString()).role === 'anon'
    ) {
      return;
    }
  } catch {
    // A malformed key is never included in the output.
  }
  throw new Error(
    'Pinboard requires a public Supabase publishable or anon key. Secret and service_role keys cannot be exposed by this app.',
  );
}
