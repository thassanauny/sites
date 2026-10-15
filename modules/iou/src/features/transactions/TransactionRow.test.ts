// @vitest-environment jsdom
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Expense, Group, Transaction } from '../../domain/groups/types'
import { TransactionRow } from './TransactionRow'

const stamp = '2026-10-15T00:00:00.000Z'
const group: Group = {
  id: 'trip',
  name: 'Trip',
  description: '',
  currency: 'THB',
  icon: 'plane',
  color: '#e1ebf3',
  inviteCode: 'a'.repeat(32),
  createdAt: stamp,
  updatedAt: stamp,
  members: [
    { id: 'amy', name: 'Amy' },
    { id: 'ben', name: 'Ben' },
    { id: 'cam', name: 'Cam' },
    { id: 'dee', name: 'Dee' },
  ],
  transactions: [],
}
const expense: Expense = {
  id: 'dinner',
  type: 'expense',
  description: 'Dinner',
  amount: 1000,
  paidBy: 'amy',
  shares: { amy: 334, ben: 333, cam: 333 },
  category: 'food',
  date: '2026-10-15',
  createdAt: stamp,
}
const render = (transaction: Transaction, selectedGroup = group, log = false) => {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(createElement(TransactionRow, { transaction, group: selectedGroup, onOpenLog: log ? () => {} : undefined }))
  return host
}
const splitLabels = (host: HTMLElement) => [...host.querySelectorAll('.transaction-splits li')].map(item => item.textContent?.replace(/\s+/g, ' '))

describe('transaction split amounts', () => {
  it('keeps the breakdown in a closed non-modal popup targeted by the split button', () => {
    const host = render(expense)
    const trigger = host.querySelector('.transaction-split-trigger')!
    const popup = host.querySelector('.transaction-split-popup')!
    expect(trigger.textContent).toBe('Split 3 ways')
    expect(trigger.getAttribute('popovertarget')).toBe(popup.id)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(popup.getAttribute('popover')).toBe('auto')
    expect(popup.getAttribute('role')).toBe('dialog')
    expect(popup.getAttribute('aria-label')).toBe('Split amounts for Dinner')
    expect(popup.querySelector('button')).toBeNull()
    expect(popup.querySelector('.transaction-splits')).not.toBeNull()
  })

  it('gives separate rows distinct popup targets, even for the same expense', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(createElement(Fragment, null, createElement(TransactionRow, { transaction: expense, group }), createElement(TransactionRow, { transaction: expense, group })))
    const targets = [...host.querySelectorAll('.transaction-split-trigger')].map(trigger => trigger.getAttribute('popovertarget'))
    expect(new Set(targets).size).toBe(2)
    for (const target of targets) expect([...host.querySelectorAll('.transaction-split-popup')].some(popup => popup.id === target)).toBe(true)
  })

  it('shows each saved rounded amount without recalculating an equal split', () => {
    const host = render(expense)
    expect(splitLabels(host)).toEqual(['AmyTHB 3.34', 'BenTHB 3.33', 'CamTHB 3.33'])
    expect(host.querySelector('.transaction-splits')?.getAttribute('aria-label')).toBe('Split amounts')
    expect(host.querySelector('.transaction-description')?.textContent).toContain('Amy paid · Split 3 ways')
    expect(host.querySelector('.transaction-amount')?.textContent).toContain('THB\u00a010.00')
  })

  it('includes zero shares and omits people excluded from the expense', () => {
    const host = render({ ...expense, shares: { amy: 1000, ben: 0 } })
    expect(splitLabels(host)).toEqual(['AmyTHB 10.00', 'BenTHB 0.00'])
    expect(host.querySelector('.transaction-splits')?.textContent).not.toContain('Cam')
    expect(host.querySelector('.transaction-splits')?.textContent).not.toContain('Dee')
  })

  it('preserves the group currency and Unicode names in the all-groups feed', () => {
    const host = render({ ...expense, shares: { amy: 1000 } }, { ...group, currency: 'BDT', members: [{ id: 'amy', name: '🍜 Émile 李' }] }, true)
    expect(splitLabels(host)).toEqual(['🍜 Émile 李BDT 10.00'])
    expect(host.querySelector('.transaction-group')?.getAttribute('aria-label')).toBe('Open Trip transaction log')
    expect(host.querySelector('.transaction-amount')?.textContent).toContain('BDT 10.00')
  })

  it('leaves payments as a transfer without expense split details', () => {
    const host = render({ id: 'payment', type: 'payment', fromId: 'ben', toId: 'amy', amount: 333, note: 'Settled dinner', date: '2026-10-15', createdAt: stamp })
    expect(host.querySelector('.transaction-description')?.textContent).toContain('Ben paid Amy')
    expect(host.querySelector('.transaction-description')?.textContent).toContain('Settled dinner')
    expect(host.querySelector('.transaction-splits')).toBeNull()
    expect(host.querySelector('.transaction-amount')?.textContent).toContain('THB\u00a03.33')
  })
})
