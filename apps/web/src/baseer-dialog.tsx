import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BaseerButton } from "./baseer-button";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { uiCopy, type BaseerLanguage } from "./baseer-ui-copy";

type Props = { open: boolean; title: string; eyebrow?: ReactNode; children: ReactNode; language: BaseerLanguage; busy?: boolean; error?: string | null; reserveErrorSpace?: boolean; onClose: () => void; footer?: ReactNode; size?: "default" | "wide"; className?: string };

/** Central modal shell for forms and read-only details. Uses the shared focus trap and close convention. */
export function BaseerDialog({ open, title, eyebrow, children, language, busy = false, error, reserveErrorSpace = false, onClose, footer, size = "default", className }: Props) {
  const copy = uiCopy(language);
  const [reportedError, setReportedError] = useState<string | null>(null);
  const [isTopmost, setIsTopmost] = useState(false);
  useEffect(() => { if (open) setReportedError(null); }, [open, title]);
  const dialogRef = useDialogFocusTrap({ open, saving: busy, onClose, onError: setReportedError, onTopmostChange: setIsTopmost });
  if (!open) return null;
  const visibleError = error ?? reportedError;
  // Dialog forms share a compact desktop rhythm. The controls keep their normal
  // touch size on small screens through the existing global media rule.
  return createPortal(<div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
    <section ref={dialogRef} className={["daily-sales-dialog", "baseer-dialog", `baseer-dialog--${size}`, className].filter(Boolean).join(" ")} role="dialog" aria-modal={isTopmost ? "true" : undefined} aria-hidden={isTopmost ? undefined : true} aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <div className="daily-sales-dialog__header">{eyebrow ? <div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div> : <h3>{title}</h3>}<BaseerButton variant="icon" type="button" aria-label={copy.close} disabled={busy} onClick={onClose}>×</BaseerButton></div>
      <div className="daily-sales-dialog__body">
        {reserveErrorSpace || visibleError ? <div className={`baseer-dialog__error-slot${visibleError ? " is-visible" : ""}`} role={visibleError ? "alert" : undefined} aria-live="assertive" aria-atomic="true">{visibleError || "\u00a0"}</div> : null}
        {children}
      </div>
      {footer ? <footer className="daily-sales-dialog__actions">{footer}</footer> : null}
    </section>
  </div>, document.body);
}
