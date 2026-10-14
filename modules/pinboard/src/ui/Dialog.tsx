import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Dialog({
  title,
  children,
  busy,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Read while rendering: React focuses an `autoFocus` field before any effect runs.
  const [opener] = useState(() => document.activeElement);
  const titleId = useId();
  useEffect(
    // A native modal hands focus back when it closes, but React removes this one.
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new title means new content, so focus moves again.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog
      .querySelector<HTMLElement>(
        '[autofocus]:not(:disabled), input:not([readonly]):not(:disabled), textarea:not([readonly]):not(:disabled), select:not(:disabled), .dialog-actions button:not(:disabled)',
      )
      ?.focus();
  }, [title]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape already closes the dialog through onCancel.
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={wide ? 'dialog wide' : 'dialog'}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (outside) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
