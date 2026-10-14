/** The message of an error, or the fallback for anything that is not one. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
