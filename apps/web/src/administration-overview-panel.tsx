import { BaseerOutputActions } from "./baseer-output-actions";
import { administrationText } from "./administration-copy";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";

export function AdministrationOverviewPanel({ overview, session, language }: { overview: AdministrationOverview; session: ActiveSession; language: "ar" | "en" }) {
  const text = administrationText(language);
  return <div className="administration-grid">
    <article><span>{text.activeCompanies}</span><strong>{overview.companies.filter((company) => company.status === "ACTIVE").length}</strong></article>
    <article><span>{text.activeUsers}</span><strong>{overview.users.filter((user) => user.status === "ACTIVE").length}</strong></article>
    <article><span>{text.roles}</span><strong>{overview.roles.length}</strong></article>
    <article><span>{text.approvedPermissions}</span><strong>{overview.permissions.length}</strong></article>
    <section className="administration-wide"><h3>{text.administrationRules}</h3></section>
    <section className="administration-wide"><h3>{text.printExport}</h3><BaseerOutputActions session={session} language={language} reportCode="platform.company-context" /></section>
  </div>;
}
