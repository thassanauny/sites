import { memo } from 'react'
import { CheckCheck, ChevronRight, Pin } from 'lucide-react'
import type { Group } from '../../domain/groups/types'
import { formatMoney } from '../../domain/ledger/calculations'
import { Avatar, GroupIcon } from '../../ui/components'

interface GroupCardProps {
  group: Group
  /** Your balance in this group, or undefined until you have chosen which member you are. */
  balance: number | undefined
  pinned: boolean
  onOpen: (group: Group) => void
  onTogglePin: (groupId: string) => void
}

export const GroupCard = memo(function GroupCard({ group: g, balance, pinned, onOpen, onTogglePin }: GroupCardProps) {
  return (
    <article className="group-card">
      <button type="button" className="card-open" onClick={() => onOpen(g)} aria-label={`Open ${g.name}`}>
        <span className="card-top">
          <GroupIcon id={g.icon} color={g.color} />
          <span className="group-currency">{g.currency}</span>
        </span>
        <h3>{g.name}</h3>
        <p className="card-description">{g.description || `${g.members.length} ${g.members.length === 1 ? 'person' : 'people'}, one shared tab.`}</p>
        <span className="card-members">
          <span className="avatar-stack">
            {g.members.slice(0, 4).map((m, i) => (
              <Avatar key={m.id} member={m} index={i} small />
            ))}
          </span>
          <span>
            {g.members.length} {g.members.length === 1 ? 'member' : 'members'}
          </span>
        </span>
        <span className="card-balance">
          <span>{balance === undefined ? 'Choose your member name' : balance === 0 ? 'All settled up' : balance > 0 ? 'You get back' : 'You owe'}</span>
          <strong className={balance && balance < 0 ? 'amount-owes' : 'amount-owed'}>
            {balance === undefined ? <ChevronRight size={20} /> : balance === 0 ? <CheckCheck size={20} /> : formatMoney(Math.abs(balance), g.currency)}
          </strong>
        </span>
      </button>
      <button type="button" className={`pin-button ${pinned ? 'pinned' : ''}`} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${g.name}`} aria-pressed={pinned} onClick={() => onTogglePin(g.id)}>
        <Pin size={18} />
      </button>
    </article>
  )
})
