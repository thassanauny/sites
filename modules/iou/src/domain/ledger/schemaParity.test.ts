import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_AMOUNT_MINOR, MAX_MEMBERS, MAX_TRANSACTIONS } from './rules'
import { CONTROL_PATTERN, isSafeText } from '../groups/identifiers'
import { MAX_GROUP_BYTES } from '../groups/size'

// The database re-checks every ledger with its own copy of these rules (supabase/schema.sql). Nothing here runs
// the SQL; this keeps the limits and field lists written in both places from drifting apart unnoticed.
const schema = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8')
const validator = schema.match(/function private\.iou_valid_group\([\s\S]*?\$\$;/)![0]
const deltaValidator = schema.match(/function private\.iou_valid_transaction\([\s\S]*?\$\$;/)![0]

function keyLists(source = validator): string[][] {
  return [...source.matchAll(/iou_has_keys\([^,]+,\s*array\[([^\]]+)\]\)/g)].map(match => [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]))
}

describe('schema.sql and the client agree', () => {
  it('on the fields of a group, member, expense and payment', () => {
    expect(keyLists()).toEqual([
      ['id', 'name', 'description', 'currency', 'icon', 'color', 'inviteCode', 'createdAt', 'updatedAt', 'members', 'transactions'],
      ['id', 'name'],
      ['id', 'type', 'description', 'amount', 'paidBy', 'shares', 'category', 'date', 'createdAt'],
      ['id', 'type', 'fromId', 'toId', 'amount', 'note', 'date', 'createdAt'],
    ])
  })

  it('on the changed-transaction fields checked by the delta writer', () => {
    expect(keyLists(deltaValidator)).toEqual(keyLists().slice(2))
  })

  it('on the limits', () => {
    expect(validator).toContain(`octet_length(p_payload::text) > ${MAX_GROUP_BYTES}`)
    expect(validator).toContain(`not between 1 and ${MAX_MEMBERS}`)
    expect(validator).toContain(`jsonb_array_length(p_payload->'transactions') > ${MAX_TRANSACTIONS}`)
    expect(validator).toContain(`shares_count not between 1 and ${MAX_MEMBERS}`)
    expect(schema).toContain(`value <= ${MAX_AMOUNT_MINOR}`)
  })

  it('on which control characters text may not contain', () => {
    // schema.sql spells the class out (never [[:cntrl:]], which depends on the database locale). U+0000 cannot appear in a
    // string literal or in jsonb text, so the SQL class starts at U+0001.
    const sqlClass = /value !~ E'(\[[^']+\])'/.exec(schema)?.[1]
    expect(sqlClass).toBeDefined()
    expect(schema).not.toMatch(/!~\s*'\[\[:cntrl:\]\]'/)
    expect(sqlClass).toBe(CONTROL_PATTERN.source.replace('\\u0000', '\\u0001'))
    const sqlRule = new RegExp(sqlClass as string)
    for (let code = 1; code <= 0x9f; code++) {
      const character = String.fromCharCode(code)
      expect(sqlRule.test(character), `U+${code.toString(16)}`).toBe(!isSafeText(character))
    }
    expect(isSafeText('\u0085')).toBe(true)
    expect(isSafeText('\t\n\r')).toBe(true)
  })
})
