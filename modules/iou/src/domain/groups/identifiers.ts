/**
 * Patterns shared by validation, storage, the queue and the forms.
 * supabase/schema.sql repeats them in SQL (iou_valid_id, invite_code checks and
 * iou_valid_text), and the schema parity test keeps both copies in step.
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
export const INVITE_PATTERN = /^[a-f0-9]{32}$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the purpose; schema.sql iou_valid_text repeats the same class
export const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/** Keys that must never become property names of stored objects. */
export const isForbiddenKey = (key: string): boolean => FORBIDDEN_KEYS.has(key)

/** Group, member and transaction IDs, and the keys derived from them. */
export const isId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value) && !FORBIDDEN_KEYS.has(value)

export const isInviteCode = (value: unknown): value is string => typeof value === 'string' && INVITE_PATTERN.test(value)

/** Text without control characters; tab, line feed and carriage return are allowed. */
export const isSafeText = (value: string): boolean => !CONTROL_PATTERN.test(value)

/** Ignore case and spaces in a pasted invitation code. */
export const normalizeInviteCode = (input: string): string => input.trim().replace(/\s+/g, '').toLowerCase()

/** Accept either an invitation code or the link that carries it. */
export const invitationCode = (input: string): string => normalizeInviteCode(input.includes('/join/') ? input.split('/join/').pop()! : input)
