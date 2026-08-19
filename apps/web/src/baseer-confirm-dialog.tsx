import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
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

/** Shared confirmation pattern backed by the central modal stack. */
export function BaseerConfirmDialog({ open, title, message, confirmLabel, destructive = false, busy = false, language = "ar", onCancel, onConfirm }: BaseerConfirmDialogProps) {
  const copy = uiCopy(language);
  return <BaseerDialog open={open} title={title} language={language} busy={busy} onClose={onCancel} footer={<><BaseerButton type="button" variant="secondary" onClick={onCancel} disabled={busy}>{copy.cancel}</BaseerButton><BaseerButton type="button" variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? copy.processing : confirmLabel}</BaseerButton></>}><p>{message}</p></BaseerDialog>;
}
