import { describe, expect, it } from 'vitest'
import { dateLabel, errorMessage } from './format'

describe('formatting helpers', () => {
  it('labels a ledger date the same way for every call', () => {
    expect(dateLabel('2026-10-08')).toBe('8 Oct 2026')
    expect(dateLabel('2026-01-31')).toBe('31 Jan 2026')
    expect(dateLabel('2026-10-08')).toBe(dateLabel('2026-10-08'))
  })

  it('shows an error message, or a generic one for anything else', () => {
    expect(errorMessage(new Error('Nope'))).toBe('Nope')
    expect(errorMessage('Nope')).toBe('Something went wrong. Please try again.')
  })
})
