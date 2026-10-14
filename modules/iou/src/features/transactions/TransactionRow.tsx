import { memo } from 'react'
import { ArrowUpRight, ChevronRight, ReceiptText, Trash2 } from 'lucide-react'
import type { Group, Transaction } from '../../domain/groups/types'
import { formatMoney } from '../../domain/ledger/calculations'
import { CATEGORIES } from '../../ui/components'
import { dateLabel } from '../../ui/format'

interface TransactionRowProps {
  transaction: Transaction
  group: Group
  /** Rows of the all-groups feed name their group, link to its log and show the currency code. */
  onOpenLog?: (group: Group) => void
  /** Rows of a group's log can be deleted. */
  onDelete?: (transaction: Transaction) => void
  canDelete?: boolean
}

/** Memoized: a long log should not render again for every poll, toast or dialog. */
export const TransactionRow = memo(function TransactionRow({ transaction: t, group, onOpenLog, onDelete, canDelete = false }: TransactionRowProps) {
  const isExpense = t.type === 'expense'
  const Icon = isExpense ? CATEGORIES.find(c => c.id === t.category)?.Icon || ReceiptText : ArrowUpRight
  const memberName = (id: string) => group.members.find(m => m.id === id)?.name || 'Member'
  return (
    <div className="transaction-row">
      <div className={`transaction-icon ${isExpense ? '' : 'payment-icon'}`}>
        <Icon size={20} />
      </div>
      <div className="transaction-description">
        {onOpenLog && (
          <button type="button" className="transaction-group" onClick={() => onOpenLog(group)} aria-label={`Open ${group.name} transaction log`}>
            {group.name}
            <ChevronRight size={12} />
          </button>
        )}
        <strong>{isExpense ? t.description : `${memberName(t.fromId)} paid ${memberName(t.toId)}`}</strong>
        <span>
          {isExpense ? `${memberName(t.paidBy)} paid · Split ${Object.keys(t.shares).length} ways` : t.note || 'Payment recorded'}
          <span className="transaction-date"> · {dateLabel(t.date)}</span>
        </span>
      </div>
      <div className="transaction-amount">
        <strong>
          {onOpenLog && `${group.currency} `}
          {formatMoney(t.amount, group.currency, { includeCurrency: !onOpenLog })}
        </strong>
        <span>{isExpense ? 'Expense' : 'Payment'}</span>
      </div>
      {onDelete && (
        <button type="button" className="icon-button delete-transaction" disabled={!canDelete} aria-label={`Delete ${isExpense ? t.description : 'payment'}`} onClick={() => onDelete(t)}>
          <Trash2 size={16} />
        </button>
      )}
    </div>
  )
})
