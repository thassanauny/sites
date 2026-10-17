import { useMemo } from 'react'
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, History, LockKeyhole, Plus, ReceiptText, Users, Wallet } from 'lucide-react'
import type { Group, MemberBalance, Settlement, Transaction } from '../../domain/groups/types'
import { formatMoney, totalSpent } from '../../domain/ledger/calculations'
import type { TransactionFilter } from '../../domain/ledger/transactions'
import { Avatar, GroupIcon } from '../../ui/components'
import { InfoIcon } from '../../ui/InfoIcon'
import { PAGE_SIZE, Pagination } from '../../ui/Pagination'
import { TransactionRow } from '../transactions/TransactionRow'

interface GroupPageProps {
  group: Group
  /** Show the transaction log instead of the overview. */
  log: boolean
  yourId: string | undefined
  balances: readonly MemberBalance[]
  settlements: readonly Settlement[]
  /** The group's transactions, newest first. */
  transactions: readonly Transaction[]
  /** The transactions that match the log filter, newest first. */
  visibleTransactions: readonly Transaction[]
  logFilter: TransactionFilter
  logLimit: number
  /** Changes made here are still waiting to sync. */
  unsynced: boolean
  /** The shared groups have been reached at least once since this page opened. */
  synced: boolean
  canEdit: boolean
  version: string
  onNavigate: (page: 'home' | 'overview' | 'log') => void
  onSettings: () => void
  onExpense: () => void
  onPayment: (settlement?: Settlement) => void
  onFilter: (filter: TransactionFilter) => void
  onShowMore: () => void
  onDelete: (transaction: Transaction) => void
}

