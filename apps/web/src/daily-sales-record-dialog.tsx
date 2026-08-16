import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import type { Closing, Vault } from "./daily-sales-client";
import { formatMoney, formatNumber } from "./number-format";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

export function DailySalesRecordDialog({
  language,
  closing,
  vaults,
  canCorrect,
  canReverse,
  onClose,
  onCorrect,
  onReverse,
}: {
  language: DailySalesLanguage;
  closing: Closing | null;
  vaults: readonly Vault[];
  canCorrect: boolean;
  canReverse: boolean;
  onClose: () => void;
  onCorrect: (closing: Closing) => void;
  onReverse: (closing: Closing) => void;
}) {
  const copy = dailySalesText[language];
  const dialogRef = useDialogFocusTrap({
    open: Boolean(closing),
    saving: false,
    onClose,
  });
  if (!closing) return null;

  const scope = copy[
    closing.scope.toLowerCase() as "morning" | "evening" | "all"
  ];
  const recordTitle = language === "ar" ? "\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0645\u0644\u062e\u0635" : "Summary details";
  const cancelledLabel = language === "ar" ? "\u0645\u0644\u063a\u0649" : "Cancelled";
  const cancelLabel = language === "ar" ? "\u0625\u0644\u063a\u0627\u0621" : "Cancel";
  const vaultName = (vaultId: string) => {
    const vault = vaults.find((item) => item.id === vaultId);
    return vault ? (language === "ar" ? vault.nameAr : vault.nameEn) : "\u2014";
  };

  return (
    <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="daily-sales-record-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-sales-record-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3 id="daily-sales-record-title">{recordTitle}</h3>
            <strong dir="ltr">{closing.documentNumber}</strong>
            <small>{closing.businessDate.slice(0, 10)} · {scope}</small>
          </div>
          <span className={`daily-sales-badge ${closing.status.toLowerCase()}`}>
            {closing.status === "REVERSED" ? cancelledLabel : copy[closing.status]}
          </span>
        </header>
        <dl className="daily-sales-record-dialog__facts">
          <div>
            <dt>{copy.gross}</dt>
            <dd dir="ltr">{formatMoney(closing.grossAmount)}</dd>
          </div>
          <div>
            <dt>{copy.customers}</dt>
            <dd dir="ltr">{formatNumber(closing.customerCount)}</dd>
          </div>
          <div>
            <dt>{copy.cashHandoverShort}</dt>
            <dd dir="ltr">
              {closing.cashHandoverAmount ? formatMoney(closing.cashHandoverAmount) : "\u2014"}
            </dd>
          </div>
        </dl>
        <section className="daily-sales-record-dialog__channels">
          <h4>{copy.channels}</h4>
          {closing.allocations.map((allocation) => (
            <div key={allocation.vaultId}>
              <span>{vaultName(allocation.vaultId)}</span>
              <strong dir="ltr">{formatMoney(allocation.grossAmount)}</strong>
            </div>
          ))}
        </section>
        {closing.notes && (
          <section className="daily-sales-record-dialog__notes">
            <h4>{copy.notes}</h4>
            <p>{closing.notes}</p>
          </section>
        )}
        <footer>
          <button className="daily-sales-secondary" type="button" onClick={onClose}>
            {copy.cancelEdit}
          </button>
          {closing.status === "POSTED" && canCorrect && (
            <button className="daily-sales-secondary" type="button" onClick={() => onCorrect(closing)}>
              {copy.edit}
            </button>
          )}
          {closing.status === "POSTED" && canReverse && (
            <button className="daily-sales-danger" type="button" onClick={() => onReverse(closing)}>
              {cancelLabel}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
