// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Group, Transaction } from '../../domain/groups/types'
import { MAX_AMOUNT_MINOR } from '../../domain/ledger/calculations'
import { ExpenseForm, PaymentForm } from './Forms'

const stamp = '2026-10-08T00:00:00.000Z'
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
  ],
  transactions: [],
}

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const click = (element: Element | null | undefined) =>
  act(async () => {
    ;(element as HTMLElement).click()
  })
const typeInto = (input: Element | null, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
const submit = () =>
  act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
const checkbox = (name: string) => [...host.querySelectorAll('.split-member')].find(row => row.textContent?.includes(name))!.querySelector('input[type="checkbox"]')

describe('splitting an expense', () => {
  const fillExpense = async (amount: string) => {
    await typeInto(host.querySelector('input[placeholder="What was it for?"]'), 'Snacks')
    await typeInto(host.querySelector('input[inputmode="decimal"]'), amount)
  }

  it('gives the odd satang to the first member in the list, however the boxes were ticked', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => {
      root.render(createElement(ExpenseForm, { group, onSubmit }))
    })
    await fillExpense('0.10')
    // Untick and tick Amy again: she is now the last person ticked, but still the first member of the group.
    await click(checkbox('Amy'))
    await click(checkbox('Amy'))
    await submit()
    const [transaction] = onSubmit.mock.calls[0]!
    expect(transaction).toMatchObject({ type: 'expense', amount: 10, shares: { amy: 4, ben: 3, cam: 3 } })
  })

  it('follows the member list for shares as well', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => {
      root.render(createElement(ExpenseForm, { group, onSubmit }))
    })
    await fillExpense('0.05')
    await click([...host.querySelectorAll('.split-modes button')].find(button => button.textContent === 'Shares'))
    await click(checkbox('Ben'))
    await click(checkbox('Ben'))
    await submit()
    // Equal weights over three people: one satang each plus the two odd satang, in member order.
    const [transaction] = onSubmit.mock.calls[0]!
    expect(transaction).toMatchObject({ amount: 5, shares: { amy: 2, ben: 2, cam: 1 } })
  })
})

describe('recording a payment from a suggestion', () => {
  const prefilledAmount = async (amount: number) => {
    await act(async () => {
      root.render(createElement(PaymentForm, { group, initial: { fromId: 'ben', toId: 'amy', amount }, onSubmit: async () => {} }))
    })
    return (host.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value
  }

  it('prefills the exact decimal amount', async () => {
    expect(await prefilledAmount(123_456)).toBe('1234.56')
  })

  it('keeps small and the largest supported amounts exact', async () => {
    expect(await prefilledAmount(5)).toBe('0.05')
    await act(async () => root.unmount())
    root = createRoot(host)
    expect(await prefilledAmount(MAX_AMOUNT_MINOR)).toBe('10000000000.00')
  })
})
