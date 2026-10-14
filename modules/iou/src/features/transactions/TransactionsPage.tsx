import { ReceiptText } from 'lucide-react'
import type { Group } from '../../domain/groups/types'
import type { GroupTransaction, TransactionFilter } from '../../domain/ledger/transactions'
import { PAGE_SIZE, Pagination } from '../../ui/Pagination'
import { TransactionRow } from './TransactionRow'

interface TransactionsPageProps {
  entries: readonly GroupTransaction[]
  filter: TransactionFilter
  limit: number
  hasGroups: boolean
  onFilter: (filter: TransactionFilter) => void
  onShowMore: () => void
  onOpenLog: (group: Group) => void
}

/** Expenses and payments from every group on this device, newest first. */
export function TransactionsPage({ entries, filter, limit, hasGroups, onFilter, onShowMore, onOpenLog }: TransactionsPageProps) {
  return (
    <section className="transactions-section">
      <div className="section-heading transactions-heading">
        <div>
          <h1>
            Transactions<span className="count-pill">{entries.length}</span>
          </h1>
          <p>Expenses and payments from all your groups.</p>
        </div>
      </div>
      <div className="panel transaction-panel all-transactions-panel">
        {/* biome-ignore lint/a11y/useSemanticElements: a styled div groups the filter buttons; a fieldset would change the layout */}
        <div className="log-filters segmented small" role="group" aria-label="Transaction type">
          {(['all', 'expense', 'payment'] as const).map(type => (
            <button type="button" key={type} className={filter === type ? 'active' : ''} aria-pressed={filter === type} onClick={() => onFilter(type)}>
              {type === 'all' ? 'All activity' : type === 'expense' ? 'Expenses' : 'Payments'}
            </button>
          ))}
        </div>
        {entries.length ? (
          <>
            <div className="transaction-list">
              {entries.slice(0, limit).map(entry => (
                <TransactionRow key={`${entry.group.id}:${entry.transaction.id}`} transaction={entry.transaction} group={entry.group} onOpenLog={onOpenLog} />
              ))}
            </div>
            {entries.length > PAGE_SIZE && <Pagination limit={limit} total={entries.length} onShowMore={onShowMore} />}
          </>
        ) : (
          <div className="panel-empty">
            <ReceiptText size={30} />
            <h3>No {filter === 'all' ? 'transactions' : filter === 'expense' ? 'expenses' : 'payments'} yet.</h3>
            <p>{hasGroups ? 'Your groups’ activity will appear here.' : 'Create or join a group from Home to get started.'}</p>
          </div>
        )}
      </div>
    </section>
  )
}
