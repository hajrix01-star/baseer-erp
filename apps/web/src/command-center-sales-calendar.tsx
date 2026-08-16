import { useCallback, useEffect, useState } from "react";

import { DailySalesSignIn } from "./daily-sales-sign-in";
import { BaseerPeriodFilter, baseerPeriodQuery, defaultBaseerPeriodRange } from "./baseer-period-filter";
import {
  activeSession,
  api,
  type ActiveSession,
  type CalendarDay,
} from "./daily-sales-client";
import type { DailySalesLanguage } from "./daily-sales-copy";
import { formatMoney } from "./number-format";

const statusCopy = {
  ar: {
    title: "تقويم التشغيل والمبيعات",
    subtitle:
      "قراءة تنفيذية لحالة أيام التشغيل. لا تُدخل منه مبيعات أو تعدّل القيود.",
    recorded: "تم الحفظ",
    pending: "بيانات ناقصة",
    dayOff: "بدون عمل",
    partial: "تشغيل جزئي",
    open: "يوم عمل",
    amount: "مبيعات مثبتة",
    refresh: "تحديث",
    error: "تعذر تحميل التقويم من الخادم.",
  },
  en: {
    title: "Operations and sales calendar",
    subtitle:
      "Executive read-only operational status. Sales and journals are never edited here.",
    recorded: "Closing recorded",
    pending: "Incomplete data",
    dayOff: "Day off",
    partial: "Partial operation",
    open: "Operating day",
    amount: "Posted sales",
    refresh: "Refresh",
    error: "The calendar could not be loaded from the server.",
  },
} as const;

export function CommandCenterSalesCalendar({
  language,
}: {
  language: DailySalesLanguage;
}) {
  const copy = statusCopy[language];
  const [range, setRange] = useState(defaultBaseerPeriodRange);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    try {
      const query = baseerPeriodQuery(range);
      const result = await api<{ days: CalendarDay[] }>(
        current,
        `/finance/operational-calendar?${query}`,
      );
      setDays(result.days);
      setError("");
    } catch {
      setError(copy.error);
    }
  }, [copy.error, range.from, range.to, range.months.join(",")]);

  useEffect(() => {
    void load();
  }, [load]);
  if (!session) return <DailySalesSignIn language={language} />;

  return (
    <section className="command-sales-calendar">
      <header>
        <div>
          <p className="eyebrow">Baseer ERP</p>
          <h2>{copy.title}</h2>
        </div>
        <button
          className="daily-sales-secondary"
          type="button"
          onClick={() => void load()}
        >
          {copy.refresh}
        </button>
      </header>
      <BaseerPeriodFilter language={language} value={range} onChange={setRange} />
      {error && <p className="daily-sales-message error">{error}</p>}
      <div className="command-sales-calendar__grid">
        {days.map((day) => {
          const label =
            day.operationalStatus === "CLOSED"
              ? copy.dayOff
              : day.operationalStatus === "PARTIAL"
                ? copy.partial
                : day.dataStatus === "RECORDED"
                  ? copy.recorded
                  : day.dataStatus === "PENDING"
                    ? copy.pending
                    : copy.open;
          return (
            <article
              key={day.businessDate}
              className={`command-sales-calendar__day is-${day.dataStatus.toLowerCase()}`}
            >
              <strong>{day.businessDate.slice(8, 10)}</strong>
              <span>{label}</span>
              <small>
                {copy.amount}: {formatMoney(day.salesGrossAmount)}
              </small>
            </article>
          );
        })}
      </div>
    </section>
  );
}
