import { useState, type FormEvent, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

/** Run a form's async action once at a time, keeping its busy flag and any error message. */
export function useSubmission(action: () => Promise<void>) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, submit, clearError: () => setError('') }
}

export function FormError({ error }: { error: string }) {
  return error ? (
    <div className="form-error" role="alert">
      {error}
    </div>
  ) : null
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button className="button primary full" type="submit" disabled={busy}>
      {busy ? <LoaderCircle size={18} className="spin" /> : null}
      {busy ? 'Saving…' : children}
    </button>
  )
}
