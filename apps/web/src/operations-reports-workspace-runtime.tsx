import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerDataGrid, type BaseerDataGridColumn, type BaseerServerDataGridProps } from "./baseer-data-grid";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { hasActivePermission } from "./module-access";
import { formatCount, formatMoney, formatQuantity } from "./number-format";
import { OperationsInternalRegistrationReport } from "./operations-internal-registration-report";

type Language = "ar" | "en";
type MaterialRow = {
  rawMaterialItemId: string;
  materialNameAr: string;
  materialNameEn: string | null;
  unitId: string;
  unitNameAr: string;
  unitNameEn: string | null;
  quantity: string;
  amount: string;
  weightedActualUnitPrice: string;
};
type MaterialsReport = {
  totals: { materialCount: number; quantity: string; amount: string };
  materials: MaterialRow[];
  nextCursor: string | null;
  asOf: string;
};
type CustodyMonth = {
  month: string;
  openingBalance: string;
  funding: string;
  purchases: string;
  returns: string;
  reversals: string;
  closingBalance: string;
};
type CustodyReport = { representativeName: string | null; months: CustodyMonth[] };
type ReportsData = { materials: MaterialsReport; custody: CustodyReport };
type ReportsTab = "inventory-materials" | "internal-registration";

type Copy = {
  title: string;
  refresh: string;
  materials: string;
  material: string;
  unit: string;
  quantity: string;
  amount: string;
  average: string;
  materialCount: string;
  totalQuantity: string;
  totalAmount: string;
  custody: string;
  representative: string;
  month: string;
  opening: string;
  funding: string;
  purchases: string;
  returns: string;
  reversals: string;
  closing: string;
  failed: string;
  noData: string;
  loading: string;
  loadMore: string;
  loadingMore: string;
  inventoryMaterials: string;
  internalRegistration: string;
  unavailable: string;
};

const copy: Record<Language, Copy> = {
  ar: {
    title: "تقارير المشتريات والعهدة",
    refresh: "تحديث",
    materials: "المواد المستلمة",
    material: "المادة",
    unit: "الوحدة",
    quantity: "الكمية",
    amount: "القيمة الفعلية",
    average: "متوسط السعر الفعلي",
    materialCount: "عدد المواد",
    totalQuantity: "إجمالي الكمية",
    totalAmount: "إجمالي القيمة",
    custody: "كشف عهدة المندوب الشهري",
    representative: "المندوب",
    month: "الشهر",
    opening: "الرصيد الافتتاحي",
    funding: "العهدة المسلّمة",
    purchases: "المشتريات الفعلية",
    returns: "المرتجع",
    reversals: "تصحيحات",
    closing: "الرصيد الختامي",
    failed: "تعذر تحميل التقرير.",
    noData: "لا توجد حركات ضمن الفترة.",
    loading: "جارٍ التحميل…",
    loadMore: "تحميل المزيد",
    loadingMore: "جارٍ تحميل المزيد…",
    inventoryMaterials: "تقارير المخزون والمواد",
    internalRegistration: "تقرير التسجيل الداخلي",
    unavailable: "غير متاح ضمن صلاحياتك.",
  },
  en: {
    title: "Purchasing & custody reports",
    refresh: "Refresh",
    materials: "Received materials",
    material: "Material",
    unit: "Unit",
    quantity: "Quantity",
    amount: "Actual value",
    average: "Actual unit average",
    materialCount: "Materials",
    totalQuantity: "Total quantity",
    totalAmount: "Total value",
    custody: "Monthly representative custody",
    representative: "Representative",
    month: "Month",
    opening: "Opening balance",
    funding: "Funding",
    purchases: "Actual purchases",
    returns: "Returns",
    reversals: "Corrections",
    closing: "Closing balance",
    failed: "Could not load the report.",
    noData: "No movements in this period.",
    loading: "Loading…",
    loadMore: "Load more",
    loadingMore: "Loading more…",
    inventoryMaterials: "Inventory & materials reports",
    internalRegistration: "Internal registration report",
    unavailable: "Unavailable with your permissions.",
  },
};

