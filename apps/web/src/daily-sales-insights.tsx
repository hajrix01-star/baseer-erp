import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import type { CashHandoverReport, ShiftSummary } from "./daily-sales-client";

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
                {copy[
                  shift.scope.toLowerCase() as "morning" | "evening" | "all"
                ]}
              </strong>
              <span>{shift.grossAmount} SAR</span>
              <small>
                {shift.customerCount} · {shift.averageOrderAmount ?? copy.notAvailable} SAR
              </small>
            </div>
          ))}
        </div>
      </article>
      <article>
        <p>{copy.cashHandoverReport}</p>
        <strong>{cashHandover?.totalCashHandoverAmount ?? "0.0000"} SAR</strong>
        <small>{cashHandover?.recordCount ?? 0} {copy.handoverRecords}</small>
      </article>
    </section>
  );
}