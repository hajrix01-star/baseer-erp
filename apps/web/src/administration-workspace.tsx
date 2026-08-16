import { useCallback, useEffect, useState } from "react";

import { loadAdministrationOverview } from "./administration-client";
import { presentBaseerApiError } from "./baseer-api-error";
import { AdministrationCompaniesPanel } from "./administration-companies-panel";
import { AdministrationOverviewPanel } from "./administration-overview-panel";
import { AdministrationRolesPanel } from "./administration-roles-panel";
import type { AdministrationOverview } from "./administration-types";
import { AdministrationUsersPanel } from "./administration-users-panel";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, type ActiveSession } from "./daily-sales-client";

export function AdministrationWorkspace({ language, section }: { language: "ar" | "en"; section: number }) {
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [overview, setOverview] = useState<AdministrationOverview | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    setOverview(await loadAdministrationOverview(current));
  }, []);
  const reportError = (error: unknown) => setMessage(presentBaseerApiError(error, language, language === "ar" ? "تعذر تنفيذ أمر الإدارة." : "Administration command failed."));

  useEffect(() => {
    void load().catch((error) => setMessage(presentBaseerApiError(error, language, language === "ar" ? "لا تملك حالياً صلاحية الإدارة المركزية." : "Tenant administration access is not available.")));
  }, [language, load]);

  if (!session) return <DailySalesSignIn language={language} />;
  if (!overview) return <section className="administration-shell"><p className={message ? "daily-sales-message error" : "administration-loading"}>{message || (language === "ar" ? "جارٍ تحميل الإدارة…" : "Loading administration…")}</p></section>;

  const shared = { session, owner: overview.owner, onDone: load, onError: reportError };
  return <section className="administration-shell">
    <header className="administration-heading">
      <div><p className="eyebrow">Baseer ERP / Administration</p><h2>{language === "ar" ? "إدارة الشركات والوصول" : "Companies and access"}</h2><p>{language === "ar" ? "الصلاحيات تُفحص من الخادم لكل شركة؛ الواجهة لا تمنح وصولاً من تلقاء نفسها." : "The server evaluates access per company; this interface never grants access by itself."}</p></div>
      <button className="daily-sales-secondary" type="button" onClick={() => void load()}>تحديث</button>
    </header>
    {message && <p className="daily-sales-message error">{message}</p>}
    {!overview.owner && <p className="daily-sales-message error">{language === "ar" ? "يمكنك العرض فقط؛ تغييرات الإدارة تحتاج مالك النظام." : "You can view only; changes require the system owner."}</p>}
    {section === 1 ? <AdministrationCompaniesPanel {...shared} companies={overview.companies} /> : section === 2 ? <AdministrationUsersPanel {...shared} overview={overview} /> : section === 3 ? <AdministrationRolesPanel {...shared} overview={overview} /> : <AdministrationOverviewPanel overview={overview} />}
  </section>;
}