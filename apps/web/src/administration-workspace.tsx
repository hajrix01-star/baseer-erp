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
import { administrationText } from "./administration-copy";

export function AdministrationWorkspace({ language, section }: { language: "ar" | "en"; section: number }) {
  const text = administrationText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [overview, setOverview] = useState<AdministrationOverview | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    setOverview(await loadAdministrationOverview(current));
  }, []);
  const reportError = (error: unknown) => setMessage(presentBaseerApiError(error, language, text.administrationCommandFailed));

  useEffect(() => {
    void load().catch((error) => setMessage(presentBaseerApiError(error, language, text.noAdministrationAccess)));
  }, [language, load]);

  if (!session) return <DailySalesSignIn language={language} />;
  if (!overview) return <section className="administration-shell"><p className={message ? "daily-sales-message error" : "administration-loading"}>{message || (text.loadingAdministration)}</p></section>;

  const shared = { session, owner: overview.owner, onDone: load, onError: reportError };
  return <section className="administration-shell">
    <header className="administration-heading">
      <div><p className="eyebrow">Baseer ERP / Administration</p><h2>{text.companiesAndAccess}</h2></div>

    </header>
    {message && <p className="daily-sales-message error">{message}</p>}
    {!overview.owner && <p className="daily-sales-message error">{text.ownerOnly}</p>}
    {section === 1 ? <AdministrationCompaniesPanel {...shared} companies={overview.companies} language={language} /> : section === 2 ? <AdministrationUsersPanel {...shared} overview={overview} language={language} /> : section === 3 ? <AdministrationRolesPanel {...shared} overview={overview} language={language} /> : <AdministrationOverviewPanel overview={overview} session={session} language={language} />}
  </section>;
}
