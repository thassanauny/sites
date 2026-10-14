/** Shared groups are refreshed this often while the page is visible. */
export const POLL_MS = 10_000
/** The longest pause between automatic refreshes while the server keeps failing. */
export const MAX_BACKOFF_MS = 300_000

/** How long the automatic refresh waits after this many failures in a row: twice as long each time, up to a ceiling. */
export function pollDelay(failures: number): number {
  return failures <= 0 ? POLL_MS : Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures)
}
