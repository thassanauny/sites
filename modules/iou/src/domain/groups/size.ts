import type { Group } from './types'

/**
 * The shared database refuses a group whose JSON text, as PostgreSQL's jsonb prints it, is longer than this many
 * bytes (private.iou_valid_group in supabase/schema.sql). It is a size limit, not a count: a group fills up
 * sooner when its expenses are split among many people.
 */
export const MAX_GROUP_BYTES = 4_000_000

/**
 * The size, in bytes, of the group's JSON text as jsonb prints it: UTF-8, with one space after every ":" and ",".
 * Counting happens in one pass over the compact JSON, so nothing large is allocated besides that text.
 */
export function groupBytes(group: Group): number {
  const json = JSON.stringify(group)
  let bytes = 0
  let inString = false
  for (let index = 0; index < json.length; index++) {
    const code = json.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      index++
    } else if (code >= 0x800) bytes += 3
    else if (code >= 0x80) bytes += 2
    else if (inString) {
      // An escape is a backslash and one ASCII character.
      if (code === 0x5c) {
        bytes += 2
        index++
      } else {
        bytes += 1
        if (code === 0x22) inString = false
      }
    } else if (code === 0x22) {
      bytes += 1
      inString = true
    } else bytes += code === 0x3a || code === 0x2c ? 2 : 1
  }
  return bytes
}
