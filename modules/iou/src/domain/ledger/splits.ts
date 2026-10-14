import { id, requireMoney } from './fields'
import { MAX_MEMBERS, fail } from './rules'

function validateParticipants(memberIds: readonly string[]): void {
  if (memberIds.length < 1 || memberIds.length > MAX_MEMBERS) fail('Choose at least one participant.')
  const seen = new Set<string>()
  for (const memberId of memberIds) {
    id(memberId, 'Participant ID')
    if (seen.has(memberId)) fail('Participants must be unique.')
    seen.add(memberId)
  }
}

/** The first participants receive any indivisible remainder, in the supplied order. */
export function splitEqually(amount: number, memberIds: readonly string[]): Record<string, number> {
  requireMoney(amount, 'Expense amount')
  validateParticipants(memberIds)
  const base = Math.floor(amount / memberIds.length)
  const remainder = amount % memberIds.length
  return Object.fromEntries(memberIds.map((memberId, index) => [memberId, base + (index < remainder ? 1 : 0)]))
}

/** Round proportional splits by largest remainder, breaking ties in participant order. */
function splitProportionally(amount: number, memberIds: readonly string[], weights: readonly bigint[]): Record<string, number> {
  requireMoney(amount, 'Expense amount')
  validateParticipants(memberIds)
  if (weights.length !== memberIds.length) fail('Enter a value for every selected participant.')
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (total === 0n) fail('At least one person must have a positive number of shares.')
  const portions = weights.map((weight, index) => {
    const numerator = BigInt(amount) * weight
    return { index, amount: Number(numerator / total), remainder: numerator % total }
  })
  const leftover = amount - portions.reduce((sum, portion) => sum + portion.amount, 0)
  const ranked = [...portions].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1))
  for (let index = 0; index < leftover; index += 1) ranked[index]!.amount += 1
  return Object.fromEntries(memberIds.map((memberId, index) => [memberId, portions[index]!.amount]))
}

/** Percentages use exact hundredths and must total 100%. */
export function splitByPercentages(amount: number, memberIds: readonly string[], percentages: readonly string[]): Record<string, number> {
  const weights = percentages.map(input => {
    if (typeof input !== 'string' || input.length > 32 || !/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(input.trim())) {
      fail('Enter a percentage from 0 to 100 with up to two decimal places for each selected person.')
    }
    const [whole = '', fraction = ''] = input.trim().split('.')
    const value = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0')
    if (value > 10_000n) fail('Each percentage must be between 0 and 100.')
    return value
  })
  if (weights.reduce((sum, weight) => sum + weight, 0n) !== 10_000n) fail('Percentages must add up to exactly 100%.')
  return splitProportionally(amount, memberIds, weights)
}

/** Whole-number weights express relative shares, such as 3:2:1. */
export function splitByShares(amount: number, memberIds: readonly string[], shares: readonly string[]): Record<string, number> {
  const weights = shares.map(input => {
    if (typeof input !== 'string' || input.length > 32 || !/^\d+$/.test(input.trim())) {
      fail('Enter a nonnegative whole number of shares for each selected person.')
    }
    const value = BigInt(input.trim())
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('The number of shares is too large.')
    return value
  })
  return splitProportionally(amount, memberIds, weights)
}
