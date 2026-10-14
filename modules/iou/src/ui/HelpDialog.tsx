import { InfoIcon } from './InfoIcon'
import { Modal } from './Modal'

interface HelpDialogProps {
  cloudConfigured: boolean
  recoveryRequired: boolean
  onClose: () => void
  onRecover: () => void
}

export function HelpDialog({ cloudConfigured, recoveryRequired, onClose, onRecover }: HelpDialogProps) {
  return (
    <Modal title="Help" onClose={onClose}>
      <div className="help-content">
        <ul className="help-list">
          <li>
            <h3>Split & settle</h3>
            <p>Add expenses, choose a split, and record payments. Each group keeps one fixed currency.</p>
          </li>
          <li>
            <h3>Invite people</h3>
            <p>Share the code from Invite after the first sync. Anyone with it can join and edit. Offline join requests finish when connected.</p>
          </li>
          <li>
            <h3>Travel mode</h3>
            <p>Choose a default group in Travel mode, turn it on, and save. iou opens that group on launch. This setting stays on your device.</p>
          </li>
          <li>
            <h3>Use offline</h3>
            <p>Create and edit offline. Changes save here and sync when connected. If edits conflict, the latest edit wins.</p>
          </li>
          <li>
            <h3>Install on your phone</h3>
            <p>
              iPhone: Safari → Share → Add to Home Screen.
              <br />
              Android: browser menu → Install app.
            </p>
          </li>
          <li>
            <h3>Rejoin a group</h3>
            <p>Keep your invitation code to rejoin.</p>
          </li>
          <li>
            <h3>Export a group</h3>
            <p>Export a group CSV from Group settings.</p>
          </li>
        </ul>
        {!cloudConfigured && (
          <div className="form-note">
            <InfoIcon />
            <span>Group creation and joining require Supabase. Set the project URL and public key, and run the included database setup.</span>
          </div>
        )}
        {recoveryRequired && (
          <button type="button" className="text-button" onClick={onRecover}>
            Recover saved data
          </button>
        )}
      </div>
    </Modal>
  )
}
