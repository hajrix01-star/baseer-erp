import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { DataTable } from "./data-table";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { hasActivePermission } from "./module-access";
import { formatCount, formatDate, formatMoney, formatQuantity } from "./number-format";
import "./operations-internal-registration-workspace.css";

const LazyOperationsInternalRegistrationEntry = lazy(async () => ({ default: (await import("./operations-internal-registration-entry")).OperationsInternalRegistrationEntry }));
type Language = "ar" | "en";
type Report = { totals: { registrationCount: number; lineCount: number; quantity: string; amount: string }; registrations: Array<{ id: string; registrationNumber: string; businessDate: string; sectionNameAr: string; sectionNameEn: string | null; lines: Array<{ lineNumber: number; productNameAr: string; productNameEn: string | null; unitNameAr: string; unitNameEn: string | null; quantity: string; menuSaleUnitPrice: string | null; lineTotal: string | null }> }> };
/** One page, one data source: the server grants financial fields only to report readers. */
export function OperationsInternalRegistrationWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const t = ar ? { title: "التسجيل الداخلي", description: "يسجل الموظف المنتجات والكميات فقط؛ الأسعار لا تصل إلى حسابه.", date: "تاريخ العمل", report: "تقرير التسجيل الداخلي", from: "من", to: "إلى", refresh: "تحديث", registrations: "التسجيلات", lines: "البنود", totalQuantity: "إجمالي الكمية", totalAmount: "إجمالي القيمة", number: "الرقم", section: "القسم", products: "الأصناف والكميات", price: "سعر الوحدة", amount: "الإجمالي", failed: "تعذر إكمال العملية. حاول مرة أخرى." } : { title: "Internal registration", description: "Staff record products and quantities only; prices never reach their account.", date: "Business date", report: "Internal registration report", from: "From", to: "To", refresh: "Refresh", registrations: "Registrations", lines: "Lines", totalQuantity: "Total quantity", totalAmount: "Total value", number: "Number", section: "Section", products: "Products & quantities", price: "Unit price", amount: "Total", failed: "Could not complete the operation." };
  const canCreate = hasActivePermission("operations.internal_registration.create");
  const canRead = hasActivePermission("operations.internal_registration.read");
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [report, setReport] = useState<Report | null>(null);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const loadReport = useCallback(async () => {
    const current = activeSession(); setSession(current);
    if (!current || !canRead) return;
    setBusy(true);
    try { setReport(await api<Report>(current, `/operations/internal-registration/report?${new URLSearchParams({ from: period.from, to: period.to })}`)); }
    catch (error) { setMessage(presentBaseerApiError(error, language, t.failed)); }
    finally { setBusy(false); }
  }, [canRead, language, period.from, period.to, t.failed]);
  useEffect(() => { void loadReport(); }, [loadReport]);
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="operations-internal-registration" dir={ar ? "rtl" : "ltr"}>
    <header><div><p className="eyebrow">Operations O4</p><h2>{t.title}</h2><p>{t.description}</p></div></header>
    {message ? <p className="daily-sales-message error">{message}</p> : null}
    {canCreate ? <Suspense fallback={<BaseerCard><p>{ar ? "جارٍ تجهيز نموذج التسجيل…" : "Preparing registration form…"}</p></BaseerCard>}><LazyOperationsInternalRegistrationEntry language={language} onSaved={canRead ? loadReport : undefined} /></Suspense> : null}
    {canRead ? <BaseerCard className="operations-internal-registration__report"><header><h3>{t.report}</h3><div><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} allowNonContiguousMonths={false} /><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void loadReport()}>{t.refresh}</BaseerButton></div></header>{report ? <><div className="operations-internal-registration__report-metrics"><span>{t.registrations}: <strong dir="ltr">{formatCount(report.totals.registrationCount, language)}</strong></span><span>{t.lines}: <strong dir="ltr">{formatCount(report.totals.lineCount, language)}</strong></span><span>{t.totalQuantity}: <strong dir="ltr">{formatQuantity(report.totals.quantity, 3, language)}</strong></span><span>{t.totalAmount}: <strong dir="ltr">{formatMoney(report.totals.amount, "SAR", language)}</strong></span></div><DataTable ariaLabel={t.report} caption={t.report} rows={report.registrations} rowKey={(row) => row.id} columns={[{ id: "number", header: t.number, cell: (row) => <bdi dir="ltr">{row.registrationNumber}</bdi> }, { id: "date", header: t.date, cell: (row) => <bdi dir="ltr">{formatDate(row.businessDate, language)}</bdi> }, { id: "section", header: t.section, cell: (row) => ar ? row.sectionNameAr : row.sectionNameEn ?? row.sectionNameAr }, { id: "products", header: t.products, cell: (row) => <div>{row.lines.map((line) => <small key={line.lineNumber}>{ar ? line.productNameAr : line.productNameEn ?? line.productNameAr} · <bdi dir="ltr">{formatQuantity(line.quantity, 3, language)}</bdi> {ar ? line.unitNameAr : line.unitNameEn ?? line.unitNameAr}</small>)}</div> }, { id: "price", header: t.price, cell: (row) => <div>{row.lines.map((line) => <small key={line.lineNumber}><bdi dir="ltr">{formatMoney(line.menuSaleUnitPrice, "SAR", language)}</bdi></small>)}</div> }, { id: "amount", header: t.amount, cell: (row) => <div>{row.lines.map((line) => <small key={line.lineNumber}><bdi dir="ltr">{formatMoney(line.lineTotal, "SAR", language)}</bdi></small>)}</div> }]} /></> : null}</BaseerCard> : null}
  </section>;
}
