import { useEffect, useState } from "react";
import { uiCopy } from "./baseer-ui-copy";
import { displayName } from "./baseer-localization";

import {
  activeSession,
  listAvailableCompanies,
  selectActiveCompany,
  type AvailableCompany,
} from "./daily-sales-client";

import { pageRouteHash } from "./page-registry";

type Language = "ar" | "en";

export function CompanySessionControl({ language }: { language: Language }) {
  const copy = uiCopy(language);
  const [companies, setCompanies] = useState<AvailableCompany[]>([]);
  const [open, setOpen] = useState(false);
  const session = activeSession();
  const activeCompany = companies.find((company) => company.id === session?.companyId);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void listAvailableCompanies(session)
      .then((items) => {
        if (!cancelled) setCompanies(items);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken, session?.companyId]);

  const label = activeCompany ? displayName(language, activeCompany) : copy.signInAndChooseCompany;

  if (!session) {
    return (
      <button
        className="company-selector"
        type="button"
        onClick={() => {
          window.location.hash = pageRouteHash("operations-sales");
        }}
      >
        <span className="status-dot" />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <div className="company-session-control">
      <button
        className="company-selector"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="status-dot" />
        <span>{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="company-session-control__menu" role="menu">
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              role="menuitem"
              className={company.id === session.companyId ? "is-active" : ""}
              onClick={() => {
                if (company.id === session.companyId) {
                  setOpen(false);
                  return;
                }
                selectActiveCompany(company.id);
                window.location.reload();
              }}
            >
              {company.id === session.companyId ? `✓ ${displayName(language, company)}` : displayName(language, company)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
