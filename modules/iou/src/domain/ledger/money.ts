import { MAX_AMOUNT_MINOR, fail } from './rules'

export const CURRENCIES = [
  { code: 'THB', label: 'Thai baht', digits: 2 },
  { code: 'BDT', label: 'Bangladeshi taka', digits: 2 },
  { code: 'USD', label: 'US dollar', digits: 2 },
  { code: 'CAD', label: 'Canadian dollar', digits: 2 },
  { code: 'EUR', label: 'Euro', digits: 2 },
] as const

export function currencyDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) fail('Use a three-letter currency code, such as GBP.')
  return 2
}

/** Convert decimal text without introducing floating-point rounding. */
export function parseAmount(input: string, currency: string): number {
  const digits = currencyDigits(currency)
  if (typeof input !== 'string') fail('Enter a valid amount.')
  const trimmed = input.trim()
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed) || trimmed.length > 32) fail('Enter a valid positive amount.')
  const [whole = '', fraction = ''] = trimmed.split('.')
  if (fraction.length > digits) fail(`${currency} allows ${digits} decimal places.`)
  const minor = BigInt(whole || '0') * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')
  if (minor < 1n || minor > BigInt(MAX_AMOUNT_MINOR)) fail('The amount must be positive and within the supported limit.')
  return Number(minor)
}

/** Exact decimal text for integer minor units, such as 1234 -> "12.34". */
export function formatDecimal(minor: number | bigint, currency: string): string {
  const digits = currencyDigits(currency)
  if (typeof minor !== 'bigint' && !Number.isSafeInteger(minor)) fail('Money must use integer minor units.')
  const integer = BigInt(minor)
  const absolute = integer < 0n ? -integer : integer
  const scale = 10n ** BigInt(digits)
  return `${integer < 0n ? '-' : ''}${absolute / scale}.${(absolute % scale).toString().padStart(digits, '0')}`
}

// Building an Intl.NumberFormat is far costlier than using one, and a screen formats many amounts.
const formatters = new Map<string, Intl.NumberFormat>()
function formatterFor(currency: string, includeCurrency: boolean, digits: number): Intl.NumberFormat {
  const key = `${currency}:${includeCurrency}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: includeCurrency ? 'currency' : 'decimal', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
    formatters.set(key, formatter)
  }
  return formatter
}

export function formatMoney(minor: number | bigint, currency: string, options: { includeCurrency?: boolean } = {}): string {
  const digits = currencyDigits(currency)
  if (typeof minor !== 'bigint' && !Number.isSafeInteger(minor)) fail('Money must use integer minor units.')
  const integer = BigInt(minor)
  const formatter = formatterFor(currency, options.includeCurrency !== false, digits)
  const absolute = integer < 0n ? -integer : integer
  const scale = 10n ** BigInt(digits)
  const whole = absolute / scale
  const fraction = (absolute % scale).toString().padStart(digits, '0')
  const signedWhole = integer < 0n ? (whole === 0n ? -0 : -whole) : whole
  return formatter
    .formatToParts(signedWhole)
    .map(part => (part.type === 'fraction' ? fraction : part.value))
    .join('')
}

/** Keep credits and debts separate, and aggregate exactly across any number of groups. */
export function getCurrencyBalances(entries: readonly { currency: string; balance: number }[]): Array<{ code: string; label: string; digits: number; owed: bigint; owes: bigint }> {
  const totals: Array<{ code: string; label: string; digits: number; owed: bigint; owes: bigint }> = CURRENCIES.map(({ code, label, digits }) => ({ code, label, digits, owed: 0n, owes: 0n }))
  for (const entry of entries) {
    const digits = currencyDigits(entry.currency)
    let total = totals.find(currency => currency.code === entry.currency)
    if (!total) {
      total = { code: entry.currency, label: entry.currency, digits, owed: 0n, owes: 0n }
      totals.push(total)
    }
    if (!Number.isSafeInteger(entry.balance)) fail('Money must use integer minor units.')
    const balance = BigInt(entry.balance)
    if (balance > 0n) total.owed += balance
    else total.owes -= balance
  }
  return totals
}
