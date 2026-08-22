import { useState } from "react";

import { BaseerButton } from "./baseer-button";
import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { BaseerPeriodFilter, baseerPeriodQuery, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import {
  activeSession,
  api,
  type ActiveSession,
  type CalendarDay,
} from "./daily-sales-client";
import type { DailySalesLanguage } from "./daily-sales-copy";

type OperationalCalendarReceipt = { companyId: string; fromBusinessDate: string; toBusinessDate: string; days: CalendarDay[] };

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
    accessDenied: "لا تملك صلاحية قراءة تقويم التشغيل والمبيعات.",
    receiptMismatch: "تعذر التحقق من نطاق قراءة التقويم. أعد المحاولة.",
    currency: "SAR",
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
    accessDenied: "You do not have permission to read the operations and sales calendar.",
    receiptMismatch: "The calendar read scope could not be verified. Please refresh.",
    currency: "SAR",
  },
} as const;

export function CommandCenterSalesCalendar({
  language,
  permissionCodes,
}: {
  language: DailySalesLanguage;
  permissionCodes: readonly string[] | null;
}) {
  const copy = statusCopy[language];
  const [range, setRange] = useState(defaultBaseerPeriodRange);
  const session = activeSession();
  if (!session) return <DailySalesSignIn language={language} />;
  if (permissionCodes === null) return <CommandCenterSalesCalendarContent language={language} copy={copy} range={range} onRangeChange={setRange} days={[]} loading error="" onRefresh={() => undefined} />;
  const canReadCalendar = permissionCodes?.includes("finance.daily_sales.read") ?? false;
  if (!canReadCalendar) return <CommandCenterSalesCalendarContent language={language} copy={copy} range={range} onRangeChange={setRange} days={[]} loading={false} error={copy.accessDenied} onRefresh={() => undefined} />;

  const scope = [language, range.preset, range.from, range.to, range.months.join(",")];
  return <BaseerCompanyReadQuery session={session} resource="command-center.operational-calendar" scope={scope} load={(current, signal) => api<OperationalCalendarReceipt>(current, `/finance/operational-calendar?${baseerPeriodQuery(range)}`, { signal })}>
    {({ data, loading, error, refetch }) => {
      const receiptMatchesScope = data?.companyId === session.companyId && data.fromBusinessDate.slice(0, 10) === range.from && data.toBusinessDate.slice(0, 10) === range.to;
      return <CommandCenterSalesCalendarContent language={language} copy={copy} range={range} onRangeChange={setRange} days={receiptMatchesScope ? data.days : []} loading={loading} error={error ? presentBaseerApiError(error, language, copy.error) : data && !receiptMatchesScope ? copy.receiptMismatch : ""} onRefresh={() => void refetch().catch(() => undefined)} />;
    }}
  </BaseerCompanyReadQuery>;
}

function CommandCenterSalesCalendarContent({ language, copy, range, onRangeChange, days, loading, error, onRefresh }: { language: DailySalesLanguage; copy: typeof statusCopy[DailySalesLanguage]; range: BaseerPeriodRange; onRangeChange: (range: BaseerPeriodRange) => void; days: CalendarDay[]; loading: boolean; error: string; onRefresh: () => void }) {
  return (
    <section className="command-sales-calendar" aria-busy={loading}>
      <header>
        <div>
          <p className="eyebrow">Baseer ERP</p>
          <h2>{copy.title}</h2>
        </div>
        <BaseerButton type="button" variant="secondary" disabled={loading} onClick={onRefresh}>
          {copy.refresh}
        </BaseerButton>
      </header>
      <BaseerPeriodFilter language={language} value={range} onChange={onRangeChange} />
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
                {copy.amount}: <bdi dir="ltr">{copy.currency} {day.salesGrossAmount}</bdi>
              </small>
            </article>
          );
        })}
      </div>
    </section>
  );
}
