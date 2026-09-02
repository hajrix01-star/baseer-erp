import { useState, type ReactNode } from "react";
import { BaseerApiError, presentBaseerApiError } from "./baseer-api-error";
import { BaseerBrand } from "./baseer-brand";
import { BaseerButton } from "./baseer-button";
import { BaseerTextInput } from "./baseer-text-input";
import { baseerLoginCopy } from "./baseer-login-copy";
import { persistActiveSession, type AuthSessionReceipt } from "./daily-sales-client";
import { activateGeneralOwner, listAuthenticatedCompanies, signInForDailySales } from "./daily-sales-auth-client";

type Language = "ar" | "en";
type Props = {
  language: Language;
  onLanguage: () => void;
  themeControl: ReactNode;
  onAuthenticated: () => void;
};
type Company = { id: string; nameAr: string; nameEn: string };

function LoginIcon({ name }: { name: "user" | "lock" | "eye" | "eyeOff" | "arrow" }) {
  const paths = {
    user: <><circle cx="12" cy="8" r="3.25" /><path d="M5.5 20.5c.7-3.25 3.02-5 6.5-5s5.8 1.75 6.5 5" /></>,
    lock: <><rect x="5.5" y="10.25" width="13" height="10" rx="2.25" /><path d="M8.5 10.25V7.5a3.5 3.5 0 0 1 7 0v2.75M12 14.25v2.25" /></>,
    eye: <><path d="M2.75 12s3.2-5.25 9.25-5.25S21.25 12 21.25 12 18.05 17.25 12 17.25 2.75 12 2.75 12Z" /><circle cx="12" cy="12" r="2.25" /></>,
    eyeOff: <><path d="m4 4 16 16M9.55 6.93A10.5 10.5 0 0 1 12 6.65c6.05 0 9.25 5.35 9.25 5.35a12.8 12.8 0 0 1-3.03 3.42M6.1 9.03A12.4 12.4 0 0 0 2.75 12S5.95 17.35 12 17.35c.92 0 1.76-.12 2.52-.34M9.75 9.75a3.18 3.18 0 0 0 4.5 4.5" /></>,
    arrow: <><path d="M5 12h13M13.5 6.5 19 12l-5.5 5.5" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function BaseerLogin({ language, onLanguage, themeControl, onAuthenticated }: Props) {
  const text = baseerLoginCopy[language];
  const [login, setLogin] = useState(""); const [password, setPassword] = useState(""); const [visible, setVisible] = useState(false);
  const [activationCode, setActivationCode] = useState(""); const [confirmPassword, setConfirmPassword] = useState("");
  const [activationMode, setActivationMode] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(false);
  // Do not reload the whole PWA immediately after storing a new token pair.
  // A full reload in development re-runs bootstrap reads while the session is
  // being established; notifying the already-mounted shell keeps that handoff
  // atomic from the browser's point of view.
  const choose = (session: AuthSessionReceipt, companyId: string) => {
    persistActiveSession(session, companyId);
    onAuthenticated();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(""); setNotice("");
    try {
      const session = await signInForDailySales({ login: login.trim(), password });
      let available: Company[];
      try {
        available = await listAuthenticatedCompanies(session.accessToken);
      } catch (failure) {
        setError(presentBaseerApiError(failure, language, text.sessionSetupFailed));
        return;
      }
      const company = available[0];
      if (!company) { setError(text.noCompanies); return; }
      choose(session, company.id);
    } catch (error) {
      const fallback = error instanceof BaseerApiError && error.code === "AUTHENTICATION_FAILED"
        ? text.failed
        : text.serviceUnavailable;
      setError(presentBaseerApiError(error, language, fallback));
    }
    finally { setLoading(false); }
  };
  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setNotice("");
    if (password.length < 6) { setError(text.passwordTooShort); return; }
    if (password !== confirmPassword) { setError(text.passwordMismatch); return; }
    setLoading(true);
    try {
      await activateGeneralOwner({ email: login.trim(), activationCode: activationCode.trim(), password });
      setActivationMode(false); setPassword(""); setConfirmPassword(""); setActivationCode("");
      setNotice(text.activationComplete);
    } catch (failure) {
      setError(presentBaseerApiError(failure, language, text.serviceUnavailable));
    } finally { setLoading(false); }
  };
  return <main className="launcher-page" style={{ minHeight: "100dvh" }}>
    <header className="launcher-topbar"><BaseerBrand /><span className="topbar-spacer" /><button className="text-button" type="button" onClick={onLanguage}>{text.switchLanguage}</button>{themeControl}</header>
    <section className="launcher-page__content baseer-login" style={{ maxWidth: "760px", paddingTop: "clamp(42px, 8vw, 96px)" }}>
      <div className="baseer-login__panel">
        <div className="baseer-login__heading"><span className="baseer-login__mark"><LoginIcon name="lock" /></span><p>Baseer ERP</p><h1>{text.welcome}</h1><span>{text.secureAccess}</span></div>
        <form className="baseer-login__form" onSubmit={(event) => void (activationMode ? activate(event) : submit(event))}>
          <label><span>{text.login}</span><span className="baseer-login__field"><LoginIcon name="user" /><BaseerTextInput autoComplete="username" autoFocus required value={login} onChange={(event) => setLogin(event.target.value)} /></span></label>
          {activationMode ? <><p>{text.activationDescription}</p><label><span>{text.activationCode}</span><BaseerTextInput required autoComplete="one-time-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value)} /></label></> : null}
          <label><span>{activationMode ? text.newPassword : text.password}</span><span className="baseer-login__field baseer-login__password"><LoginIcon name="lock" /><input autoComplete={activationMode ? "new-password" : "current-password"} required type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={visible ? text.hide : text.show} title={visible ? text.hide : text.show} onClick={() => setVisible((value) => !value)}><LoginIcon name={visible ? "eyeOff" : "eye"} /></button></span></label>
          {activationMode ? <label><span>{text.confirmPassword}</span><span className="baseer-login__field baseer-login__password"><LoginIcon name="lock" /><input autoComplete="new-password" required type={visible ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></span></label> : null}
          {error && <p className="daily-sales-message error" role="alert">{error}</p>}
          {notice && <p className="daily-sales-message success" role="status">{notice}</p>}
          <BaseerButton className="baseer-login__submit" type="submit" variant="primary" disabled={loading}>{loading ? text.loading : <><span>{activationMode ? text.activate : text.submit}</span><LoginIcon name="arrow" /></>}</BaseerButton>
          <BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => { setActivationMode((current) => !current); setError(""); setNotice(""); setPassword(""); setConfirmPassword(""); setActivationCode(""); }}>{activationMode ? text.backToSignIn : text.activateOwner}</BaseerButton>
        </form>
      </div>
    </section>
  </main>;
}
