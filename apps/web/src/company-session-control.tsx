import { useEffect, useRef, useState } from "react";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
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
        ref={triggerRef}
        className="company-selector"
        type="button"
        aria-expanded={open}
        aria-controls="company-session-control-options"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }}
      >
        <span className="status-dot" />
        <span>{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id="company-session-control-options" className="company-session-control__menu" role="group" aria-label={copy.signInAndChooseCompany}>
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              aria-current={company.id === session.companyId ? "true" : undefined}
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
