import type { ReactNode } from "react";
import { BaseerButton } from "./baseer-button";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { uiCopy, type BaseerLanguage } from "./baseer-ui-copy";

type Props = { open: boolean; title: string; children: ReactNode; language: BaseerLanguage; busy?: boolean; onClose: () => void; footer?: ReactNode; size?: "default" | "wide" };

/** Central modal shell for forms and read-only details. Uses the shared focus trap and close convention. */
export function BaseerDialog({ open, title, children, language, busy = false, onClose, footer, size = "default" }: Props) {
  const copy = uiCopy(language);
  const dialogRef = useDialogFocusTrap({ open, saving: busy, onClose });
  if (!open) return null;
  // Dialog forms share a compact desktop rhythm. The controls keep their normal
  // touch size on small screens through the existing global media rule.
  return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
    <section ref={dialogRef} className={`daily-sales-dialog baseer-dialog baseer-dialog--${size}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header className="daily-sales-dialog__header"><h3>{title}</h3><BaseerButton variant="icon" type="button" aria-label={copy.close} disabled={busy} onClick={onClose}>×</BaseerButton></header>
      <div className="daily-sales-dialog__body">{children}</div>
      {footer ? <footer className="daily-sales-dialog__actions">{footer}</footer> : null}
    </section>
  </div>;
}
