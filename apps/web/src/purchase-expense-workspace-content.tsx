import { lazy, Suspense, useEffect, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import type { BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { hasActivePermission } from "./module-access";
import { formatMoney } from "./number-format";

type Language = "ar" | "en";
type PurchaseWorkspaceTab = "entry" | "history" | "credit";
type DocumentPreview = Readonly<{ id: string; documentNumber: string; businessDate: string; grossAmount: string; status: "POSTED" | "CANCELLED"; kind: "PURCHASE" | "EXPENSE"; supplierNameAr: string | null; supplierNameEn: string | null }>;

const PurchaseExpenseWorkspaceRuntime = lazy(async () => ({
  default: (await import("./purchase-expense-workspace-runtime")).PurchaseExpenseWorkspaceRuntime,
}));

const copy = {
  ar: {
    eyebrow: "المالية ← المشتريات",
    title: "المشتريات والمصروفات",
    description: "آخر المستندات المثبتة في الشركة الحالية. افتح الإدارة الكاملة للإدخال والائتمان والتعديل والعكس.",
    open: "إدارة المشتريات",
    preparing: "جارٍ تجهيز إدارة المشتريات…",
    loading: "جارٍ تحميل آخر المستندات…",
    noDocuments: "لا توجد مستندات مشتريات أو مصروفات بعد.",
    failed: "تعذر تحميل آخر المستندات. افتح الإدارة الكاملة لإعادة المحاولة.",
    unavailable: "لا تملك صلاحية قراءة مستندات المشتريات. تظل مساحة الإدارة الكاملة محمية بالصلاحيات الخادمية.",
    document: "المستند",
    amount: "المبلغ",
    date: "التاريخ",
  },
  en: {
    eyebrow: "Finance → Purchases",
    title: "Purchases and expenses",
    description: "The latest posted documents in the current company. Open full management for entry, credit, amendment, and reversal.",
    open: "Manage purchases",
    preparing: "Preparing purchase management…",
    loading: "Loading recent documents…",
    noDocuments: "There are no purchase or expense documents yet.",
    failed: "Recent documents could not be loaded. Open full management to retry.",
    unavailable: "You do not have permission to read purchase documents. The full management workspace remains protected by server-side permissions.",
    document: "Document",
    amount: "Amount",
    date: "Date",
  },
} as const;

/** Purchasing is an operational destination: opening it must enter the managed workspace directly. */
export function PurchaseExpenseWorkspaceContent({ language, activeTab = "entry", onTabChange }: { language: Language; activeTab?: PurchaseWorkspaceTab; onTabChange?: (tab: PurchaseWorkspaceTab) => void }) {
  const text = copy[language];
  const [session] = useState<ActiveSession | null>(activeSession);
  const [openRuntime, setOpenRuntime] = useState(true);
  const [documents, setDocuments] = useState<readonly DocumentPreview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const canRead = hasActivePermission("finance.purchase_expense.read");
  const documentColumns: readonly BaseerDataGridColumn<DocumentPreview>[] = [
    { id: "document", header: text.document, width: "48%", cell: (document) => <span className="baseer-data-table__stack"><strong dir="ltr">{document.documentNumber}</strong><small>{document.kind} · {document.status}</small></span> },
    { id: "date", header: text.date, width: "24%", align: "end", className: "baseer-data-table__numeric", cell: (document) => <span dir="ltr">{document.businessDate.slice(0, 10)}</span> },
    { id: "amount", header: text.amount, width: "28%", align: "end", numeric: true, cell: (document) => <span dir="ltr">{formatMoney(document.grossAmount, "SAR", language)}</span> },
  ];

  useEffect(() => {
    if (activeTab !== "entry") setOpenRuntime(true);
  }, [activeTab]);

  useEffect(() => {
    if (!session || !canRead) return;
    let disposed = false;
    void api<{ documents: DocumentPreview[] }>(session, "/finance/purchase-expense-documents").then((receipt) => {
      if (!disposed) setDocuments(receipt.documents.slice(0, 8));
    }).catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => { disposed = true; };
  }, [canRead, session]);

  if (!session) return <DailySalesSignIn language={language} />;
  if (openRuntime) return <Suspense fallback={<BaseerCard>{text.preparing}</BaseerCard>}><PurchaseExpenseWorkspaceRuntime language={language} activeTab={activeTab} onTabChange={onTabChange} /></Suspense>;
  return <section className="purchase-expense-workspace">
    <BaseerCard>
      <div className="baseer-workspace__heading">
        <div><p className="overline">{text.eyebrow}</p><h2>{text.title}</h2><p>{text.description}</p></div>
        <div className="baseer-workspace__actions"><BaseerButton type="button" onClick={() => setOpenRuntime(true)}>{text.open}</BaseerButton></div>
      </div>
      {!canRead ? <p>{text.unavailable}</p> : failed ? <p className="daily-sales-message error" role="alert">{text.failed}</p> : documents === null ? <p>{text.loading}</p> : documents.length ? <BaseerDataGrid ariaLabel={language === "ar" ? "آخر مستندات المشتريات والمصروفات" : "Recent purchase and expense documents"} caption={language === "ar" ? "آخر مستندات المشتريات والمصروفات" : "Recent purchase and expense documents"} columns={documentColumns} rows={documents} rowKey={(document) => document.id} /> : <p>{text.noDocuments}</p>}
    </BaseerCard>
  </section>;
}
