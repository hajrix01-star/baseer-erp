import { useState, type ReactNode } from "react";
import { BaseerBrand } from "./baseer-brand";
import { baseerLoginCopy } from "./baseer-login-copy";

type Language = "ar" | "en";
type Props = { language: Language; onLanguage: () => void; themeControl: ReactNode };
type Company = { id: string; nameAr: string; nameEn: string };
const api = (import.meta.env.VITE_BASEER_API_URL ?? "/v1").replace(/\/$/, "");
const store = { token: "baseer.erp.access-token", company: "baseer.erp.company-id" };

export function BaseerLogin({ language, onLanguage, themeControl }: Props) {
  const ar = language === "ar";
  const text = baseerLoginCopy[language];
  const [login, setLogin] = useState(""); const [password, setPassword] = useState(""); const [visible, setVisible] = useState(false);
  const [token, setToken] = useState(""); const [companies, setCompanies] = useState<Company[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const choose = (accessToken: string, companyId: string) => { sessionStorage.setItem(store.token, accessToken); sessionStorage.setItem(store.company, companyId); window.location.reload(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const signIn = await fetch(`${api}/auth/sign-in`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: login.trim(), password }) });
      if (!signIn.ok) throw new Error();
      const session = await signIn.json() as { accessToken: string };
      const result = await fetch(`${api}/companies/available`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
      if (!result.ok) throw new Error();
      const available = (await result.json() as { companies: Company[] }).companies;
      if (available.length === 1) choose(session.accessToken, available[0].id); else { setToken(session.accessToken); setCompanies(available); }
    } catch { setError(text.failed); }
    finally { setLoading(false); }
  };
  return <main className="launcher-page" style={{ minHeight: "100dvh" }}>
    <header className="launcher-topbar"><BaseerBrand /><span className="topbar-spacer" /><button className="text-button" type="button" onClick={onLanguage}>{text.switchLanguage}</button>{themeControl}</header>
    <section className="launcher-page__content" style={{ maxWidth: "760px", paddingTop: "clamp(42px, 8vw, 96px)" }}>
      <div className="launcher-page__heading"><h1>{text.welcome}</h1></div>
      {token ? <section className="daily-sales-company-picker" aria-live="polite"><h3>{text.choose}</h3>{companies.length ? companies.map((company) => <button className="daily-sales-primary" type="button" key={company.id} onClick={() => choose(token, company.id)}>{ar ? company.nameAr : company.nameEn || company.nameAr}</button>) : <p className="daily-sales-message error">{text.noCompanies}</p>}<button className="daily-sales-secondary" type="button" onClick={() => { setToken(""); setCompanies([]); }}>{text.other}</button></section>
      : <form className="daily-sales-sign-in" onSubmit={(event) => void submit(event)}><label>{text.login}<input autoComplete="username" autoFocus required value={login} onChange={(event) => setLogin(event.target.value)} /></label><label>{text.password}<input autoComplete="current-password" required type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="daily-sales-secondary" type="button" onClick={() => setVisible((value) => !value)}>{visible ? text.hide : text.show}</button>{error && <p className="daily-sales-message error" role="alert">{error}</p>}<button className="daily-sales-primary" disabled={loading}>{loading ? text.loading : text.submit}</button></form>}
    </section>
  </main>;
}