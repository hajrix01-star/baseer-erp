import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { DataTable, type DataTableColumn } from "./data-table";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";

type Language = "ar" | "en";
type MaterialRow = { rawMaterialItemId: string; materialNameAr: string; materialNameEn: string | null; unitId: string; unitNameAr: string; unitNameEn: string | null; quantity: string; amount: string; weightedActualUnitPrice: string };
type MaterialsReport = { totals: { materialCount: number; quantity: string; amount: string }; materials: MaterialRow[] };
type CustodyMonth = { month: string; openingBalance: string; funding: string; purchases: string; returns: string; reversals: string; closingBalance: string };
type CustodyReport = { representativeName: string | null; months: CustodyMonth[] };
type ReportsData = { materials: MaterialsReport; custody: CustodyReport };

/** Read-only reports are cached only inside their live company/session/period boundary. */
export function OperationsReportsWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const t = ar ? { title: "تقارير المشتريات والعهدة", description: "تعرض هذه التقارير الشراء الفعلي وحركات العهدة فقط؛ لا تدخل خطط الطلبات في الأرقام.", refresh: "تحديث", materials: "المواد المستلمة", material: "المادة", unit: "الوحدة", quantity: "الكمية", amount: "القيمة الفعلية", average: "متوسط السعر الفعلي", materialCount: "عدد المواد", totalQuantity: "إجمالي الكمية", totalAmount: "إجمالي القيمة", custody: "كشف عهدة المندوب الشهري", representative: "المندوب", month: "الشهر", opening: "الرصيد الافتتاحي", funding: "العهدة المسلّمة", purchases: "المشتريات الفعلية", returns: "المرتجع", reversals: "تصحيحات", closing: "الرصيد الختامي", failed: "تعذر تحميل التقرير.", noData: "لا توجد حركات ضمن الفترة." } : { title: "Purchasing & custody reports", description: "These reports use actual purchases and custody movements only; purchase plans are excluded.", refresh: "Refresh", materials: "Received materials", material: "Material", unit: "Unit", quantity: "Quantity", amount: "Actual value", average: "Actual unit average", materialCount: "Materials", totalQuantity: "Total quantity", totalAmount: "Total value", custody: "Monthly representative custody", representative: "Representative", month: "Month", opening: "Opening balance", funding: "Funding", purchases: "Actual purchases", returns: "Returns", reversals: "Corrections", closing: "Closing balance", failed: "Could not load the report.", noData: "No movements in this period." };
  const [session] = useState<ActiveSession | null>(activeSession());
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange());
  if (!session) return <DailySalesSignIn language={language} />;
  const materialColumns: readonly DataTableColumn<MaterialRow>[] = [{ id: "material", header: t.material, cell: (row) => ar ? row.materialNameAr : row.materialNameEn ?? row.materialNameAr }, { id: "unit", header: t.unit, cell: (row) => ar ? row.unitNameAr : row.unitNameEn ?? row.unitNameAr }, { id: "quantity", header: t.quantity, numeric: true, cell: (row) => row.quantity }, { id: "average", header: t.average, numeric: true, cell: (row) => row.weightedActualUnitPrice }, { id: "amount", header: t.amount, numeric: true, cell: (row) => row.amount }];
  const custodyColumns: readonly DataTableColumn<CustodyMonth>[] = [{ id: "month", header: t.month, cell: (row) => row.month }, { id: "opening", header: t.opening, numeric: true, cell: (row) => row.openingBalance }, { id: "funding", header: t.funding, numeric: true, cell: (row) => row.funding }, { id: "purchases", header: t.purchases, numeric: true, cell: (row) => row.purchases }, { id: "returns", header: t.returns, numeric: true, cell: (row) => row.returns }, { id: "reversals", header: t.reversals, numeric: true, cell: (row) => row.reversals }, { id: "closing", header: t.closing, numeric: true, cell: (row) => row.closingBalance }];
  const load = async (current: ActiveSession, signal: AbortSignal): Promise<ReportsData> => {
    const query = new URLSearchParams({ from: period.from, to: period.to });
    const [materials, custody] = await Promise.all([
      api<MaterialsReport>(current, `/operations/reports/materials-received?${query}`, { signal }),
      api<CustodyReport>(current, `/operations/reports/custody-monthly?${query}`, { signal }),
    ]);
    return { materials, custody };
  };
  return <BaseerCompanyReadQuery session={session} resource="operations.reports.purchase-custody" scope={[period.from, period.to]} load={load}>{({ data, loading, error, refetch }) => <section className="daily-sales-workspace" dir={ar ? "rtl" : "ltr"}><header className="administration-section-heading"><div><p className="eyebrow">Operations</p><h3>{t.title}</h3><p>{t.description}</p></div><BaseerButton type="button" variant="secondary" disabled={loading} onClick={refetch}>{t.refresh}</BaseerButton></header><BaseerFilterBar language={language} controls={<BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={["MONTH", "QUARTER", "YEAR", "RANGE"]} allowNonContiguousMonths={false} />} />{error ? <p className="daily-sales-message error">{presentBaseerApiError(error, language, t.failed)}</p> : null}<BaseerCard><h3>{t.materials}</h3>{data ? <><div className="baseer-card-grid"><BaseerCard><strong>{t.materialCount}</strong><p>{data.materials.totals.materialCount}</p></BaseerCard><BaseerCard><strong>{t.totalQuantity}</strong><p>{data.materials.totals.quantity}</p></BaseerCard><BaseerCard><strong>{t.totalAmount}</strong><p>{data.materials.totals.amount}</p></BaseerCard></div>{data.materials.materials.length ? <DataTable ariaLabel={t.materials} caption={t.materials} rows={data.materials.materials} rowKey={(row) => `${row.rawMaterialItemId}-${row.unitId}`} columns={materialColumns} /> : <p>{t.noData}</p>}</> : loading ? <p>{ar ? "جارٍ التحميل…" : "Loading…"}</p> : null}</BaseerCard><BaseerCard><h3>{t.custody}</h3><p>{t.representative}: <strong>{data?.custody.representativeName ?? "—"}</strong></p>{data?.custody.months.length ? <DataTable ariaLabel={t.custody} caption={t.custody} rows={data.custody.months} rowKey={(row) => row.month} columns={custodyColumns} /> : data ? <p>{t.noData}</p> : null}</BaseerCard></section>}</BaseerCompanyReadQuery>;
}
