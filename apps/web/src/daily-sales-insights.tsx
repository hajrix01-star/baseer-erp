import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import type { CashHandoverReport, ShiftSummary } from "./daily-sales-client";
import { formatMoney, formatNumber } from "./number-format";

export function DailySalesInsights({
  language,
  shifts,
  cashHandover,
}: {
  language: DailySalesLanguage;
  shifts: readonly ShiftSummary[];
  cashHandover: CashHandoverReport | null;
}) {
  const copy = dailySalesText[language];
  return (
    <section className="daily-sales-insights" aria-label={copy.shiftReport}>
      <article>
        <p>{copy.shiftReport}</p>
        <div className="daily-sales-insights__shifts">
          {shifts.map((shift) => (
            <div key={shift.scope}>
              <strong>
                {
                  copy[
                    shift.scope.toLowerCase() as "morning" | "evening" | "all"
                  ]
                }
              </strong>
              <span>{formatMoney(shift.grossAmount)}</span>
              <small>
                {formatNumber(shift.customerCount)} ·{" "}
                {shift.averageOrderAmount
                  ? formatMoney(shift.averageOrderAmount)
                  : copy.notAvailable}
              </small>
            </div>
          ))}
        </div>
      </article>
      <article>
        <p>{copy.cashHandoverReport}</p>
        <strong>
          {formatMoney(cashHandover?.totalCashHandoverAmount ?? "0")}
        </strong>
        <small>
          {formatNumber(cashHandover?.recordCount ?? 0)} {copy.handoverRecords}
        </small>
      </article>
    </section>
  );
}
