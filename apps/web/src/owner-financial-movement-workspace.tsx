import { useEffect, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerEmptyState, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, activeSessionChangedEvent, api, type ActiveSession } from "./daily-sales-client";
import { formatDate, formatPercent } from "./number-format";
import "./owner-financial-movement-workspace.css";

type Language = "ar" | "en";
type MovementCode = "SALES" | "PURCHASES" | "EXPENSES" | "RECURRING_EXPENSES" | "PAYROLL" | "EMPLOYEE_ADVANCES" | "FINAL_SETTLEMENTS" | "VAT" | "OTHER_INFLOWS" | "OTHER_OUTFLOWS" | "TOTAL";

type OwnerFinancialMovementReceipt = Readonly<{
  generatedAt: string;
  timezone: "Asia/Riyadh";
  period: Readonly<{ fromBusinessDate: string; toBusinessDate: string }>;
  financialContract: Readonly<{
    amountBasis: "GROSS_VAT_INCLUSIVE_CASH_MOVEMENT";
    dataAuthority: "BACKEND_SEALED_JOURNAL_VAULT_LINES";
    dataQuality: "SEALED_POSTED_OR_REVERSED_ONLY";
  }>;
  companies: readonly Readonly<{
    companyId: string;
    nameAr: string;
    nameEn: string;
    currencyCode: string | null;
    rows: readonly Readonly<{
      code: MovementCode;
      amountDisplay: string;
      direction: "INFLOW" | "OUTFLOW" | "NEUTRAL";
      percentOfSalesDisplay: string | null;
    }>[];
  }>[];
}>;

const rowOrder: readonly MovementCode[] = ["SALES", "PURCHASES", "EXPENSES", "RECURRING_EXPENSES", "PAYROLL", "EMPLOYEE_ADVANCES", "FINAL_SETTLEMENTS", "VAT", "OTHER_INFLOWS", "OTHER_OUTFLOWS", "TOTAL"];

const rowLabels: Record<MovementCode, { ar: string; en: string }> = {
  SALES: { ar: "المبيعات", en: "Sales" },
  PURCHASES: { ar: "المشتريات", en: "Purchases" },
  EXPENSES: { ar: "المصروفات", en: "Expenses" },
  RECURRING_EXPENSES: { ar: "المصروفات الدورية", en: "Recurring expenses" },
  PAYROLL: { ar: "الرواتب والأجور المدفوعة", en: "Paid salaries & wages" },
  EMPLOYEE_ADVANCES: { ar: "سلف الموظفين", en: "Employee advances" },
  FINAL_SETTLEMENTS: { ar: "مستحقات نهاية الخدمة المدفوعة", en: "Paid final settlements" },
  VAT: { ar: "الضريبة", en: "VAT" },
  OTHER_INFLOWS: { ar: "حركات داخلة أخرى", en: "Other inflows" },
  OTHER_OUTFLOWS: { ar: "حركات خارجة أخرى", en: "Other outflows" },
  TOTAL: { ar: "المجموع", en: "Total" },
};

