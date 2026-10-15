import { useEffect, useId, useRef, useState } from 'react'
import type { Expense, Group } from '../../domain/groups/types'
import { formatMoney } from '../../domain/ledger/calculations'

export function SplitDetails({ expense, group }: { expense: Expense; group: Group }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const dismiss = () => popup.current?.hidePopover()
    const reposition = () => {
      if (popup.current && trigger.current) positionPopup(popup.current, trigger.current)
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  return (
    <>
      <button ref={trigger} type="button" className="transaction-split-trigger" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open}>
        Split {Object.keys(expense.shares).length} ways
      </button>
      <div
        ref={popup}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={`Split amounts for ${expense.description}`}
        className="transaction-split-popup"
        onToggle={event => {
          const shown = event.newState === 'open'
          setOpen(shown)
          if (!shown || !trigger.current) return
          positionPopup(event.currentTarget, trigger.current)
        }}
      >
        <div className="transaction-split-content">
          <ul className="transaction-splits" aria-label="Split amounts">
            {Object.entries(expense.shares).map(([memberId, amount]) => (
              <li key={memberId}>
                <span>{group.members.find(member => member.id === memberId)?.name || 'Member'}</span>
                <strong>{formatMoney(amount, group.currency)}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}

function positionPopup(popup: HTMLDivElement, trigger: HTMLButtonElement) {
  const anchor = trigger.getBoundingClientRect()
  const box = popup.getBoundingClientRect()
  const inset = 12
  const gap = 10
  const left = Math.max(inset, Math.min(anchor.left, window.innerWidth - box.width - inset))
  const below = anchor.bottom + gap
  const fitsBelow = below + box.height <= window.innerHeight - inset
  const top = fitsBelow ? below : Math.max(inset, anchor.top - box.height - gap)
  const pointerLeft = Math.max(18, Math.min(anchor.left + anchor.width / 2 - left, box.width - 18))
  popup.dataset.side = fitsBelow ? 'bottom' : 'top'
  popup.style.left = `${left}px`
  popup.style.top = `${top}px`
  popup.style.setProperty('--split-pointer-left', `${pointerLeft}px`)
}
