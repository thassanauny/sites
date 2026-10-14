import { Modal } from './Modal'

interface RecoveryDialogProps {
  onClose: () => void
  onDownload: () => void
  onReset: () => void
}

export function RecoveryDialog({ onClose, onDownload, onReset }: RecoveryDialogProps) {
  return (
    <Modal title="Recover your saved data" onClose={onClose}>
      <p className="help-paragraph">Download the original browser data first. If a newer version of iou saved it, update iou instead: it may open normally.</p>
      <p className="help-paragraph">
        Resetting removes everything saved on this device, including changes that have not synced yet. Your shared groups load again from the server because your browser session is kept.
      </p>
      <button type="button" className="button secondary full" onClick={onDownload}>
        Download recovery backup
      </button>
      <button type="button" className="button danger full recovery-reset" onClick={onReset}>
        Reset local saved data
      </button>
    </Modal>
  )
}
