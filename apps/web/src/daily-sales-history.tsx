import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import type { Closing } from "./daily-sales-client";
import { formatMoney, formatNumber } from "./number-format";

export function DailySalesHistory({
  language,
  closings,
  historyLimit,
  onView,
}: {
  language: DailySalesLanguage;
  closings: readonly Closing[];
  historyLimit: number | null;
  onView: (closing: Closing) => void;
}) {
  const copy = dailySalesText[language];
  const cancelledLabel = language === "ar" ? "\u0645\u0644\u063a\u0649" : "Cancelled";
  const recordLabel = language === "ar" ? "\u0627\u0644\u0633\u062c\u0644" : "Record";

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
        <div className="daily-sales-register" role="region" aria-label={copy.closings}>
          <table>
            <caption className="visually-hidden">{copy.closings}</caption>
            <thead>
              <tr>
                <th scope="col">{recordLabel}</th>
                <th scope="col">{copy.scope}</th>
                <th scope="col" className="is-number">{copy.gross}</th>
                <th scope="col" className="is-number">{copy.customers}</th>
                <th scope="col" className="is-number">{copy.cashHandoverShort}</th>
                <th scope="col" className="is-status">{copy.status}</th>
              </tr>
            </thead>
            <tbody>
              {closings.map((closing) => (
                <tr key={closing.closingId}>
                  <td>
                    <button
                      className="daily-sales-record-link"
                      type="button"
                      onClick={() => onView(closing)}
                    >
                      <strong dir="ltr">{closing.documentNumber}</strong>
                      <small>{closing.businessDate.slice(0, 10)}</small>
                    </button>
                  </td>
                  <td>{copy[closing.scope.toLowerCase() as "morning" | "evening" | "all"]}</td>
                  <td className="is-number" dir="ltr">{formatMoney(closing.grossAmount)}</td>
                  <td className="is-number" dir="ltr">{formatNumber(closing.customerCount)}</td>
                  <td className="is-number" dir="ltr">
                    {closing.cashHandoverAmount ? formatMoney(closing.cashHandoverAmount) : "\u2014"}
                  </td>
                  <td className="is-status">
                    <span className={`daily-sales-badge ${closing.status.toLowerCase()}`}>
                      {closing.status === "REVERSED" ? cancelledLabel : copy[closing.status]}
                    </span>
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
