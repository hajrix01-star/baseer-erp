import { lazy, Suspense, useEffect, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";

type Language = "ar" | "en";
type FinanceSetupView = "setup" | "suppliers";
type FinanceReadiness = Readonly<{ profile: unknown | null; openPeriod: { nameAr: string; nameEn: string; startDate: string; endDate: string } | null; counts: { activeVaults: number; activeAccounts: number; activeCategories: number; activeSuppliers: number }; issues: readonly string[] }>;

const FinanceSetupWorkspaceRuntime = lazy(async () => ({
  default: (await import("./finance-setup-workspace-runtime")).FinanceSetupWorkspaceRuntime,
}));

const copy = {
  ar: { eyebrow: "المالية ← الإعدادات", title: "جاهزية المالية", description: "ملخص آمن لحالة التهيئة. افتح الإدارة لإعداد الفترة والحسابات والسيولة والموردين.", open: "فتح إدارة المالية", preparing: "جارٍ تجهيز إدارة المالية…", loading: "جارٍ تحميل حالة الجاهزية…", failed: "تعذر تحميل حالة الجاهزية. افتح الإدارة لإعادة المحاولة.", period: "الفترة المفتوحة", noPeriod: "لا توجد فترة مالية مفتوحة.", vaults: "الخزائن النشطة", accounts: "الحسابات النشطة", categories: "فئات الترحيل", suppliers: "الموردون النشطون", issues: "نقاط تحتاج متابعة" },
  en: { eyebrow: "Finance → Setup", title: "Finance readiness", description: "A safe readiness summary. Open management to configure periods, accounts, liquidity, and suppliers.", open: "Open finance management", preparing: "Preparing finance management…", loading: "Loading readiness…", failed: "Readiness could not be loaded. Open management to retry.", period: "Open period", noPeriod: "There is no open fiscal period.", vaults: "Active vaults", accounts: "Active accounts", categories: "Posting categories", suppliers: "Active suppliers", issues: "Items needing attention" },
} as const;

/** The readiness read is sufficient for first paint; mutating setup workflows load on explicit entry. */
export function FinanceSetupWorkspaceContent({ language, view = "setup" }: { language: Language; view?: FinanceSetupView }) {
  const text = copy[language];
  const [session] = useState<ActiveSession | null>(activeSession);
  const [openRuntime, setOpenRuntime] = useState(false);
  const [readiness, setReadiness] = useState<FinanceReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!session) return;
    let disposed = false;
    void api<FinanceReadiness>(session, "/finance/configuration/readiness").then((next) => { if (!disposed) setReadiness(next); }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [session]);
  if (!session) return <DailySalesSignIn language={language} />;
  if (openRuntime) return <Suspense fallback={<BaseerCard>{text.preparing}</BaseerCard>}><FinanceSetupWorkspaceRuntime language={language} view={view} /></Suspense>;
  return <section className="finance-setup-workspace">
    <BaseerCard>
      <div className="baseer-workspace__heading"><div><p className="overline">{text.eyebrow}</p><h2>{text.title}</h2><p>{text.description}</p></div><div className="baseer-workspace__actions"><BaseerButton type="button" onClick={() => setOpenRuntime(true)}>{text.open}</BaseerButton></div></div>
      {failed ? <p className="daily-sales-message error" role="alert">{text.failed}</p> : readiness === null ? <p>{text.loading}</p> : <><p><strong>{text.period}: </strong>{readiness.openPeriod ? `${language === "ar" ? readiness.openPeriod.nameAr : readiness.openPeriod.nameEn} · ${readiness.openPeriod.startDate} — ${readiness.openPeriod.endDate}` : text.noPeriod}</p><div className="baseer-card-grid"><BaseerCard><small>{text.vaults}</small><strong>{readiness.counts.activeVaults}</strong></BaseerCard><BaseerCard><small>{text.accounts}</small><strong>{readiness.counts.activeAccounts}</strong></BaseerCard><BaseerCard><small>{text.categories}</small><strong>{readiness.counts.activeCategories}</strong></BaseerCard><BaseerCard><small>{text.suppliers}</small><strong>{readiness.counts.activeSuppliers}</strong></BaseerCard></div>{readiness.issues.length ? <p><strong>{text.issues}: </strong>{readiness.issues.length}</p> : null}</>}
    </BaseerCard>
  </section>;
}
