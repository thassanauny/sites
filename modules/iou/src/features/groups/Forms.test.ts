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
const splitMode = (name: string) => click([...host.querySelectorAll('.split-modes button')].find(button => button.textContent === name))
const splitInput = (name: string) => host.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement
const splitPreviews = () => [...host.querySelectorAll('.split-person .split-preview')].map(output => output.textContent)

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

  it('requires a manually entered last percentage and keeps largest-remainder rounding exact', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('0.05')
    await splitMode('Percentage')
    expect(splitInput('Cam percentage').value).toBe('')
    expect(splitInput('Cam percentage').readOnly).toBe(false)
    await typeInto(splitInput('Amy percentage'), '33.33')
    await typeInto(splitInput('Ben percentage'), '33.33')
    expect(splitInput('Cam percentage').value).toBe('')
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    await typeInto(splitInput('Cam percentage'), '33.34')
    expect([...host.querySelectorAll('.split-person .split-preview')].map(output => output.textContent)).toEqual(['THB\u00a00.02', 'THB\u00a00.01', 'THB\u00a00.02'])
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: 5, shares: { amy: 2, ben: 1, cam: 2 } })
  })

  it('updates each amount under its name before percentages total 100 and when the total changes', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100')
    await splitMode('Percentage')
    await typeInto(splitInput('Amy percentage'), '30')
    expect(splitPreviews()).toEqual(['THB\u00a030.00', '—', '—'])
    await typeInto(splitInput('Ben percentage'), '44')
    await typeInto(splitInput('Cam percentage'), '25')
    expect(splitPreviews()).toEqual(['THB\u00a030.00', 'THB\u00a044.00', 'THB\u00a025.00'])
    expect(host.querySelector('.split-remaining')?.textContent).toBe('1% left')
    await fillExpense('200.50')
    expect(splitPreviews()).toEqual(['THB\u00a060.15', 'THB\u00a088.22', 'THB\u00a050.13'])
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    await typeInto(splitInput('Cam percentage'), '26')
    expect(splitPreviews()).toEqual(['THB\u00a060.15', 'THB\u00a088.22', 'THB\u00a052.13'])
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: 20050, shares: { amy: 6015, ben: 8822, cam: 5213 } })
  })

  it('uses final rounding at 100% and leaves blank percentages unfilled', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await fillExpense('0.01')
    await splitMode('Percentage')
    await typeInto(splitInput('Amy percentage'), '50')
    expect(splitPreviews()).toEqual(['THB\u00a00.01', '—', '—'])
    await typeInto(splitInput('Ben percentage'), '50')
    expect(splitPreviews()).toEqual(['THB\u00a00.01', 'THB\u00a00.00', '—'])
    expect(splitInput('Cam percentage').value).toBe('')
    await typeInto(splitInput('Cam percentage'), '0')
    expect(splitPreviews()).toEqual(['THB\u00a00.01', 'THB\u00a00.00', 'THB\u00a00.00'])
  })

  it('keeps other percentage previews visible for an invalid entry or an over-allocated total', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await fillExpense('100')
    await splitMode('Percentage')
    await typeInto(splitInput('Amy percentage'), '80')
    await typeInto(splitInput('Ben percentage'), '30')
    expect(splitPreviews()).toEqual(['THB\u00a080.00', 'THB\u00a030.00', '—'])
    expect(host.querySelector('.split-remaining')?.textContent).toBe('10% over')
    await typeInto(splitInput('Ben percentage'), '-1')
    expect(splitPreviews()).toEqual(['THB\u00a080.00', '—', '—'])
    await fillExpense('')
    expect(splitPreviews()).toEqual(['—', '—', '—'])
  })

  it('shows live amounts under each name for default and edited whole-number shares', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100')
    await splitMode('Shares')
    expect(splitPreviews()).toEqual(['THB\u00a033.34', 'THB\u00a033.33', 'THB\u00a033.33'])
    await typeInto(splitInput('Amy shares'), '3')
    await typeInto(splitInput('Ben shares'), '2')
    expect(splitPreviews()).toEqual(['THB\u00a050.00', 'THB\u00a033.33', 'THB\u00a016.67'])
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: 10000, shares: { amy: 5000, ben: 3333, cam: 1667 } })
  })

  it('uses the displayed default of one share when fields are cleared, for both preview and saving', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100')
    await splitMode('Shares')
    await typeInto(splitInput('Amy shares'), '')
    await typeInto(splitInput('Ben shares'), '')
    await typeInto(splitInput('Cam shares'), '')
    expect(splitPreviews()).toEqual(['THB\u00a033.34', 'THB\u00a033.33', 'THB\u00a033.33'])
    expect(splitInput('Amy shares').value).toBe('')
    await typeInto(splitInput('Ben shares'), '0')
    expect(splitPreviews()).toEqual(['THB\u00a050.00', 'THB\u00a00.00', 'THB\u00a050.00'])
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: 10000, shares: { amy: 5000, ben: 0, cam: 5000 } })
  })

  it('shows the percentage left or over without filling or changing any draft', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    expect(host.querySelector('.split-remaining')).toBeNull()
    await splitMode('Percentage')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('100% left')
    await typeInto(splitInput('Amy percentage'), '12')
    await typeInto(splitInput('Ben percentage'), '12')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('76% left')
    expect(splitInput('Cam percentage').value).toBe('')
    await typeInto(splitInput('Cam percentage'), '76')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('0% left')
    await typeInto(splitInput('Cam percentage'), '76.25')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('0.25% over')
    expect(host.querySelector('.split-remaining')?.classList.contains('warning')).toBe(true)
    expect(splitInput('Cam percentage').value).toBe('76.25')
    await typeInto(splitInput('Cam percentage'), '76')
    expect(host.querySelector('.split-remaining')?.classList.contains('warning')).toBe(false)
  })

  it('keeps percentage hundredths exact and counts only the selected members', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await splitMode('Percentage')
    await typeInto(splitInput('Amy percentage'), '33.33')
    await typeInto(splitInput('Ben percentage'), '33.33')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('33.34% left')
    await typeInto(splitInput('Cam percentage'), '33.34')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('0% left')
    await click(checkbox('Ben'))
    expect(host.querySelector('.split-remaining')?.textContent).toBe('33.33% left')
    await click(checkbox('Ben'))
    expect(host.querySelector('.split-remaining')?.textContent).toBe('0% left')
    await splitMode('Exact amounts')
    expect(host.querySelector('[aria-label="Percentage remaining"]')).toBeNull()
    expect(host.querySelector('[aria-label="Amount remaining"]')?.textContent).toBe('Enter expense amount')
    await splitMode('Percentage')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('0% left')
    await click(checkbox('Amy'))
    await click(checkbox('Ben'))
    await click(checkbox('Cam'))
    expect(host.querySelector('.split-remaining')).toBeNull()
  })

  it.each(['-1', '101', '0.001', 'not a percentage'])('does not show a misleading percentage left for invalid draft %s', async value => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await splitMode('Percentage')
    await typeInto(splitInput('Amy percentage'), value)
    expect(host.querySelector('.split-remaining')?.textContent).toBe('Check percentage values')
    expect(host.querySelector('.split-remaining')?.classList.contains('warning')).toBe(true)
    expect(splitInput('Amy percentage').value).toBe(value)
    await typeInto(splitInput('Amy percentage'), '25')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('75% left')
  })

  it('shows the exact amount left or over as amounts and the expense total change', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await fillExpense('100.01')
    await splitMode('Exact amounts')
    const remaining = () => host.querySelector('[aria-label="Amount remaining"]')!
    expect(remaining().textContent).toBe('THB\u00a0100.01 left')
    await typeInto(splitInput('Amy amount in THB'), '12.34')
    await typeInto(splitInput('Ben amount in THB'), '20.11')
    expect(remaining().textContent).toBe('THB\u00a067.56 left')
    expect(splitInput('Cam amount in THB').value).toBe('')
    await typeInto(splitInput('Cam amount in THB'), '67.56')
    expect(remaining().textContent).toBe('THB\u00a00.00 left')
    await typeInto(splitInput('Cam amount in THB'), '67.57')
    expect(remaining().textContent).toBe('THB\u00a00.01 over')
    expect(remaining().classList.contains('warning')).toBe(true)
    await fillExpense('200.01')
    expect(remaining().textContent).toBe('THB\u00a099.99 left')
    expect(remaining().classList.contains('warning')).toBe(false)
    expect(splitInput('Cam amount in THB').value).toBe('67.57')
  })

  it('uses the group currency and only selected people for the remaining exact amount', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group: { ...group, currency: 'BDT' }, onSubmit: async () => {} })))
    await fillExpense('100')
    await splitMode('Exact amounts')
    await typeInto(splitInput('Amy amount in BDT'), '25')
    await typeInto(splitInput('Ben amount in BDT'), '25')
    await typeInto(splitInput('Cam amount in BDT'), '10')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('BDT\u00a040.00 left')
    await click(checkbox('Ben'))
    expect(host.querySelector('.split-remaining')?.textContent).toBe('BDT\u00a065.00 left')
    await click(checkbox('Ben'))
    expect(host.querySelector('.split-remaining')?.textContent).toBe('BDT\u00a040.00 left')
    expect(splitInput('Ben amount in BDT').value).toBe('25')
    await splitMode('Shares')
    expect(host.querySelector('[aria-label="Amount remaining"]')).toBeNull()
    await splitMode('Exact amounts')
    await click(checkbox('Amy'))
    await click(checkbox('Ben'))
    await click(checkbox('Cam'))
    expect(host.querySelector('[aria-label="Amount remaining"]')).toBeNull()
  })

  it.each(['-1', '0.001', 'not an amount'])('flags invalid exact draft %s without changing it', async value => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await splitMode('Exact amounts')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('Enter expense amount')
    await fillExpense('100')
    await typeInto(splitInput('Amy amount in THB'), value)
    expect(host.querySelector('.split-remaining')?.textContent).toBe('Check amount values')
    expect(splitInput('Amy amount in THB').value).toBe(value)
    await typeInto(splitInput('Amy amount in THB'), '.00')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('THB\u00a0100.00 left')
    await fillExpense('0.001')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('Check amount values')
  })

  it('keeps large exact allocations precise when their sum exceeds the expense limit', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await fillExpense('10000000000.00')
    await splitMode('Exact amounts')
    await typeInto(splitInput('Amy amount in THB'), '10000000000.00')
    await typeInto(splitInput('Ben amount in THB'), '10000000000.00')
    expect(host.querySelector('.split-remaining')?.textContent).toBe('THB\u00a010,000,000,000.00 over')
  })

  it('leaves manually entered exact amounts unchanged when the expense total changes', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100.01')
    await splitMode('Exact amounts')
    expect(splitInput('Cam amount in THB').value).toBe('')
    expect(splitInput('Cam amount in THB').readOnly).toBe(false)
    await typeInto(splitInput('Amy amount in THB'), '33.33')
    await typeInto(splitInput('Ben amount in THB'), '33.33')
    expect(splitInput('Cam amount in THB').value).toBe('')
    await typeInto(splitInput('Cam amount in THB'), '33.35')
    await fillExpense('100.02')
    expect(splitInput('Cam amount in THB').value).toBe('33.35')
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(host.querySelector('.form-error')?.textContent).toContain('must add up to the expense amount')
    await typeInto(splitInput('Cam amount in THB'), '33.36')
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: 10002, shares: { amy: 3333, ben: 3333, cam: 3336 } })
  })

  it('preserves manually entered percentages when the selected members change', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100')
    await splitMode('Percentage')
    await typeInto(splitInput('Amy percentage'), '10')
    await typeInto(splitInput('Ben percentage'), '20')
    await typeInto(splitInput('Cam percentage'), '70')
    await click(checkbox('Cam'))
    expect(splitInput('Ben percentage').value).toBe('20')
    expect(splitInput('Ben percentage').readOnly).toBe(false)
    await click(checkbox('Amy'))
    expect(splitInput('Ben percentage').value).toBe('20')
    await click(checkbox('Cam'))
    expect(splitInput('Ben percentage').value).toBe('20')
    expect(splitInput('Ben percentage').readOnly).toBe(false)
    expect(splitInput('Cam percentage').value).toBe('70')
    await click(checkbox('Amy'))
    expect(splitInput('Amy percentage').value).toBe('10')
    expect(splitInput('Cam percentage').value).toBe('70')
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ shares: { amy: 1000, ben: 2000, cam: 7000 } })
  })

  it('keeps exact amounts and percentages separate when switching split modes', async () => {
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit: async () => {} })))
    await fillExpense('200')
    await splitMode('Percentage')
    await typeInto(splitInput('Amy percentage'), '10')
    await typeInto(splitInput('Cam percentage'), '90')
    await splitMode('Exact amounts')
    await typeInto(splitInput('Amy amount in THB'), '25')
    expect(splitInput('Cam amount in THB').value).toBe('')
    await typeInto(splitInput('Cam amount in THB'), '175')
    await splitMode('Shares')
    expect(splitInput('Cam shares').readOnly).toBe(false)
    expect(splitInput('Cam shares').value).toBe('1')
    await splitMode('Percentage')
    expect(splitInput('Amy percentage').value).toBe('10')
    expect(splitInput('Cam percentage').value).toBe('90')
    await splitMode('Exact amounts')
    expect(splitInput('Amy amount in THB').value).toBe('25')
    expect(splitInput('Cam amount in THB').value).toBe('175')
  })

  it('preserves manually entered zero shares at the maximum supported amount', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('10000000000.00')
    await splitMode('Exact amounts')
    expect(splitInput('Cam amount in THB').value).toBe('')
    await typeInto(splitInput('Amy amount in THB'), '10000000000.00')
    await typeInto(splitInput('Ben amount in THB'), '.00')
    await typeInto(splitInput('Cam amount in THB'), '0.00')
    expect(splitInput('Cam amount in THB').value).toBe('0.00')
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: MAX_AMOUNT_MINOR, shares: { amy: MAX_AMOUNT_MINOR, ben: 0, cam: 0 } })
  })

  it.each([
    ['Exact amounts', 'Amy amount in THB', '100.01', 'must add up to the expense amount'],
    ['Percentage', 'Amy percentage', '100.01', 'between 0 and 100'],
    ['Percentage', 'Amy percentage', '-1', 'Enter a percentage from 0 to 100'],
    ['Exact amounts', 'Amy amount in THB', '0.001', '2 decimal places'],
  ])('rejects an invalid %s draft without clamping or changing it', async (mode, label, value, message) => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100')
    await splitMode(mode)
    const suffix = mode === 'Percentage' ? 'percentage' : 'amount in THB'
    await typeInto(splitInput(`Ben ${suffix}`), '0')
    await typeInto(splitInput(`Cam ${suffix}`), '0')
    await typeInto(splitInput(label), value)
    expect(host.querySelector('input[readonly]')).toBeNull()
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(host.querySelector('.form-error')?.textContent).toContain(message)
    expect(splitInput(label).value).toBe(value)
    expect(splitInput(`Cam ${suffix}`).value).toBe('0')
    await typeInto(splitInput(label), '10')
    expect(splitInput(`Cam ${suffix}`).value).toBe('0')
    await typeInto(splitInput(`Cam ${suffix}`), '90')
    await submit()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('keeps exact drafts for an invalid total and refuses an empty selection', async () => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100')
    await splitMode('Exact amounts')
    await typeInto(splitInput('Cam amount in THB'), '12.34')
    await fillExpense('')
    expect(splitInput('Cam amount in THB').value).toBe('12.34')
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    await fillExpense('100')
    await click(checkbox('Amy'))
    await click(checkbox('Ben'))
    expect(splitInput('Cam amount in THB').value).toBe('12.34')
    await click(checkbox('Cam'))
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(host.querySelector('.form-error')?.textContent).toContain('Choose at least one person')
  })

  it.each([
    ['Exact amounts', 'amount in THB', '29.99', 'must add up to the expense amount'],
    ['Exact amounts', 'amount in THB', '30.01', 'must add up to the expense amount'],
    ['Percentage', 'percentage', '29.99', 'must add up to exactly 100%'],
    ['Percentage', 'percentage', '30.01', 'must add up to exactly 100%'],
  ])('rejects mismatched %s totals without rewriting any field', async (mode, suffix, lastValue, message) => {
    const onSubmit = vi.fn(async (_transaction: Transaction) => {})
    await act(async () => root.render(createElement(ExpenseForm, { group, onSubmit })))
    await fillExpense('100')
    await splitMode(mode)
    await typeInto(splitInput(`Amy ${suffix}`), '40')
    await typeInto(splitInput(`Ben ${suffix}`), '30')
    await typeInto(splitInput(`Cam ${suffix}`), lastValue)
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(host.querySelector('.form-error')?.textContent).toContain(message)
    expect(splitInput(`Amy ${suffix}`).value).toBe('40')
    expect(splitInput(`Ben ${suffix}`).value).toBe('30')
    expect(splitInput(`Cam ${suffix}`).value).toBe(lastValue)
    await typeInto(splitInput(`Cam ${suffix}`), '30')
    await submit()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: 10000, shares: { amy: 4000, ben: 3000, cam: 3000 } })
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
