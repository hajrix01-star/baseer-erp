import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { formatMoney } from "./number-format";
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
  const cancellation =
    language === "ar"
      ? {
          title:
            "\u062a\u0623\u0643\u064a\u062f \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0642\u0641\u064a\u0644",
          intro:
            "\u064a\u064f\u0644\u063a\u064a \u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u0623\u062b\u0631 \u0627\u0644\u0645\u062d\u0627\u0633\u0628\u064a \u0628\u0642\u064a\u062f \u0645\u0642\u0627\u0628\u0644 \u0645\u0648\u062b\u0642\u060c \u0648\u0644\u0627 \u064a\u062d\u0630\u0641 \u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u0623\u0635\u0644\u064a.",
          record:
            "\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u0645\u0631\u0627\u062f \u0625\u0644\u063a\u0627\u0624\u0647",
          reason:
            "\u0633\u0628\u0628 \u0627\u0644\u0625\u0644\u063a\u0627\u0621",
          confirm:
            "\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0625\u0644\u063a\u0627\u0621",
          hint: "\u0627\u0644\u0625\u0644\u063a\u0627\u0621 \u0644\u0627 \u064a\u062d\u0630\u0641 \u0627\u0644\u0633\u062c\u0644\u061b \u064a\u0646\u0634\u0626 \u0642\u064a\u062f\u064b\u0627 \u0645\u0642\u0627\u0628\u0644\u064b\u0627 \u0645\u0648\u062b\u0642\u064b\u0627.",
        }
      : {
          title: "Confirm closing cancellation",
          intro:
            "Cancellation creates a documented offsetting journal; the original record is never deleted.",
          record: "Record to cancel",
          reason: "Cancellation reason",
          confirm: "Confirm cancellation",
          hint: "Cancellation preserves history and creates a documented offsetting journal.",
        };
  const dialogRef = useDialogFocusTrap({ open: !!closing, saving, onClose });
  if (!closing) return null;
  const close = () => {
    if (!saving) onClose();
  };
  const valid = reason.trim().length >= 3;

  return (
    <div
      className="daily-sales-dialog-backdrop"
      role="presentation"
      onMouseDown={close}
    >
      <section
        ref={dialogRef}
        className="daily-sales-dialog daily-sales-reversal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-sales-reversal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="daily-sales-dialog__header">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h3 id="daily-sales-reversal-title">{cancellation.title}</h3>
            <p>{cancellation.intro}</p>
          </div>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={close}
            disabled={saving}
          >
            {copy.closeDialog}
          </button>
        </header>
        <div className="daily-sales-reversal-dialog__summary">
          <span>{cancellation.record}</span>
          <strong>{closing.documentNumber}</strong>
          <span>
            {closing.businessDate.slice(0, 10)} Â·{" "}
            {formatMoney(closing.grossAmount)}
          </span>
        </div>
        <label className="daily-sales-reversal-dialog__reason">
          <span>{cancellation.reason}</span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            maxLength={500}
            minLength={3}
            required
          />
          <small>{cancellation.hint}</small>
        </label>
        <footer className="daily-sales-dialog__actions">
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={close}
            disabled={saving}
          >
            {copy.cancelEdit}
          </button>
          <button
            className="daily-sales-danger"
            type="button"
            onClick={onConfirm}
            disabled={saving || !valid}
          >
            {saving ? copy.saving : cancellation.confirm}
          </button>
        </footer>
      </section>
    </div>
  );
}
