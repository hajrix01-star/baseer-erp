import { lazy, Suspense, useState } from "react";

import { loadAdministrationOverview } from "./administration-client";
import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import type { AdministrationOverview } from "./administration-types";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, type ActiveSession } from "./daily-sales-client";
import { administrationText } from "./administration-copy";

// The administration route has four independently used workspaces. Loading
// them only when their section is opened keeps the primary route under the
// release journey budget, particularly for the company and user dialogs.
const AdministrationCompaniesPanel = lazy(async () => ({ default: (await import("./administration-companies-panel")).AdministrationCompaniesPanel }));
const AdministrationRolesPanel = lazy(async () => ({ default: (await import("./administration-roles-panel")).AdministrationRolesPanel }));
const AdministrationUsersPanel = lazy(async () => ({ default: (await import("./administration-users-panel")).AdministrationUsersPanel }));
const AdministrationAiSettingsPanel = lazy(async () => ({ default: (await import("./administration-ai-settings-panel")).AdministrationAiSettingsPanel }));

export function AdministrationWorkspace({ language, section }: { language: "ar" | "en"; section: number }) {
  const [session] = useState<ActiveSession | null>(activeSession);
  if (!session) return <DailySalesSignIn language={language} />;
  return <BaseerCompanyReadQuery session={session} resource="administration.overview" load={loadAdministrationOverview}>
    {({ data, loading, error, refetch }) => <AdministrationContent language={language} section={section} session={session} overview={data} loading={loading} loadError={error} refetch={refetch} />}
  </BaseerCompanyReadQuery>;
}

function AdministrationContent({ language, section, session, overview, loading, loadError, refetch }: { language: "ar" | "en"; section: number; session: ActiveSession; overview: AdministrationOverview | undefined; loading: boolean; loadError: unknown; refetch: () => Promise<void> }) {
  const text = administrationText(language);
  const [message, setMessage] = useState("");
  const reportError = (error: unknown) => setMessage(typeof error === "string" ? error : presentBaseerApiError(error, language, text.administrationCommandFailed));
  const reload = async () => { setMessage(""); await refetch(); };
  if (loading || !overview) {
    const errorMessage = loadError ? presentBaseerApiError(loadError, language, text.noAdministrationAccess) : "";
    return <section className="administration-shell"><p className={errorMessage ? "daily-sales-message error" : "administration-loading"}>{errorMessage || text.loadingAdministration}</p></section>;
  }
  const shared = { session, owner: overview.owner, onDone: reload, onError: reportError };
  const panel = section === 2 ? <AdministrationUsersPanel {...shared} overview={overview} language={language} /> : section === 3 ? <AdministrationRolesPanel {...shared} overview={overview} language={language} /> : section === 4 ? <AdministrationAiSettingsPanel language={language} session={session} owner={overview.owner} /> : <AdministrationCompaniesPanel {...shared} companies={overview.companies} language={language} />;
  return <section className="administration-shell">
    {section !== 4 ? <header className="administration-heading">
      <div><p className="eyebrow">Baseer ERP / Administration</p><h2>{text.companiesAndAccess}</h2></div>
    </header> : null}
    {message && <p className="daily-sales-message error">{message}</p>}
    {/* Basira governance is capability-based. A company manager with the
        dedicated Basira capabilities uses the same screen as the owner. */}
    {!overview.owner && section !== 4 && <p className="daily-sales-message error">{text.ownerOnly}</p>}
    <Suspense fallback={<p className="administration-loading">{text.loadingAdministration}</p>}>{panel}</Suspense>
  </section>;
}
