import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import type { Closing } from "./daily-sales-client";

type DailySalesReversalDialogProps = {
  language: DailySalesLanguage;
  closing: Closing | null;
  reason: string;
  saving: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function DailySalesReversalDialog({
  language,
  closing,
  reason,
  saving,
  onReasonChange,
  onClose,
  onConfirm,
}: DailySalesReversalDialogProps) {
  const copy = dailySalesText[language];
  const dialogRef = useDialogFocusTrap({ open: !!closing, saving, onClose });
  if (!closing) return null;
  const close = () => { if (!saving) onClose(); };
  const valid = reason.trim().length >= 3;

  return (
    <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={close}>
      <section ref={dialogRef} className="daily-sales-dialog daily-sales-reversal-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-sales-reversal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="daily-sales-dialog__header">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h3 id="daily-sales-reversal-title">{copy.reverseTitle}</h3>
            <p>{copy.reverseIntro}</p>
          </div>
          <button className="daily-sales-secondary" type="button" onClick={close} disabled={saving}>{copy.closeDialog}</button>
        </header>
        <div className="daily-sales-reversal-dialog__summary">
          <span>{copy.reverseRecord}</span>
          <strong>{closing.documentNumber}</strong>
          <span>{closing.businessDate.slice(0, 10)} · {closing.grossAmount} SAR</span>
        </div>
        <label className="daily-sales-reversal-dialog__reason">
          <span>{copy.reverseReason}</span>
          <textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={500} minLength={3} required />
          <small>{copy.reversalHint}</small>
        </label>
        <footer className="daily-sales-dialog__actions">
          <button className="daily-sales-secondary" type="button" onClick={close} disabled={saving}>{copy.cancelEdit}</button>
          <button className="daily-sales-danger" type="button" onClick={onConfirm} disabled={saving || !valid}>{saving ? copy.saving : copy.reverseConfirm}</button>
        </footer>
      </section>
    </div>
  );
}