export function OwnerFinancialMovementWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [receipt, setReceipt] = useState<OwnerFinancialMovementReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const hasLoaded = useRef(false);
  const receiptRef = useRef<OwnerFinancialMovementReceipt | null>(null);
  receiptRef.current = receipt;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let disposed = false;
    let inFlight = false;

    const schedule = () => {
      if (!disposed && !controller.signal.aborted) timer = window.setTimeout(() => { void refresh(); }, 15_000);
    };
    const refresh = async () => {
      if (disposed || controller.signal.aborted || inFlight) return;
      inFlight = true;
      const session = activeSession();
      const hasReceipt = receiptRef.current !== null;
      if (!session) {
        if (!hasReceipt) setError(ar ? "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة." : "Your session has ended. Sign in and try again.");
        setLoading(false);
        inFlight = false;
        return;
      }
      if (!hasLoaded.current && !hasReceipt) setLoading(true);
      if (hasReceipt) setRefreshing(true);
      try {
        const next = await api<OwnerFinancialMovementReceipt>(session, "/owner/dashboard/financial-movement", { signal: controller.signal });
        if (controller.signal.aborted || disposed || !sameSession(activeSession(), session)) return;
        setReceipt(next);
        setError("");
        setRefreshWarning("");
      } catch (reason) {
        if (!controller.signal.aborted && !disposed) {
          const message = presentBaseerApiError(reason, language, ar ? "تعذر تحديث الحركة المالية للشركات." : "Could not refresh the companies’ financial movement.");
          if (hasReceipt) setRefreshWarning(message); else setError(message);
        }
      } finally {
        if (!disposed && !controller.signal.aborted) {
          hasLoaded.current = true;
          setLoading(false);
          setRefreshing(false);
          inFlight = false;
          schedule();
        }
      }
    };

    void refresh();
    return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); controller.abort(); };
  }, [ar, language, refreshRevision]);

  useEffect(() => {
    const refreshForSession = () => setRefreshRevision((current) => current + 1);
    window.addEventListener(activeSessionChangedEvent, refreshForSession);
    return () => window.removeEventListener(activeSessionChangedEvent, refreshForSession);
  }, []);

  if (loading && !receipt) return <BaseerWorkspace className="owner-financial-movement"><p className="owner-financial-movement__state" dir={ar ? "rtl" : "ltr"}>{ar ? "جارٍ تحميل الحركة المالية…" : "Loading financial movement…"}</p></BaseerWorkspace>;
  if (!receipt) return <BaseerWorkspace className="owner-financial-movement"><div dir={ar ? "rtl" : "ltr"}><BaseerCard className="owner-financial-movement__failure"><strong>{error || (ar ? "لا تتوفر حركة مالية." : "No financial movement is available.")}</strong><BaseerButton type="button" onClick={() => setRefreshRevision((current) => current + 1)}>{ar ? "إعادة المحاولة" : "Try again"}</BaseerButton></BaseerCard></div></BaseerWorkspace>;

  const period = `${formatDate(receipt.period.fromBusinessDate, language)} — ${formatDate(receipt.period.toBusinessDate, language)}`;
  return <BaseerWorkspace className="owner-financial-movement"><div dir={ar ? "rtl" : "ltr"}>
    <BaseerSectionHeader
      eyebrow={ar ? "لوحة المالك · كل الشركات" : "Owner dashboard · all companies"}
      title={ar ? "الحركة المالية حسب البند" : "Financial movement by category"}
      description={ar ? `من بداية الشهر حتى ${formatDate(receipt.period.toBusinessDate, language)}. الأرقام إجمالية شاملة الضريبة ومن القيود المختومة في الخادم.` : `Month to date through ${formatDate(receipt.period.toBusinessDate, language)}. Gross VAT-inclusive figures come from sealed server-side entries.`}
      actions={<div className="owner-financial-movement__status"><span className="owner-financial-movement__period" dir="ltr">{period}</span>{refreshing ? <span aria-live="polite">{ar ? "جارٍ التحديث…" : "Refreshing…"}</span> : refreshWarning ? <span className="owner-financial-movement__warning" role="status">{refreshWarning}</span> : null}</div>}
    />
    {receipt.companies.length ? <div className="owner-financial-movement__grid">{receipt.companies.map((company) => <CompanyMovementCard key={company.companyId} company={company} language={language} />)}</div> : <BaseerEmptyState title={ar ? "لا توجد شركات نشطة" : "No active companies"} description={ar ? "ستظهر الشركات النشطة هنا تلقائيًا." : "Active companies appear here automatically."} />}
  </div></BaseerWorkspace>;
}

function sameSession(current: ActiveSession | null, expected: ActiveSession) {
  return current?.accessToken === expected.accessToken && current.companyId === expected.companyId && current.sessionExpiresAt === expected.sessionExpiresAt;
}

function CompanyMovementCard({ company, language }: { company: OwnerFinancialMovementReceipt["companies"][number]; language: Language }) {
  const ar = language === "ar";
  const rows = new Map(company.rows.map((row) => [row.code, row]));
  return <BaseerCard className="owner-financial-movement__company" padding="compact">
    <header><div><span>{ar ? company.nameAr : company.nameEn}</span><small>{ar ? "شامل الضريبة" : "VAT inclusive"}</small></div><bdi>{company.currencyCode ?? "—"}</bdi></header>
    <dl>{rowOrder.map((code) => {
      const row = rows.get(code);
      const className = ["owner-financial-movement__row", code === "SALES" ? "is-sales" : "", code === "TOTAL" ? "is-total" : "", row?.direction === "OUTFLOW" ? "is-outflow" : "", row?.direction === "INFLOW" && code !== "SALES" && code !== "TOTAL" ? "is-inflow" : ""].filter(Boolean).join(" ");
      return <div key={code} className={className}>
        <dt>{rowLabels[code][language]}</dt>
        <dd><bdi dir="ltr">{row?.amountDisplay ?? "—"}</bdi>{row?.percentOfSalesDisplay !== null && row?.percentOfSalesDisplay !== undefined ? <small dir="ltr">{formatPercent(row.percentOfSalesDisplay, language)}</small> : null}</dd>
      </div>;
    })}</dl>
  </BaseerCard>;
}
