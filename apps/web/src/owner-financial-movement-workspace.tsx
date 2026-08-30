import { useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerEmptyState, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, api } from "./daily-sales-client";
import { formatDate } from "./number-format";
import "./owner-financial-movement-workspace.css";

type Language = "ar" | "en";
type MovementCode = "SALES" | "PURCHASES" | "EXPENSES" | "RECURRING_EXPENSES" | "EMPLOYEE_PAYMENTS" | "VAT" | "TOTAL";

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

const rowOrder: readonly MovementCode[] = ["SALES", "PURCHASES", "EXPENSES", "RECURRING_EXPENSES", "EMPLOYEE_PAYMENTS", "VAT", "TOTAL"];

const rowLabels: Record<MovementCode, { ar: string; en: string }> = {
  SALES: { ar: "المبيعات", en: "Sales" },
  PURCHASES: { ar: "المشتريات", en: "Purchases" },
  EXPENSES: { ar: "المصروفات", en: "Expenses" },
  RECURRING_EXPENSES: { ar: "المصروفات الدورية", en: "Recurring expenses" },
  EMPLOYEE_PAYMENTS: { ar: "رواتب وسلف الموظفين", en: "Payroll & employee advances" },
  VAT: { ar: "الضريبة", en: "VAT" },
  TOTAL: { ar: "المجموع", en: "Total" },
};

export function OwnerFinancialMovementWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [receipt, setReceipt] = useState<OwnerFinancialMovementReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    const session = activeSession();
    if (!session) {
      setError(ar ? "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة." : "Your session has ended. Sign in and try again.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setReceipt(await api<OwnerFinancialMovementReceipt>(session, "/owner/dashboard/financial-movement"));
    } catch (reason) {
      setError(presentBaseerApiError(reason, language, ar ? "تعذر تحميل الحركة المالية للشركات." : "Could not load the companies’ financial movement."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [language]);

  if (loading) return <BaseerWorkspace className="owner-financial-movement"><p className="owner-financial-movement__state" dir={ar ? "rtl" : "ltr"}>{ar ? "جارٍ تحميل الحركة المالية…" : "Loading financial movement…"}</p></BaseerWorkspace>;
  if (error || !receipt) return <BaseerWorkspace className="owner-financial-movement"><div dir={ar ? "rtl" : "ltr"}><BaseerCard className="owner-financial-movement__failure"><strong>{error || (ar ? "لا تتوفر حركة مالية." : "No financial movement is available.")}</strong><BaseerButton type="button" onClick={() => void load()}>{ar ? "إعادة المحاولة" : "Try again"}</BaseerButton></BaseerCard></div></BaseerWorkspace>;

  const period = `${formatDate(receipt.period.fromBusinessDate, language)} — ${formatDate(receipt.period.toBusinessDate, language)}`;
  return <BaseerWorkspace className="owner-financial-movement"><div dir={ar ? "rtl" : "ltr"}>
    <BaseerSectionHeader
      eyebrow={ar ? "لوحة المالك · كل الشركات" : "Owner dashboard · all companies"}
      title={ar ? "الحركة المالية حسب البند" : "Financial movement by category"}
      description={ar ? `من بداية الشهر حتى ${formatDate(receipt.period.toBusinessDate, language)}. الأرقام إجمالية شاملة الضريبة ومن القيود المختومة في الخادم.` : `Month to date through ${formatDate(receipt.period.toBusinessDate, language)}. Gross VAT-inclusive figures come from sealed server-side entries.`}
      actions={<span className="owner-financial-movement__period" dir="ltr">{period}</span>}
    />
    {receipt.companies.length ? <div className="owner-financial-movement__grid">{receipt.companies.map((company) => <CompanyMovementCard key={company.companyId} company={company} language={language} />)}</div> : <BaseerEmptyState title={ar ? "لا توجد شركات نشطة" : "No active companies"} description={ar ? "ستظهر الشركات النشطة هنا تلقائيًا." : "Active companies appear here automatically."} />}
  </div></BaseerWorkspace>;
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
        <dd><bdi dir="ltr">{row?.amountDisplay ?? "—"}</bdi>{row?.percentOfSalesDisplay !== null && row?.percentOfSalesDisplay !== undefined ? <small dir="ltr">{row.percentOfSalesDisplay}</small> : null}</dd>
      </div>;
    })}</dl>
  </BaseerCard>;
}
