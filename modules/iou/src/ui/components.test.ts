import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Avatar, initials } from './components'

describe('member initials', () => {
  it('uses the first letter of up to two words, in capitals', () => {
    expect(initials('Amy Lee')).toBe('AL')
    expect(initials('amy')).toBe('A')
    expect(initials('  ana  maria   souza ')).toBe('AM')
    expect(initials('Émile')).toBe('É')
  })

  it('keeps an emoji or other astral character whole instead of cutting a surrogate pair', () => {
    expect(initials('🍜 Noodle Bar')).toBe('🍜N')
    expect(initials('🍜')).toBe('🍜')
    expect(initials('𠮷野 家')).toBe('𠮷家')
    for (const name of ['🍜 Noodle Bar', '😀', '𝒜lice Bob']) expect(initials(name)).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
  })

  it('shows the initials inside the avatar', () => {
    const html = renderToStaticMarkup(createElement(Avatar, { member: { id: 'm', name: '🍜 Noodle Bar' }, index: 7, small: true }))
    expect(html).toContain('avatar-1 small')
    expect(html).toContain('>🍜N</span>')
  })
})
