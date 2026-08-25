import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import { formatDate, formatMoney } from "./number-format";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import { BaseerTextArea } from "./baseer-form-fields";
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
          title: "\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0645\u0644\u062e\u0635",
          intro: "\u0647\u0644 \u062a\u0631\u064a\u062f \u0625\u0644\u063a\u0627\u0621 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u062e\u0635\u061f",
          record:
            "\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u0645\u0631\u0627\u062f \u0625\u0644\u063a\u0627\u0624\u0647",
          reason:
            "\u0633\u0628\u0628 \u0627\u0644\u0625\u0644\u063a\u0627\u0621",
          confirm: "\u0625\u0644\u063a\u0627\u0621",
          hint: "",
        }
      : {
          title: "Cancel summary",
          intro: "Cancel this summary?",
          record: "Record to cancel",
          reason: "Cancellation reason",
          confirm: "Cancel",
          hint: "",
        };
  if (!closing) return null;
  const close = () => {
    if (!saving) onClose();
  };
  const valid = reason.trim().length >= 3;

  return (
    <BaseerDialog
      open
      title={cancellation.title}
      language={language}
      busy={saving}
      className="daily-sales-reversal-dialog"
      onClose={close}
      footer={<><BaseerButton
        className="daily-sales-secondary"
        type="button"
        variant="secondary"
        onClick={close}
        disabled={saving}
      >
        {copy.cancelEdit}
      </BaseerButton><BaseerButton
        className="daily-sales-danger"
        type="button"
        variant="danger"
        onClick={onConfirm}
        disabled={saving || !valid}
      >
        {saving ? copy.saving : cancellation.confirm}
      </BaseerButton></>}
    >
        <p className="eyebrow">{copy.eyebrow}</p>
        <p>{cancellation.intro}</p>
        <div className="daily-sales-reversal-dialog__summary">
          <span>{cancellation.record}</span>
          <strong>{closing.documentNumber}</strong>
          <span>
            <bdi dir="ltr">{formatDate(closing.businessDate, language)}</bdi> ·{" "}
            {formatMoney(closing.grossAmount)}
          </span>
        </div>
        <label className="daily-sales-reversal-dialog__reason">
          <span>{cancellation.reason}</span>
          <BaseerTextArea
            value={reason}
            onValueChange={onReasonChange}
            maxLength={500}
            minLength={3}
            required
          />
          {cancellation.hint ? <small>{cancellation.hint}</small> : null}
        </label>
    </BaseerDialog>
  );
}
