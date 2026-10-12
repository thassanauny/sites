

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.' }

export function dateLabel(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
