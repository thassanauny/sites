import type { Group, Member, MemberBalance, Settlement, Transaction } from '../groups/types'
import { requireMoney, safeAdd } from './fields'
import { MAX_AMOUNT_MINOR, fail } from './rules'

/**
 * Add up what each member paid, owes and is owed. The members and transactions must
 * already have passed validateGroup, which is the one place that parses untrusted data.
 */
export function accumulateBalances(members: readonly Member[], transactions: readonly Transaction[]): MemberBalance[] {
  const balances = members.map(member => ({ member: { ...member }, paid: 0, share: 0, balance: 0 }))
  const byId = new Map(balances.map(entry => [entry.member.id, entry]))
  const entryOf = (memberId: string) => byId.get(memberId) ?? fail('A transaction must reference an existing member.')
  for (const transaction of transactions) {
    if (transaction.type === 'expense') {
      const payer = entryOf(transaction.paidBy)
      payer.paid = safeAdd(payer.paid, transaction.amount)
      payer.balance = safeAdd(payer.balance, transaction.amount)
      for (const [memberId, share] of Object.entries(transaction.shares)) {
        const participant = entryOf(memberId)
        participant.share = safeAdd(participant.share, share)
        participant.balance = safeAdd(participant.balance, -share)
      }
    } else {
      const sender = entryOf(transaction.fromId)
      const recipient = entryOf(transaction.toId)
      sender.balance = safeAdd(sender.balance, transaction.amount)
      recipient.balance = safeAdd(recipient.balance, -transaction.amount)
    }
  }
  return balances
}

/** Balances of a group returned by validateGroup; positive means the member is owed money. */
export function getBalances(group: Group): MemberBalance[] {
  return accumulateBalances(group.members, group.transactions)
}

export function getSettlements(group: Group): Settlement[] {
  const balances = getBalances(group)
  const order = (left: { id: string; amount: number }, right: { id: string; amount: number }) => right.amount - left.amount || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  const debtors = balances
    .filter(entry => entry.balance < 0)
    .map(entry => ({ id: entry.member.id, amount: -entry.balance }))
    .sort(order)
  const creditors = balances
    .filter(entry => entry.balance > 0)
    .map(entry => ({ id: entry.member.id, amount: entry.balance }))
    .sort(order)
  const settlements: Settlement[] = []
  let debtorIndex = 0
  let creditorIndex = 0
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]!
    const creditor = creditors[creditorIndex]!
    const amount = Math.min(debtor.amount, creditor.amount, MAX_AMOUNT_MINOR)
    settlements.push({ fromId: debtor.id, toId: creditor.id, amount })
    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount === 0) debtorIndex += 1
    if (creditor.amount === 0) creditorIndex += 1
  }
  return settlements
}

export function totalSpent(group: Group): number {
  return group.transactions.reduce((total, transaction) => (transaction.type === 'expense' ? safeAdd(total, requireMoney(transaction.amount, 'Expense amount')) : total), 0)
}
