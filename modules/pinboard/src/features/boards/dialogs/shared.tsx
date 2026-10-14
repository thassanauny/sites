import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, Copy, LoaderCircle, Trash2 } from 'lucide-react';
import { LIMITS } from '../../../domain/boards/board';

/** Inline error and clipboard state shared by the dialogs. */
export function useDialogMessages(onNotice: (text: string) => void) {
  const [localError, setLocalError] = useState('');
  const [copied, setCopied] = useState('');
  async function copy(value: string, kind: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      onNotice(`${kind} copied`);
    } catch {
      setLocalError('Could not copy automatically. Select the text below and copy it.');
    }
  }
  return { localError, setLocalError, copied, copy };
}

/** Closing asks first when the draft would be lost: unsaved edits, or a board removed elsewhere. */
export function useDraftClose(needsConfirmation: boolean, closeModal: () => void) {
  const [confirming, setConfirming] = useState(false);
  return {
    confirming,
    keepEditing: () => setConfirming(false),
    askToDiscard: () => setConfirming(true),
    close: () => (needsConfirmation ? setConfirming(true) : closeModal()),
  };
}

export function TitleField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <input
        // biome-ignore lint/a11y/noAutofocus: the first field takes focus when the dialog opens.
        autoFocus
        required
        maxLength={LIMITS.title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

export function DescriptionField({
  rows,
  value,
  onChange,
}: {
  rows: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      Description <span className="optional">optional</span>
      <textarea
        maxLength={LIMITS.description}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="A few details go a long way…"
      />
    </label>
  );
}

export function CopyField({
  code,
  copied,
  onCopy,
}: {
  code: string;
  copied: string;
  onCopy: () => void;
}) {
  return (
    <label className="field">
      Invitation code
      <div className="copy-field">
        <input readOnly value={code} onFocus={(event) => event.target.select()} />
        <button
          type="button"
          className="icon-button"
          onClick={onCopy}
          aria-label="Copy invitation code"
        >
          {copied === 'Code' ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p className="form-error" role="alert">
      {children}
    </p>
  );
}

/** The confirmation shown instead of a form when its draft would be thrown away. */
export function DiscardDraft({
  busy,
  removed,
  onKeep,
  onDiscard,
}: {
  busy: boolean;
  /** Another tab removed the board, so the draft cannot be saved until it is joined again. */
  removed: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <>
      <p className="dialog-intro">
        {removed
          ? 'This draft is kept only in this open page. Copy it or join the board again before discarding it.'
          : 'Your changes have not been saved. Discard them, or keep editing?'}
      </p>
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={busy} onClick={onKeep}>
          Keep draft
        </button>
        <button type="button" className="button danger" disabled={busy} onClick={onDiscard}>
          Discard draft
        </button>
      </div>
    </>
  );
}

/** Shown above a form whose board another tab removed from this device. */
export function DraftRecovery({
  busy,
  offline,
  draftText,
  onJoin,
  onCopy,
  onDiscard,
}: {
  busy: boolean;
  offline: boolean;
  draftText: string;
  onJoin: () => void;
  onCopy: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="draft-recovery" aria-label="Draft recovery">
      <p role="alert">
        This board was removed from this device in another tab. Your draft stays here. Join again to
        save it, copy it, or discard it.
      </p>
      <div className="recovery-actions">
        <button
          className="button secondary"
          type="button"
          disabled={busy || offline}
          onClick={onJoin}
        >
          Join again and keep draft
        </button>
        <button className="button quiet" type="button" onClick={onCopy}>
          <Copy size={16} />
          Copy draft
        </button>
        <button className="button quiet" type="button" disabled={busy} onClick={onDiscard}>
          Discard draft
        </button>
      </div>
      <details>
        <summary>View and copy draft</summary>
        <textarea
          aria-label="Draft for recovery"
          readOnly
          rows={6}
          value={draftText}
          onFocus={(event) => event.target.select()}
        />
      </details>
    </section>
  );
}

/** The form frame every editing dialog shares: fields, messages and actions. */
export function EditorForm({
  recovery,
  children,
  localError,
  serverError,
  offline,
  busy,
  locked,
  cancelLabel = 'Cancel',
  onCancel,
  submitLabel,
  submitIcon = 'check',
  deleteLabel,
  onDelete,
  onSubmit,
}: {
  recovery?: ReactNode;
  children: ReactNode;
  localError: string;
  serverError: string;
  offline: boolean;
  busy: boolean;
  locked: boolean;
  cancelLabel?: string;
  onCancel: () => void;
  submitLabel: string;
  submitIcon?: 'check' | 'arrow';
  deleteLabel?: string;
  onDelete?: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      {recovery}
      <fieldset className="editor-fields" disabled={busy}>
        {children}
      </fieldset>
      {localError && <FormError>{localError}</FormError>}
      {serverError && <FormError>{serverError}</FormError>}
      {offline && (
        <FormError>Reconnect to save. Your draft stays here while this page is open.</FormError>
      )}
      <div className="dialog-actions">
        {onDelete && (
          <button
            className="button delete-button"
            type="button"
            disabled={locked}
            onClick={onDelete}
          >
            <Trash2 size={16} />
            {deleteLabel}
          </button>
        )}
        <button className="button quiet" type="button" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button className="button primary" type="submit" disabled={locked}>
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : submitIcon === 'arrow' ? (
            <ArrowRight size={17} />
          ) : (
            <Check size={17} />
          )}
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