const LazyBaseerServerDataGrid = lazy(async () => {
  const module = await import("./baseer-data-grid");
  return { default: module.BaseerServerDataGrid };
}) as unknown as <Row extends object>(props: BaseerServerDataGridProps<Row>) => ReactNode;

function MaterialsReportGrid({ session, language, period, report, columns }: {
  session: ActiveSession;
  language: Language;
  period: BaseerPeriodRange;
  report: MaterialsReport;
  columns: readonly BaseerDataGridColumn<MaterialRow>[];
}) {
  const t = copy[language];
  const [rows, setRows] = useState<MaterialRow[]>(report.materials);
  const [nextCursor, setNextCursor] = useState<string | null>(report.nextCursor);
  const [asOf, setAsOf] = useState(report.asOf);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    request.current?.abort();
    setRows(report.materials);
    setNextCursor(report.nextCursor);
    setAsOf(report.asOf);
    setLoadMoreError(null);
  }, [report]);

  useEffect(() => () => request.current?.abort(), []);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const query = new URLSearchParams({ from: period.from, to: period.to, pageSize: "50", cursor: nextCursor });
      const page = await api<MaterialsReport>(session, `/operations/reports/materials-received?${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setRows((current) => {
        const existing = new Set(current.map((row) => `${row.rawMaterialItemId}:${row.unitId}`));
        return [...current, ...page.materials.filter((row) => !existing.has(`${row.rawMaterialItemId}:${row.unitId}`))];
      });
      setNextCursor(page.nextCursor);
      setAsOf(page.asOf);
    } catch (error) {
      if (!controller.signal.aborted) setLoadMoreError(error);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  };

  return <>
    {rows.length ? <Suspense fallback={<p>{t.loading}</p>}><LazyBaseerServerDataGrid
      ariaLabel={t.materials}
      caption={t.materials}
      page={{ rows, nextCursor, asOf }}
      rowKey={(row: MaterialRow) => `${row.rawMaterialItemId}-${row.unitId}`}
      columns={columns}
      loadMoreControl={<BaseerButton type="button" variant="secondary" disabled={loadingMore} onClick={() => { void loadMore(); }}>
        {loadingMore ? t.loadingMore : t.loadMore}
      </BaseerButton>}
    /></Suspense> : <p>{t.noData}</p>}
    {loadMoreError ? <p className="daily-sales-message error">{presentBaseerApiError(loadMoreError, language, t.failed)}</p> : null}
  </>;
}

/** Read-only reports are cached only inside their live company/session/period boundary. */
export function OperationsReportsWorkspaceRuntime({ language }: { language: Language }) {
  const ar = language === "ar";
  const t = copy[language];
  const [session] = useState<ActiveSession | null>(activeSession());
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange());
  const canReadInternalRegistration = hasActivePermission("operations.internal_registration.read");
  const [tab, setTab] = useState<ReportsTab>("inventory-materials");
  if (!session) return <DailySalesSignIn language={language} />;

  const materialColumns: readonly BaseerDataGridColumn<MaterialRow>[] = [
    { id: "material", header: t.material, cell: (row) => ar ? row.materialNameAr : row.materialNameEn ?? row.materialNameAr },
    { id: "unit", header: t.unit, cell: (row) => ar ? row.unitNameAr : row.unitNameEn ?? row.unitNameAr },
    { id: "quantity", header: t.quantity, numeric: true, cell: (row) => <bdi dir="ltr">{formatQuantity(row.quantity, 3, language)}</bdi> },
    { id: "average", header: t.average, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.weightedActualUnitPrice, "SAR", language, 4)}</bdi> },
    { id: "amount", header: t.amount, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.amount, "SAR", language)}</bdi> },
  ];
  const custodyColumns: readonly BaseerDataGridColumn<CustodyMonth>[] = [
    { id: "month", header: t.month, cell: (row) => row.month },
    { id: "opening", header: t.opening, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.openingBalance, "SAR", language)}</bdi> },
    { id: "funding", header: t.funding, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.funding, "SAR", language)}</bdi> },
    { id: "purchases", header: t.purchases, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.purchases, "SAR", language)}</bdi> },
    { id: "returns", header: t.returns, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.returns, "SAR", language)}</bdi> },
    { id: "reversals", header: t.reversals, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.reversals, "SAR", language)}</bdi> },
    { id: "closing", header: t.closing, numeric: true, cell: (row) => <bdi dir="ltr">{formatMoney(row.closingBalance, "SAR", language)}</bdi> },
  ];
  const load = async (current: ActiveSession, signal: AbortSignal): Promise<ReportsData> => {
    const query = new URLSearchParams({ from: period.from, to: period.to, pageSize: "50" });
    const [materials, custody] = await Promise.all([
      api<MaterialsReport>(current, `/operations/reports/materials-received?${query}`, { signal }),
      api<CustodyReport>(current, `/operations/reports/custody-monthly?${query}`, { signal }),
    ]);
    return { materials, custody };
  };

  return <BaseerCompanyReadQuery session={session} resource="operations.reports.purchase-custody" scope={[period.from, period.to]} load={load}>
    {({ data, loading, error, refetch }) => <section className="daily-sales-workspace" dir={ar ? "rtl" : "ltr"}>
      <header className="administration-section-heading">
        <div><p className="eyebrow">Operations</p><h3>{t.title}</h3></div>
        <div className="page-actions">
          {tab === "inventory-materials" ? <BaseerOutputActions session={session} reportCode="operations.purchase-custody-reports" language={language} filters={{ from: period.from, to: period.to }} printLabel={ar ? "طباعة A4" : "Print A4"} /> : null}
          <BaseerButton type="button" variant="secondary" disabled={loading} onClick={refetch}>{t.refresh}</BaseerButton>
        </div>
      </header>
      <BaseerWorkspaceTabs ariaLabel={t.title} idPrefix="operations-reports" activeId={tab} onChange={(value) => setTab(value as ReportsTab)} tabs={[{ id: "inventory-materials", label: t.inventoryMaterials }, { id: "internal-registration", label: t.internalRegistration }]} />
      <BaseerBatchPanel id={`operations-reports-panel-${tab}`} labelledBy={`operations-reports-${tab}`}>
      {tab === "inventory-materials" ? <><BaseerFilterBar language={language} controls={<BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={["DAY", "MONTH", "QUARTER", "YEAR", "RANGE"]} allowNonContiguousMonths={false} />} />
      {error ? <p className="daily-sales-message error">{presentBaseerApiError(error, language, t.failed)}</p> : null}
      <BaseerCard>
        <h3>{t.materials}</h3>
        {data ? <>
          <div className="baseer-card-grid">
            <BaseerCard><strong>{t.materialCount}</strong><p><bdi dir="ltr">{formatCount(data.materials.totals.materialCount, language)}</bdi></p></BaseerCard>
            <BaseerCard><strong>{t.totalQuantity}</strong><p><bdi dir="ltr">{formatQuantity(data.materials.totals.quantity, 3, language)}</bdi></p></BaseerCard>
            <BaseerCard><strong>{t.totalAmount}</strong><p><bdi dir="ltr">{formatMoney(data.materials.totals.amount, "SAR", language)}</bdi></p></BaseerCard>
          </div>
          <MaterialsReportGrid session={session} language={language} period={period} report={data.materials} columns={materialColumns} />
        </> : loading ? <p>{t.loading}</p> : null}
      </BaseerCard>
      <BaseerCard>
        <h3>{t.custody}</h3>
        <p>{t.representative}: <strong>{data?.custody.representativeName ?? "—"}</strong></p>
        {data?.custody.months.length ? <BaseerDataGrid ariaLabel={t.custody} caption={t.custody} rows={data.custody.months} rowKey={(row) => row.month} columns={custodyColumns} /> : data ? <p>{t.noData}</p> : null}
      </BaseerCard>
      </> : canReadInternalRegistration ? <OperationsInternalRegistrationReport language={language} session={session} /> : <BaseerCard><p>{t.unavailable}</p></BaseerCard>}
      </BaseerBatchPanel>
    </section>}
  </BaseerCompanyReadQuery>;
}
