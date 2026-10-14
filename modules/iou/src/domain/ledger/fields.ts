import { isForbiddenKey, isId, isSafeText } from '../groups/identifiers'
import { MAX_AMOUNT_MINOR, fail } from './rules'

/** A plain object whose properties are ordinary values; optionally limited to the allowed keys. */
export function record(value: unknown, label: string, allowedKeys?: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} must be an object.`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object.`)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || isForbiddenKey(key)) fail(`${label} contains an unsafe key.`)
    if (allowedKeys && !allowedKeys.includes(key)) fail(`${label} contains an unsupported field: ${key}.`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) fail(`${label} must contain ordinary values.`)
  }
  return value as Record<string, unknown>
}

/** Reject keys outside the allowed list on a value already checked by record(). */
export function onlyKeys(value: Record<string, unknown>, label: string, allowedKeys: readonly string[]): void {
  for (const key of Reflect.ownKeys(value) as string[]) {
    if (!allowedKeys.includes(key)) fail(`${label} contains an unsupported field: ${key}.`)
  }
}

export function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || !isSafeText(value)) {
    fail(`${label} must be text of at most ${max} characters.`)
  }
  const trimmed = value.trim()
  if (required && !trimmed) fail(`${label} is required.`)
  return trimmed
}

export function id(value: unknown, label: string): string {
  if (!isId(value)) fail(`${label} is invalid.`)
  return value
}

export function day(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be a date in YYYY-MM-DD format.`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} is not a valid date.`)
  return value
}

export function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value)) {
    fail(`${label} must be an ISO UTC timestamp.`)
  }
  day(value.slice(0, 10), label)
  if (!Number.isFinite(Date.parse(value))) fail(`${label} is invalid.`)
  return value
}

export function requireMoney(value: unknown, label: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_AMOUNT_MINOR) {
    fail(`${label} must be ${allowZero ? 'a nonnegative' : 'a positive'} integer amount no greater than ${MAX_AMOUNT_MINOR}.`)
  }
  return value
}

export function safeAdd(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) fail('The group total exceeds the supported amount.')
  return result
}
