export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

// One shared formatter: toLocaleDateString builds a new Intl object on every call, and a long log has many rows.
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function dateLabel(date: string) {
  return dateFormat.format(new Date(`${date}T12:00:00`))
}
