import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerDataGrid, type BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { api, type ActiveSession } from "./daily-sales-client";
import { formatCount, formatDate, formatMoney, formatQuantity } from "./number-format";

type Language = "ar" | "en";

type InternalRegistrationReport = {
  totals: { registrationCount: number; lineCount: number; quantity: string; amount: string };
  registrations: Array<{
    id: string;
    registrationNumber: string;
    businessDate: string;
    sectionNameAr: string;
    sectionNameEn: string | null;
    lines: Array<{
      lineNumber: number;
      productNameAr: string;
      productNameEn: string | null;
      unitNameAr: string;
      unitNameEn: string | null;
      quantity: string;
      menuSaleUnitPrice: string | null;
      lineTotal: string | null;
    }>;
  }>;
};

type Copy = { title: string; refresh: string; date: string; registrations: string; lines: string; totalQuantity: string; totalAmount: string; number: string; section: string; products: string; price: string; amount: string; failed: string; noData: string; loading: string };

const copy: Record<Language, Copy> = {
  ar: { title: "تقرير التسجيل الداخلي", refresh: "تحديث", date: "تاريخ العمل", registrations: "التسجيلات", lines: "البنود", totalQuantity: "إجمالي الكمية", totalAmount: "إجمالي القيمة", number: "الرقم", section: "القسم", products: "الأصناف والكميات", price: "سعر الوحدة", amount: "الإجمالي", failed: "تعذر تحميل تقرير التسجيل الداخلي.", noData: "لا توجد تسجيلات ضمن الفترة.", loading: "جارٍ تحميل التقرير…" },
  en: { title: "Internal registration report", refresh: "Refresh", date: "Business date", registrations: "Registrations", lines: "Lines", totalQuantity: "Total quantity", totalAmount: "Total value", number: "Number", section: "Section", products: "Products & quantities", price: "Unit price", amount: "Total", failed: "Could not load the internal registration report.", noData: "No registrations in this period.", loading: "Loading report…" },
};

/** Read-only audit report; it never exposes itself on the staff entry workspace. */
export function OperationsInternalRegistrationReport({ language, session }: { language: Language; session: ActiveSession }) {
  const ar = language === "ar";
  const t = copy[language];
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange());
  const columns: readonly BaseerDataGridColumn<InternalRegistrationReport["registrations"][number]>[] = [
    { id: "number", header: t.number, cell: (row) => <bdi dir="ltr">{row.registrationNumber}</bdi> },
    { id: "date", header: t.date, cell: (row) => <bdi dir="ltr">{formatDate(row.businessDate, language)}</bdi> },
    { id: "section", header: t.section, cell: (row) => ar ? row.sectionNameAr : row.sectionNameEn ?? row.sectionNameAr },
    { id: "products", header: t.products, cell: (row) => <div className="baseer-data-table__stack">{row.lines.map((line) => <small key={line.lineNumber}>{ar ? line.productNameAr : line.productNameEn ?? line.productNameAr} · <bdi dir="ltr">{formatQuantity(line.quantity, 3, language)}</bdi> {ar ? line.unitNameAr : line.unitNameEn ?? line.unitNameAr}</small>)}</div> },
    { id: "price", header: t.price, numeric: true, cell: (row) => <div className="baseer-data-table__stack">{row.lines.map((line) => <small key={line.lineNumber}><bdi dir="ltr">{formatMoney(line.menuSaleUnitPrice, "SAR", language)}</bdi></small>)}</div> },
    { id: "amount", header: t.amount, numeric: true, cell: (row) => <div className="baseer-data-table__stack">{row.lines.map((line) => <small key={line.lineNumber}><bdi dir="ltr">{formatMoney(line.lineTotal, "SAR", language)}</bdi></small>)}</div> },
  ];
  const load = (current: ActiveSession, signal: AbortSignal) => api<InternalRegistrationReport>(current, `/operations/internal-registration/report?${new URLSearchParams({ from: period.from, to: period.to })}`, { signal });

  return <BaseerCompanyReadQuery session={session} resource="operations.internal-registration.report" scope={[period.from, period.to]} load={load}>
    {({ data, loading, error, refetch }) => <div className="administration-list">
      <div className="operations-catalog__card-heading"><div><h3>{t.title}</h3></div></div>
      <BaseerFilterBar language={language} controls={<><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={["DAY", "MONTH", "QUARTER", "YEAR", "RANGE"]} allowNonContiguousMonths={false} /><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void refetch()}>{t.refresh}</BaseerButton></>} />
      {error ? <p className="daily-sales-message error">{presentBaseerApiError(error, language, t.failed)}</p> : null}
      {data ? <><div className="baseer-card-grid">
        <BaseerCard><strong>{t.registrations}</strong><p><bdi dir="ltr">{formatCount(data.totals.registrationCount, language)}</bdi></p></BaseerCard>
        <BaseerCard><strong>{t.lines}</strong><p><bdi dir="ltr">{formatCount(data.totals.lineCount, language)}</bdi></p></BaseerCard>
        <BaseerCard><strong>{t.totalQuantity}</strong><p><bdi dir="ltr">{formatQuantity(data.totals.quantity, 3, language)}</bdi></p></BaseerCard>
        <BaseerCard><strong>{t.totalAmount}</strong><p><bdi dir="ltr">{formatMoney(data.totals.amount, "SAR", language)}</bdi></p></BaseerCard>
      </div>{data.registrations.length ? <BaseerDataGrid ariaLabel={t.title} caption={t.title} rows={data.registrations} rowKey={(row) => row.id} columns={columns} /> : <BaseerCard><p>{t.noData}</p></BaseerCard>}</> : loading ? <BaseerCard><p>{t.loading}</p></BaseerCard> : null}
    </div>}
  </BaseerCompanyReadQuery>;
}
