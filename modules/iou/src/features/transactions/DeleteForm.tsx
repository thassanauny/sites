import { useState } from 'react'
import { FormError } from '../groups/Forms'
import { errorMessage } from '../../ui/format'

export function DeleteForm({ onSubmit, onCancel }: { onSubmit: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form className="form-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); try { await onSubmit() } catch (err) { setError(errorMessage(err)); setBusy(false) } }}><FormError error={error}/><div className="form-columns"><button type="button" className="button secondary" onClick={onCancel}>Keep transaction</button><button className="button danger" disabled={busy}>{busy ? 'Deleting…' : 'Delete transaction'}</button></div></form>
}
