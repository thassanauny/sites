import type { Expense, Group, Member, Payment, Transaction } from '../groups/types'
import { isInviteCode } from '../groups/identifiers'
import { accumulateBalances } from './balances'
import { day, id, onlyKeys, record, requireMoney, safeAdd, text, timestamp } from './fields'
import { currencyDigits } from './money'
import { MAX_MEMBERS, MAX_TRANSACTIONS, fail } from './rules'

// supabase/schema.sql (iou_valid_group) accepts exactly these fields.
const GROUP_KEYS = ['id', 'name', 'description', 'currency', 'icon', 'color', 'inviteCode', 'createdAt', 'updatedAt', 'members', 'transactions']
const EXPENSE_KEYS = ['id', 'type', 'description', 'amount', 'paidBy', 'shares', 'category', 'date', 'createdAt']
const PAYMENT_KEYS = ['id', 'type', 'fromId', 'toId', 'amount', 'note', 'date', 'createdAt']

function validateMembers(members: unknown): Member[] {
  if (!Array.isArray(members) || members.length < 1 || members.length > MAX_MEMBERS) {
    fail(`A group must have between 1 and ${MAX_MEMBERS} members.`)
  }
  const seen = new Set<string>()
  return members.map(value => {
    const member = record(value, 'Member', ['id', 'name'])
    const memberId = id(member.id, 'Member ID')
    if (seen.has(memberId)) fail('Member IDs must be unique.')
    seen.add(memberId)
    return { id: memberId, name: text(member.name, 'Member name', 80) }
  })
}

/** The first member name used twice, ignoring case and surrounding spaces. */
export function duplicateMemberName(members: readonly { name: string }[]): string | undefined {
  const seen = new Set<string>()
  for (const member of members) {
    const key = member.name.trim().toLowerCase()
    if (seen.has(key)) return member.name.trim()
    seen.add(key)
  }
  return undefined
}

function readTransaction(input: unknown, memberIds: ReadonlySet<string>): Transaction {
  const value = record(input, 'Transaction')
  const keys = value.type === 'expense' ? EXPENSE_KEYS : value.type === 'payment' ? PAYMENT_KEYS : fail('Transaction type is invalid.')
  onlyKeys(value, 'Transaction', keys)
  const memberReference = (inputId: unknown, label: string): string => {
    if (typeof inputId === 'string' && memberIds.has(inputId)) return inputId
    id(inputId, label)
    return fail(`${label} must reference an existing member.`)
  }
  const common = {
    id: id(value.id, 'Transaction ID'),
    amount: requireMoney(value.amount, 'Transaction amount'),
    date: day(value.date, 'Transaction date'),
    createdAt: timestamp(value.createdAt, 'Transaction creation time'),
  }
  if (value.type === 'expense') {
    const sharesInput = record(value.shares, 'Expense shares')
    const entries = Object.entries(sharesInput)
    if (entries.length < 1 || entries.length > MAX_MEMBERS) fail('An expense needs participants.')
    let sum = 0
    const shares: Record<string, number> = {}
    for (const [memberId, amount] of entries) {
      memberReference(memberId, 'Participant')
      const share = requireMoney(amount, 'Participant share', true)
      sum = safeAdd(sum, share)
      shares[memberId] = share
    }
    if (sum !== common.amount) fail('Participant shares must add up to the expense amount.')
    const expense: Expense = {
      ...common,
      type: 'expense',
      description: text(value.description, 'Expense description', 160),
      paidBy: memberReference(value.paidBy, 'Payer'),
      shares,
      category: text(value.category, 'Expense category', 40),
    }
    return expense
  }
  const fromId = memberReference(value.fromId, 'Payment sender')
  const toId = memberReference(value.toId, 'Payment recipient')
  if (fromId === toId) fail('Payment sender and recipient must be different members.')
  const payment: Payment = { ...common, type: 'payment', fromId, toId, note: text(value.note, 'Payment note', 500, false) }
  return payment
}

export function validateTransaction(transaction: Transaction, members: readonly Member[]): void {
  readTransaction(transaction, new Set(validateMembers(members).map(member => member.id)))
}

/**
 * The single parsing step for untrusted group data (storage, server and forms). It returns
 * a detached, normalized clone; getBalances, getSettlements and totalSpent expect such a group.
 */
export function validateGroup(input: unknown): Group {
  const value = record(input, 'Group', GROUP_KEYS)
  const members = validateMembers(value.members)
  const memberIds = new Set(members.map(member => member.id))
  if (!Array.isArray(value.transactions) || value.transactions.length > MAX_TRANSACTIONS) fail(`Groups support up to ${MAX_TRANSACTIONS} transactions.`)
  const seen = new Set<string>()
  const transactions = value.transactions.map(inputTransaction => {
    const transaction = readTransaction(inputTransaction, memberIds)
    if (seen.has(transaction.id)) fail('Transaction IDs must be unique.')
    seen.add(transaction.id)
    return transaction
  })
  const currency = text(value.currency, 'Currency', 3)
  currencyDigits(currency)
  const color = text(value.color, 'Group color', 9)
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) fail('Group color must be a hex color.')
  const inviteCode = text(value.inviteCode, 'Invite code', 32)
  if (!isInviteCode(inviteCode)) fail('Invite code is invalid.')
  const createdAt = timestamp(value.createdAt, 'Group creation time')
  const updatedAt = timestamp(value.updatedAt, 'Group update time')
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail('Group update time cannot be before its creation time.')
  const group: Group = {
    id: id(value.id, 'Group ID'),
    name: text(value.name, 'Group name', 80),
    description: text(value.description, 'Group description', 500, false),
    currency,
    icon: text(value.icon, 'Group icon', 32),
    color,
    inviteCode,
    createdAt,
    updatedAt,
    members,
    transactions,
  }
  accumulateBalances(members, transactions)
  return group
}
