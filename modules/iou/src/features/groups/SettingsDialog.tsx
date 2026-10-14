import { LogOut } from 'lucide-react'
import type { Group } from '../../domain/groups/types'
import { Modal } from '../../ui/Modal'
import { SettingsForm, type SettingsValues } from './Forms'
import { RemoveGroupForm } from './Membership'

interface SettingsDialogProps {
  /** The group as it was when the dialog opened; the form edits this copy. */
  group: Group
  removing: boolean
  yourId: string | undefined
  /** Changes to this group are waiting to sync. */
  pending: boolean
  published: boolean
  travelDefault: boolean
  onClose: () => void
  onSave: (values: SettingsValues) => Promise<void>
  onExport: () => void
  onRemoving: (removing: boolean) => void
  onRemove: () => void
}

/** Group settings, with the confirmation for removing the group from this device. */
export function SettingsDialog({ group, removing, yourId, pending, published, travelDefault, onClose, onSave, onExport, onRemoving, onRemove }: SettingsDialogProps) {
  return (
    <Modal title={removing ? 'Remove from this device?' : 'Group settings'} subtitle={removing ? group.name : 'A few details that make it yours.'} onClose={onClose}>
      <div hidden={removing}>
        <SettingsForm group={group} yourId={yourId} onSubmit={onSave} onExport={onExport} />
        <div className="device-group-actions">
          <p>Remove this group from your lists on this device. Everyone else keeps access.</p>
          <button type="button" className="button secondary full" onClick={() => onRemoving(true)}>
            <LogOut size={17} />
            Remove from this device
          </button>
        </div>
      </div>
      {removing && <RemoveGroupForm group={group} pending={pending} published={published} travelDefault={travelDefault} onSubmit={onRemove} onCancel={() => onRemoving(false)} />}
    </Modal>
  )
}
