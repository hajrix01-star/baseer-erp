import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession } from "./daily-sales-client";
import { hasActivePermission } from "./module-access";
import "./operations-internal-registration-shell.css";

const LazyOperationsInternalRegistrationEntry = lazy(async () => ({ default: (await import("./operations-internal-registration-entry")).OperationsInternalRegistrationEntry }));
type Language = "ar" | "en";
/** Staff entry surface only. Financial/audit reporting lives in Operations reports. */
export function OperationsInternalRegistrationWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const t = ar ? { title: "التسجيل الداخلي" } : { title: "Internal registration" };
  const canCreate = hasActivePermission("operations.internal_registration.create");
  const session = activeSession();
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="operations-internal-registration" dir={ar ? "rtl" : "ltr"}>
    <header><div><p className="eyebrow">Operations O4</p></div></header>
    {canCreate ? <Suspense fallback={<BaseerCard><p>{ar ? "جارٍ تجهيز نموذج التسجيل…" : "Preparing registration form…"}</p></BaseerCard>}><LazyOperationsInternalRegistrationEntry language={language} /></Suspense> : null}
  </section>;
}
