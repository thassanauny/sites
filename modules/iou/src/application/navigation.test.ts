// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { route } from './navigation'
import { invitationCode } from '../domain/groups/identifiers'
const code = 'a'.repeat(32)
describe('current routes', () => {
  it('accepts generated group and invitation URLs', () => {
    expect(route(`#/group/${code}`)).toMatchObject({ groupCode: code, invalid: false, log: false })
    expect(route(`#/group/${code}/log`)).toMatchObject({ groupCode: code, invalid: false, log: true })
    expect(route(`#/join/${code}`)).toMatchObject({ joinCode: code, invalid: false })
    for (const hash of ['', '#', '#/', '#/groups', '#/transactions']) expect(route(hash).invalid).toBe(false)
    expect(invitationCode(`https://example.test/iou/#/join/${code}`)).toBe(code)
  })
  it('rejects unsupported prefixes and trailing segments', () => {
    for (const hash of [`#group/${code}`, `#/group/${code}/extra`, '#/groups/extra', '#/unknown', '#/join/short']) {
      expect(route(hash).invalid).toBe(true)
      expect(route(hash).groupCode).toBeUndefined()
      expect(route(hash).joinCode).toBeUndefined()
    }
    expect(invitationCode(`https://example.test/iou/join/${code}`)).toBe('')
  })
})
