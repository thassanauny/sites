import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Clipboard, Link, LockKeyhole, RefreshCw, Users, WifiOff } from 'lucide-react'
import { invitationCode, isInviteCode } from '../../domain/groups/identifiers'
import type { Group } from '../../domain/groups/types'
import { GroupIcon } from '../../ui/components'
import { FormError, SubmitButton } from '../../ui/forms'
import { errorMessage } from '../../ui/format'
import { InfoIcon } from '../../ui/InfoIcon'

export function JoinForm({
  code,
  configured,
  onFetch,
  onJoin,
  onQueue,
}: {
  code?: string
  configured: boolean
  onFetch: (code: string, isCurrent: () => boolean) => Promise<Group | null>
  onJoin: (group: Group, selectedId: string, name: string, newMemberId: string) => Promise<void>
  onQueue: (code: string, name: string, memberId: string) => void
}) {
  const [newMemberId] = useState(() => crypto.randomUUID())
  const [input, setInput] = useState(code || '')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [group, setGroup] = useState<Group | null>(null)
  const [waitingCode, setWaitingCode] = useState('')
  const [identity, setIdentity] = useState('')
  const [yourName, setYourName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!configured) throw new Error('Connect Supabase before creating or joining a group.')
      if (waitingCode) {
        onQueue(waitingCode, yourName, newMemberId)
        return
      }
      if (!group) {
        const normalized = invitationCode(input)
        if (!isInviteCode(normalized)) throw new Error('Enter the complete 32-character invite code.')
        const found = await onFetch(normalized, () => mounted.current)
        if (!found) setWaitingCode(normalized)
        else {
          setGroup(found)
          setIdentity('')
        }
      } else {
        if (!identity && !yourName.trim()) throw new Error('Enter your name or choose an existing member.')
        if (!identity && group.members.some(m => m.name.toLowerCase() === yourName.trim().toLowerCase())) throw new Error('That name is already in this group. Select it from the member list.')
        await onJoin(group, identity, identity ? group.members.find(m => m.id === identity)!.name : yourName, newMemberId)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {waitingCode ? (
        <>
          <div className="form-note">
            <WifiOff size={16} />
            <span>This group isn’t saved here yet. We’ll join it when connected. Enter your existing member name, or a new name to add.</span>
          </div>
          <label>
            Your name
            <input value={yourName} onChange={e => setYourName(e.target.value)} required maxLength={80} />
          </label>
          <button type="button" className="text-button" onClick={() => setWaitingCode('')}>
            Use another invitation
          </button>
        </>
      ) : !group ? (
        <>
          <label>
            Invitation code or link
            <input disabled={busy} value={input} onChange={e => setInput(e.target.value)} placeholder="Paste your group’s code" required autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <div className="form-note">
            <LockKeyhole size={16} />
            <span>Your invitation unlocks a shared group. Keep it between your people.</span>
          </div>
        </>
      ) : (
        <>
          <div className="joined-group-preview">
            <GroupIcon id={group.icon} color={group.color} />
            <div>
              <h3>{group.name}</h3>
              <span>
                {group.members.length} members · {group.currency}
              </span>
            </div>
            <Check size={20} />
          </div>
          <label>
            Who are you in this group?
            <select value={identity} onChange={e => setIdentity(e.target.value)}>
              <option value="">I’m a new member</option>
              {group.members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          {!identity && (
            <label>
              Your name
              <input value={yourName} onChange={e => setYourName(e.target.value)} placeholder="Your name in this group" required maxLength={80} />
            </label>
          )}
        </>
      )}
      <FormError error={error} />
      <SubmitButton busy={busy}>
        {waitingCode ? 'Save join request' : group ? 'Join group' : 'Find my group'}
        <ArrowRight size={17} />
      </SubmitButton>
      {!configured && <p className="field-hint">Connect Supabase to enable shared invitation codes.</p>}
    </form>
  )
}

export function InviteContent({ group, published, onCopy }: { group: Group; published: boolean; onCopy: (message: string) => void }) {
  const [error, setError] = useState('')
  const link = `${window.location.origin}${window.location.pathname}#/group/${group.inviteCode}`
  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onCopy(message)
    } catch {
      setError('Clipboard access is unavailable. Select and copy the code below.')
    }
  }
  if (!published)
    return (
      <div className="form-note">
        <WifiOff size={17} />
        <span>Your group is saved on this device. Its invitation code will be ready after the first sync.</span>
      </div>
    )
  return (
    <div className="form-stack">
      <div className="invite-code-box">
        <span>YOUR GROUP’S UNIQUE INVITATION CODE</span>
        <input aria-label="Invitation code" readOnly value={group.inviteCode} onFocus={e => e.target.select()} />
        <button type="button" className="button primary full" onClick={() => void copy(group.inviteCode, 'Invitation code copied.')}>
          <Clipboard size={17} />
          Copy invitation code
        </button>
      </div>
      <button type="button" className="button secondary full" onClick={() => void copy(link, 'Invite link copied.')}>
        <Link size={17} />
        Copy invite link
      </button>
      <div className="form-note">
        <Users size={17} />
        <span>Anyone with this code can join and edit this group. Share it with people you trust.</span>
      </div>
      <FormError error={error} />
    </div>
  )
}

export function RemoveGroupForm({
  group,
  pending,
  published,
  travelDefault,
  onSubmit,
  onCancel,
}: {
  group: Group
  pending: boolean
  published: boolean
  travelDefault: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const copyCode = async () => {
    setError('')
    try {
      await navigator.clipboard.writeText(group.inviteCode)
      setCopied(true)
    } catch {
      setError('Select and copy the invitation code before removing the group.')
    }
  }
  return (
    <form
      className="form-stack"
      onSubmit={event => {
        event.preventDefault()
        setError('')
        try {
          onSubmit()
        } catch (err) {
          setError(errorMessage(err))
        }
      }}
    >
      <p className="help-paragraph">This removes the group, its saved member name, and its pin from this device. The shared group, members, expenses, and payments stay available to everyone else.</p>
      {travelDefault && (
        <div className="form-note">
          <InfoIcon />
          <span>Your Travel mode default will also be cleared and Travel mode will turn off.</span>
        </div>
      )}
      {pending && (
        <div className="form-note">
          <RefreshCw size={17} />
          <span>Your saved changes will still sync when connected.{!published && ' Sync this new group first if you want to keep its invitation code.'}</span>
        </div>
      )}
      {published && (
        <>
          <label>
            Invitation code
            {/* biome-ignore lint/a11y/noAutofocus: the code is the point of this dialog and focus moves into the modal anyway */}
            <input readOnly autoFocus value={group.inviteCode} onFocus={event => event.target.select()} />
            <span className="field-hint">Keep this code to rejoin later.</span>
          </label>
          <button type="button" className="button secondary full" onClick={() => void copyCode()}>
            <Clipboard size={17} />
            {copied ? 'Code copied' : 'Copy invitation code'}
          </button>
        </>
      )}
      <FormError error={error} />
      <div className="form-columns">
        <button type="button" className="button secondary" onClick={onCancel}>
          Keep on this device
        </button>
        <button type="submit" className="button primary">
          Remove from this device
        </button>
      </div>
    </form>
  )
}
