/** Text for a caught failure; only Error messages reach the screen. */
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
