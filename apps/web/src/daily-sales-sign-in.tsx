import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { listAuthenticatedCompanies, signInForDailySales, type AuthenticatedCompany } from "./daily-sales-auth-client";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";

const tokenStorageKey = "baseer.erp.access-token";
const companyStorageKey = "baseer.erp.company-id";

export function DailySalesSignIn({
  language,
}: {
  language: DailySalesLanguage;
}) {
  const copy = dailySalesText[language];
  const [tenantCode, setTenantCode] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [companies, setCompanies] = useState<AuthenticatedCompany[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const choose = (companyId: string) => {
    if (!accessToken) return;
    sessionStorage.setItem(tokenStorageKey, accessToken);
    sessionStorage.setItem(companyStorageKey, companyId);
    window.location.reload();
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const session = await signInForDailySales({
        tenantCode: tenantCode.trim(),
        login: login.trim(),
        password,
      });
      const companies = await listAuthenticatedCompanies(session.accessToken);
      if (companies.length === 1) {
        sessionStorage.setItem(tokenStorageKey, session.accessToken);
        sessionStorage.setItem(companyStorageKey, companies[0].id);
        window.location.reload();
        return;
      }
      setAccessToken(session.accessToken);
      setCompanies(companies);
    } catch (error) {
      setError(presentBaseerApiError(error, language, copy.signInError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="daily-sales-shell daily-sales-empty">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h2>{copy.noSession}</h2>
      <p>{copy.noSessionDetail}</p>
      {accessToken ? (
        <div className="daily-sales-company-picker">
          <h3>{copy.chooseCompany}</h3>
          {companies.map((company) => (
            <button
              key={company.id}
              className="daily-sales-primary"
              type="button"
              onClick={() => choose(company.id)}
            >
              {language === "ar" ? company.nameAr : company.nameEn}
            </button>
          ))}
        </div>
      ) : (
        <form className="daily-sales-sign-in" onSubmit={signIn}>
          <label>
            <span>{copy.tenantCode}</span>
            <input value={tenantCode} onChange={(event) => setTenantCode(event.target.value)} autoComplete="organization" required />
          </label>
          <label>
            <span>{copy.login}</span>
            <input type="text" value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            <span>{copy.password}</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error && <p className="daily-sales-message error">{error}</p>}
          <button className="daily-sales-primary" type="submit" disabled={loading}>
            {loading ? copy.signingIn : copy.signIn}
          </button>
        </form>
      )}
      <p className="daily-sales-session-note">{copy.sessionOnly}</p>
    </section>
  );
}