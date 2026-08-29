import { lazy, Suspense, useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { formatCount, formatMoney } from "./number-format";

type Language = "ar" | "en";
type OperationsExecutionWorkspaceSummary = {
  inventoryMaterialCount: number;
  openRequestCount: number;
  custody: { representativeName: string | null; balance: string };
};

const OperationsExecutionWorkspaceRuntime = lazy(async () => ({ default: (await import("./operations-execution-workspace-runtime")).OperationsExecutionWorkspaceRuntime }));

/** A truthful operational summary is available immediately; forms and tables load only on an explicit management action. */
export function OperationsExecutionWorkspaceContent({ language }: { language: Language }) {
  const ar = language === "ar";
  const t = ar
    ? { title: "طلبات الشراء والعهدة", description: "ملخص آمن للعمليات الحالية. افتح الإدارة لإنشاء الطلبات أو اعتماد الشراء الفعلي أو تسجيل المرتجعات.", loading: "جارٍ تحميل ملخص العمليات…", failed: "تعذر تحميل ملخص العمليات.", manage: "فتح إدارة طلبات الشراء والعهدة", pending: "طلبات مفتوحة", custody: "رصيد عهدة المندوب", inventory: "مواد بالمخزون", noRepresentative: "لا يوجد مندوب عهدة محدد" }
    : { title: "Purchase requests & custody", description: "A safe summary of current operations. Open management to create requests, confirm actual purchases, or record returns.", loading: "Loading operations summary…", failed: "Could not load the operations summary.", manage: "Open purchase requests & custody management", pending: "Open requests", custody: "Representative custody", inventory: "Inventory materials", noRepresentative: "No custody representative is configured" };
  const [session, setSession] = useState<ActiveSession | null>(() => activeSession());
  const [overview, setOverview] = useState<OperationsExecutionWorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);

  useEffect(() => {
    const current = activeSession();
    setSession(current);
    if (!current) { setLoading(false); return; }
    const controller = new AbortController();
    let active = true;
    void api<OperationsExecutionWorkspaceSummary>(current, "/operations/execution-workspace/summary", { signal: controller.signal })
      .then((value) => { if (active) setOverview(value); })
      .catch((cause) => { if (active) setError(presentBaseerApiError(cause, language, t.failed)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [language]);

  if (!session) return <DailySalesSignIn language={language} />;
  if (managementOpen) return <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل الإدارة…" : "Loading management…"}</BaseerCard>}><OperationsExecutionWorkspaceRuntime language={language} /></Suspense>;

  return <section className="daily-sales-workspace">
    <header className="administration-section-heading"><div><p className="eyebrow">Operations O2 · O3</p><h3>{t.title}</h3><p>{t.description}</p></div><BaseerButton type="button" onClick={() => setManagementOpen(true)}>{t.manage}</BaseerButton></header>
    {loading ? <BaseerCard aria-busy="true" role="status"><p>{t.loading}</p></BaseerCard> : error ? <BaseerCard><p className="daily-sales-message error" role="alert">{error}</p></BaseerCard> : <div className="baseer-card-grid"><BaseerCard><strong>{t.pending}</strong><p dir="ltr">{formatCount(overview?.openRequestCount ?? 0, language)}</p></BaseerCard><BaseerCard><strong>{t.custody}</strong><p>{overview?.custody.representativeName ?? t.noRepresentative}</p><p dir="ltr">{formatMoney(overview?.custody.balance, "SAR", language)}</p></BaseerCard><BaseerCard><strong>{t.inventory}</strong><p dir="ltr">{formatCount(overview?.inventoryMaterialCount ?? 0, language)}</p></BaseerCard></div>}
  </section>;
}
