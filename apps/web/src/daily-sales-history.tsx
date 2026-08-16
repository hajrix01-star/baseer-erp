import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import type { Closing } from "./daily-sales-client";
import { formatMoney, formatNumber } from "./number-format";

export function DailySalesHistory({
  language,
  closings,
  historyLimit,
  canCorrect,
  canReverse,
  onCorrect,
  onReverse,
}: {
  language: DailySalesLanguage;
  closings: readonly Closing[];
  historyLimit: number | null;
  canCorrect: boolean;
  canReverse: boolean;
  onCorrect: (closing: Closing) => void;
  onReverse: (closing: Closing) => void;
}) {
  const copy = dailySalesText[language];
  const cancellationLabel =
    language === "ar" ? "\u0625\u0644\u063a\u0627\u0621" : "Cancel";
  const cancelledLabel =
    language === "ar" ? "\u0645\u0644\u063a\u0649" : "Cancelled";
  return (
    <section className="daily-sales-history">
      <div>
        <h3>{copy.closings}</h3>
        <p>{copy.reversalHint}</p>
        {historyLimit !== null && historyLimit < 400 && (
          <p>{copy.historyLimited.replace("{count}", String(historyLimit))}</p>
        )}
      </div>
      {closings.length === 0 ? (
        <p className="daily-sales-empty-copy">{copy.noClosings}</p>
      ) : (
        <div
          className="daily-sales-register"
          role="region"
          aria-label={copy.closings}
        >
          <table>
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.scope}</th>
                <th>{copy.gross}</th>
                <th>{copy.customers}</th>
                <th>{copy.cashHandoverShort}</th>
                <th>{copy.status}</th>
                <th>{copy.actions}</th>
              </tr>
            </thead>
            <tbody>
              {closings.map((closing) => (
                <tr key={closing.closingId}>
                  <td>
                    <strong>{closing.documentNumber}</strong>
                    <small>{closing.businessDate.slice(0, 10)}</small>
                  </td>
                  <td>
                    {
                      copy[
                        closing.scope.toLowerCase() as
                          "morning" | "evening" | "all"
                      ]
                    }
                  </td>
                  <td>{formatMoney(closing.grossAmount)}</td>
                  <td>{formatNumber(closing.customerCount)}</td>
                  <td>
                    {closing.cashHandoverAmount
                      ? formatMoney(closing.cashHandoverAmount)
                      : "—"}
                  </td>
                  <td>
                    <span
                      className={`daily-sales-badge ${closing.status.toLowerCase()}`}
                    >
                      {closing.status === "REVERSED"
                        ? cancelledLabel
                        : copy[closing.status]}
                    </span>
                  </td>
                  <td>
                    {closing.status === "POSTED" &&
                      (canCorrect || canReverse) && (
                        <div className="daily-sales-register__actions">
                          {canCorrect && (
                            <button
                              className="daily-sales-secondary"
                              type="button"
                              onClick={() => onCorrect(closing)}
                            >
                              {copy.edit}
                            </button>
                          )}
                          {canReverse && (
                            <button
                              className="daily-sales-danger"
                              type="button"
                              onClick={() => onReverse(closing)}
                            >
                              {cancellationLabel}
                            </button>
                          )}
                        </div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