export function GroupPage({
  group,
  log,
  yourId,
  balances,
  settlements,
  transactions,
  visibleTransactions,
  logFilter,
  logLimit,
  unsynced,
  synced,
  canEdit,
  version,
  onNavigate,
  onSettings,
  onExpense,
  onPayment,
  onFilter,
  onShowMore,
  onDelete,
}: GroupPageProps) {
  const yourBalance = balances.find(b => b.member.id === yourId)
  const spent = useMemo(() => totalSpent(group), [group])
  const expenseCount = group.transactions.filter(t => t.type === 'expense').length
  return (
    <>
      <div className="group-breadcrumb">
        <button type="button" className="text-button" onClick={() => onNavigate('home')}>
          <ArrowLeft size={16} />
          Home
        </button>
        <span>
          <span className="tiny-dot" />
          {unsynced ? 'Saved on this device' : synced ? 'Synced' : 'Shared group'}
        </span>
      </div>
      <section className="group-heading">
        <GroupIcon id={group.icon} color={group.color} />
        <div className="group-heading-text">
          <div className="group-title-line">
            <h1>{group.name}</h1>
          </div>
          <div className="group-meta">
            <span>{group.members.length} members</span>
            <span className="meta-dot">·</span>
            <span>{group.currency}</span>
          </div>
        </div>
        {group.description.trim() && <p className="group-description">{group.description}</p>}
      </section>
      <section className="group-summary">
        <div className={`personal-balance${yourBalance && yourBalance.balance < 0 ? ' owes' : ''}`}>
          <div className="balance-overview">
            <div className="balance-main">
              <span className="eyebrow">{yourBalance ? (yourBalance.balance > 0 ? 'YOU GET BACK' : yourBalance.balance < 0 ? 'YOU OWE' : 'YOUR BALANCE') : 'YOUR BALANCE'}</span>
              <strong className="balance-amount">
                {yourBalance && (
                  <>
                    <small className="balance-currency">{group.currency}</small>{' '}
                  </>
                )}
                {yourBalance ? formatMoney(Math.abs(yourBalance.balance), group.currency, { includeCurrency: false }) : 'Who are you?'}
              </strong>
              {!yourBalance && (
                <button type="button" className="text-button" onClick={onSettings}>
                  Choose your name
                  <ArrowRight size={14} />
                </button>
              )}
              <p className="balance-details">
                {yourBalance ? (
                  <>
                    <span>Paid {formatMoney(yourBalance.paid, group.currency, { includeCurrency: false })}</span>{' '}
                    <span>Your share {formatMoney(yourBalance.share, group.currency, { includeCurrency: false })}</span>
                  </>
                ) : (
                  'Choose your member name in group settings.'
                )}
              </p>
            </div>
            <div className="balance-art" aria-hidden="true">
              <Wallet size={42} strokeWidth={1.25} />
              <span>
                <Check size={17} strokeWidth={1.8} />
              </span>
            </div>
          </div>
          <div className="group-total">
            <span>
              Group spending
              <small>
                {expenseCount} {expenseCount === 1 ? 'expense' : 'expenses'}
              </small>
            </span>
            <strong>{formatMoney(spent, group.currency)}</strong>
          </div>
        </div>
      </section>
      <div className="group-toolbar">
        <div className="segmented page-tabs">
          <button type="button" className={!log ? 'active' : ''} onClick={() => onNavigate('overview')}>
            <Users size={17} />
            Overview
          </button>
          <button type="button" className={log ? 'active' : ''} onClick={() => onNavigate('log')}>
            <History size={17} />
            Transaction log
          </button>
        </div>
        <div className="desktop-actions">
          <button type="button" className="button secondary compact" disabled={!canEdit} onClick={() => onPayment()}>
            <ArrowUpRight size={17} />
            Add payment
          </button>
          <button type="button" className="button primary compact" disabled={!canEdit} onClick={onExpense}>
            <Plus size={18} />
            Add expense
          </button>
        </div>
      </div>
      {log ? (
        <section className="panel transaction-panel">
          <div className="panel-heading">
            <div>
              <h2>Every little thing</h2>
              <p>The complete expense and payment history.</p>
            </div>
            <span className="count-pill">{group.transactions.length}</span>
          </div>
          <div className="log-filters segmented small">
            {(['all', 'expense', 'payment'] as const).map(type => (
              <button type="button" key={type} className={logFilter === type ? 'active' : ''} onClick={() => onFilter(type)}>
                {type === 'all' ? 'All activity' : type === 'expense' ? 'Expenses' : 'Payments'}
              </button>
            ))}
          </div>
          {visibleTransactions.length > 0 ? (
            <>
              <div className="transaction-list">
                {visibleTransactions.slice(0, logLimit).map(t => (
                  <TransactionRow key={`${group.id}:${t.id}`} transaction={t} group={group} onDelete={onDelete} canDelete={canEdit} />
                ))}
              </div>
              {visibleTransactions.length > PAGE_SIZE && <Pagination limit={logLimit} total={visibleTransactions.length} onShowMore={onShowMore} />}
            </>
          ) : (
            <div className="panel-empty">
              <ReceiptText size={30} />
              <h3>No {logFilter === 'all' ? 'transactions' : `${logFilter}s`} yet.</h3>
              <p>Add your first expense or record a payment.</p>
            </div>
          )}
        </section>
      ) : (
        <div className="overview-grid">
          <section className="panel member-panel">
            <div className="panel-heading">
              <div>
                <h2>Everyone’s balance</h2>
                <p>A fair share for every person.</p>
              </div>
              <Users size={19} />
            </div>
            <div className="member-list">
              {balances.map((b, i) => (
                <div className="balance-row" key={b.member.id}>
                  <Avatar member={b.member} index={i} />
                  <div className="balance-member">
                    <strong>
                      {b.member.name}
                      {b.member.id === yourId && <span className="you-tag">YOU</span>}
                    </strong>
                    <span>
                      Paid {formatMoney(b.paid, group.currency)}
                      <span className="desktop-member-share"> · Share {formatMoney(b.share, group.currency)}</span>
                    </span>
                  </div>
                  <div className={`member-status ${b.balance < 0 ? 'owes' : b.balance === 0 ? 'settled' : 'owed'}`}>
                    <span>{b.balance === 0 ? 'Settled up' : b.balance > 0 ? 'Gets back' : 'Owes'}</span>
                    <strong>{b.balance === 0 ? <CheckCheck size={20} /> : formatMoney(Math.abs(b.balance), group.currency)}</strong>
                  </div>
                </div>
              ))}
            </div>
            <div className="panel-footnote">
              <InfoIcon />
              <span>Payments are included in each person’s balance.</span>
            </div>
          </section>
          <section className="panel settle-panel">
            <div className="panel-heading">
              <div>
                <h2>Settle up simply</h2>
                <p>A few payments. Everyone square.</p>
              </div>
              <ArrowDownLeft size={20} />
            </div>
            {settlements.length > 0 ? (
              <div className="settlement-list">
                {settlements.map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the index only disambiguates a repeated pair in a derived, read-only list
                  <div className="settlement" key={`${s.fromId}-${s.toId}-${i}`}>
                    <span className="settlement-number">{i + 1}</span>
                    <div>
                      <strong>
                        {group.members.find(m => m.id === s.fromId)?.name}
                        <ArrowRight size={13} />
                        {group.members.find(m => m.id === s.toId)?.name}
                      </strong>
                      <span>{formatMoney(s.amount, group.currency)}</span>
                    </div>
                    <button type="button" className="button secondary tiny" disabled={!canEdit} onClick={() => onPayment(s)}>
                      Record<span className="sr-only"> payment {i + 1}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="settled-message">
                <span>
                  <CheckCheck size={28} />
                </span>
                <h3>All square!</h3>
                <p>{group.transactions.length ? 'Everyone is settled up. Onto the next good thing.' : 'No expenses yet. Add the first one when you’re ready.'}</p>
              </div>
            )}
            <div className="panel-footnote">Suggested payments simplify the group’s net balances.</div>
          </section>
          <section className="panel recent-panel">
            <div className="panel-heading">
              <div>
                <h2>Recent activity</h2>
                <p>The latest on your shared tab.</p>
              </div>
              <button type="button" className="text-button" onClick={() => onNavigate('log')}>
                View all
                <ArrowRight size={15} />
              </button>
            </div>
            {transactions.length ? (
              <div className="transaction-list">
                {transactions.slice(0, 4).map(t => (
                  <TransactionRow key={`${group.id}:${t.id}`} transaction={t} group={group} />
                ))}
              </div>
            ) : (
              <div className="panel-empty compact-empty">
                <ReceiptText size={27} />
                <p>No activity yet. Make the first expense count.</p>
                <button type="button" className="text-button" disabled={!canEdit} onClick={onExpense}>
                  <Plus size={16} />
                  Add an expense
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      <div className="group-footer">
        <span>
          <LockKeyhole size={13} />
          {group.currency} is fixed for this group.
        </span>
        <span className="app-version">iou · {version}</span>
      </div>
    </>
  )
}
