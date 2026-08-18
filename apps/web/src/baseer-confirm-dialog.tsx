import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { BaseerButton } from "./baseer-button";
import { uiCopy, type BaseerLanguage } from "./baseer-ui-copy";

type BaseerConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  language?: BaseerLanguage;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Shared confirmation pattern: a real modal, never the browser's blocking confirm prompt. */
export function BaseerConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive = false,
  busy = false,
  language = "ar",
  onCancel,
  onConfirm,
}: BaseerConfirmDialogProps) {
  const copy = uiCopy(language);
  const dialogRef = useDialogFocusTrap({ open, saving: busy, onClose: onCancel });
  if (!open) return null;
  return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !busy && onCancel()}>
    <section ref={dialogRef} className="daily-sales-dialog" role="dialog" aria-modal="true" aria-labelledby="baseer-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="daily-sales-dialog__header">
        <div><h3 id="baseer-confirm-title">{title}</h3><p>{message}</p></div>
        <BaseerButton variant="icon" type="button" aria-label={copy.close} onClick={onCancel} disabled={busy}>×</BaseerButton>
      </header>
      <footer className="daily-sales-dialog__actions">
        <BaseerButton type="button" variant="secondary" onClick={onCancel} disabled={busy}>{copy.cancel}</BaseerButton>
        <BaseerButton type="button" variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? copy.processing : confirmLabel}</BaseerButton>
      </footer>
    </section>
  </div>;
}