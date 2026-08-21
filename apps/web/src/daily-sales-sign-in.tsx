import { useState } from "react";
import { presentBaseerApiError } from "./baseer-api-error";
import {
  activateGeneralOwner,
  listAuthenticatedCompanies,
  signInForDailySales,
} from "./daily-sales-auth-client";
import { persistActiveSession } from "./daily-sales-client";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";

export function DailySalesSignIn({
  language,
}: {
  language: DailySalesLanguage;
}) {
  const copy = dailySalesText[language];
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [activationMode, setActivationMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const completeSignIn = async (
    identifier: string,
    selectedPassword: string,
  ) => {
    const session = await signInForDailySales({
      login: identifier.trim(),
      password: selectedPassword,
    });
    const available = await listAuthenticatedCompanies(session.accessToken);
    const company = available[0];
    if (!company) throw new Error("No company is available for this user.");
    persistActiveSession(session, company.id);
    window.location.reload();
  };
  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await completeSignIn(login, password);
    } catch (failure) {
      setError(presentBaseerApiError(failure, language, copy.signInError));
    } finally {
      setLoading(false);
    }
  };
  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.trim().length < 6) {
      setError(
        language === "ar"
          ? "يجب أن تكون كلمة المرور 6 خانات على الأقل."
          : "Password must be at least 6 characters.",
      );
      return;
    }
    if (password !== confirmPassword) {
      setError(
        language === "ar"
          ? "كلمتا المرور غير متطابقتين."
          : "Passwords do not match.",
      );
      return;
    }
    setLoading(true);
    setError("");
    try {
      await activateGeneralOwner({
        email: login.trim(),
        activationCode,
        password,
      });
      await completeSignIn(login, password);
    } catch (failure) {
      setError(presentBaseerApiError(failure, language, copy.signInError));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="daily-sales-shell daily-sales-empty">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h2>{copy.noSession}</h2>
      <p>{copy.noSessionDetail}</p>
      {activationMode ? (
        <form className="daily-sales-sign-in" onSubmit={activate}>
          <p>
            {language === "ar"
              ? "تفعيل المالك العام لأول مرة فقط"
              : "Activate the general owner once"}
          </p>
          <label>
            <span>{language === "ar" ? "البريد الإلكتروني" : "Email"}</span>
            <input
              type="email"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>
              {language === "ar"
                ? "رمز التفعيل لمرة واحدة"
                : "One-time activation code"}
            </span>
            <input
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value)}
              autoComplete="one-time-code"
              required
            />
          </label>
          <label>
            <span>
              {language === "ar" ? "كلمة المرور الجديدة" : "New password"}
            </span>
            <input
              type={showPasswords ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          <label>
            <span>
              {language === "ar" ? "تأكيد كلمة المرور" : "Confirm password"}
            </span>
            <input
              type={showPasswords ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          <button className="daily-sales-secondary" type="button" onClick={() => setShowPasswords((current) => !current)}>{showPasswords ? (language === "ar" ? "إخفاء كلمة المرور" : "Hide password") : (language === "ar" ? "إظهار كلمة المرور" : "Show password")}</button>
          {error && <p className="daily-sales-message error">{error}</p>}
          <button
            className="daily-sales-primary"
            type="submit"
            disabled={loading}
          >
            {loading
              ? copy.signingIn
              : language === "ar"
                ? "تفعيل ودخول"
                : "Activate and sign in"}
          </button>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={() => {
              setActivationMode(false);
              setError("");
            }}
          >
            {language === "ar" ? "العودة للدخول" : "Back to sign in"}
          </button>
        </form>
      ) : (
        <form className="daily-sales-sign-in" onSubmit={signIn}>
          <p>
            {language === "ar"
              ? "ادخل بالبريد الإلكتروني أو اسم المستخدم. الشركات تظهر حسب صلاحياتك."
              : "Sign in with email or username. Your permitted companies will appear automatically."}
          </p>
          <label>
            <span>{copy.login}</span>
            <input
              type="text"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>{copy.password}</span>
            <input
              type={showPasswords ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="daily-sales-secondary" type="button" onClick={() => setShowPasswords((current) => !current)}>{showPasswords ? (language === "ar" ? "إخفاء كلمة المرور" : "Hide password") : (language === "ar" ? "إظهار كلمة المرور" : "Show password")}</button>
          {error && <p className="daily-sales-message error">{error}</p>}
          <button
            className="daily-sales-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? copy.signingIn : copy.signIn}
          </button>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={() => {
              setActivationMode(true);
              setError("");
            }}
          >
            {language === "ar"
              ? "تفعيل المالك العام لأول مرة"
              : "Activate general owner"}
          </button>
        </form>
      )}
      <p className="daily-sales-session-note">{copy.sessionOnly}</p>
    </section>
  );
}
