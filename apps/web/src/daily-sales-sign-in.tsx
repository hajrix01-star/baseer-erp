import { useState } from "react";
import { presentBaseerApiError } from "./baseer-api-error";
import {
  activateGeneralOwner,
  listAuthenticatedCompanies,
  signInForDailySales,
} from "./daily-sales-auth-client";
import { persistActiveSession } from "./daily-sales-client";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import { BaseerButton } from "./baseer-button";
import { BaseerTextInput } from "./baseer-form-fields";
import {
  BaseerValidatedFormField as BaseerValidatedForm,
  type BaseerValidatedFormSchemaFactory,
} from "./baseer-validated-form-field";

type SignInValues = { login: string; password: string };
type ActivationValues = SignInValues & {
  activationCode: string;
  confirmPassword: string;
};

export function DailySalesSignIn({
  language,
}: {
  language: DailySalesLanguage;
}) {
  const copy = dailySalesText[language];
  const required =
    language === "ar" ? "هذا الحقل مطلوب." : "This field is required.";
  const passwordLength =
    language === "ar"
      ? "يجب أن تكون كلمة المرور 6 خانات على الأقل."
      : "Password must be at least 6 characters.";
  const passwordMismatch =
    language === "ar"
      ? "كلمتا المرور غير متطابقتين."
      : "Passwords do not match.";
  const signInSchemaFactory: BaseerValidatedFormSchemaFactory = ({ z }) =>
    z
      .object({
        login: z.string().trim().min(1, required),
        password: z.string().min(1, required),
      })
      .strict();
  const activationSchemaFactory: BaseerValidatedFormSchemaFactory = ({ z }) =>
    z
      .object({
        login: z.string().trim().email(required),
        activationCode: z.string().trim().min(1, required),
        password: z.string().min(6, passwordLength),
        confirmPassword: z.string().min(6, passwordLength),
      })
      .strict()
      .refine((value) => value.password === value.confirmPassword, {
        path: ["confirmPassword"],
        message: passwordMismatch,
      });
  const [signInValues, setSignInValues] = useState<SignInValues>({
    login: "",
    password: "",
  });
  const [activationValues, setActivationValues] = useState<ActivationValues>({
    login: "",
    password: "",
    activationCode: "",
    confirmPassword: "",
  });
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
  const signIn = async ({ login, password }: SignInValues) => {
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
  const activate = async ({
    login,
    activationCode,
    password,
  }: ActivationValues) => {
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
        <BaseerValidatedForm
          className="daily-sales-sign-in"
          values={activationValues}
          schemaFactory={activationSchemaFactory}
          errorSummaryLabel={required}
          onValid={activate}
        >
          {({ errors }) => <>
          <p>
            {language === "ar"
              ? "تفعيل المالك العام لأول مرة فقط"
              : "Activate the general owner once"}
          </p>
          <label>
            <span>{language === "ar" ? "البريد الإلكتروني" : "Email"}</span>
            <BaseerTextInput
              type="email"
              value={activationValues.login}
              onChange={(event) => setActivationValues((value) => ({ ...value, login: event.target.value }))}
              autoComplete="username"
              aria-invalid={Boolean(errors.login)}
              aria-describedby={
                errors.login
                  ? "activation-login-error"
                  : undefined
              }
            />
            {errors.login ? (
              <span id="activation-login-error" role="alert">
                {errors.login.message}
              </span>
            ) : null}
          </label>
          <label>
            <span>
              {language === "ar"
                ? "رمز التفعيل لمرة واحدة"
                : "One-time activation code"}
            </span>
            <BaseerTextInput
              value={activationValues.activationCode}
              onChange={(event) => setActivationValues((value) => ({ ...value, activationCode: event.target.value }))}
              autoComplete="one-time-code"
              aria-invalid={Boolean(errors.activationCode)}
              aria-describedby={
                errors.activationCode
                  ? "activation-code-error"
                  : undefined
              }
            />
            {errors.activationCode ? (
              <span id="activation-code-error" role="alert">
                {errors.activationCode.message}
              </span>
            ) : null}
          </label>
          <label>
            <span>
              {language === "ar" ? "كلمة المرور الجديدة" : "New password"}
            </span>
            <input
              type={showPasswords ? "text" : "password"}
              value={activationValues.password}
              onChange={(event) => setActivationValues((value) => ({ ...value, password: event.target.value }))}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password
                  ? "activation-password-error"
                  : undefined
              }
            />
            {errors.password ? (
              <span id="activation-password-error" role="alert">
                {errors.password.message}
              </span>
            ) : null}
          </label>
          <label>
            <span>
              {language === "ar" ? "تأكيد كلمة المرور" : "Confirm password"}
            </span>
            <input
              type={showPasswords ? "text" : "password"}
              value={activationValues.confirmPassword}
              onChange={(event) => setActivationValues((value) => ({ ...value, confirmPassword: event.target.value }))}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={
                errors.confirmPassword
                  ? "activation-confirm-error"
                  : undefined
              }
            />
            {errors.confirmPassword ? (
              <span id="activation-confirm-error" role="alert">
                {errors.confirmPassword.message}
              </span>
            ) : null}
          </label>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={() => setShowPasswords((current) => !current)}
          >
            {showPasswords
              ? language === "ar"
                ? "إخفاء كلمة المرور"
                : "Hide password"
              : language === "ar"
                ? "إظهار كلمة المرور"
                : "Show password"}
          </button>
          {error && <p className="daily-sales-message error">{error}</p>}
          <BaseerButton
            className="daily-sales-primary"
            type="submit"
            disabled={loading}
          >
            {loading
              ? copy.signingIn
              : language === "ar"
                ? "تفعيل ودخول"
                : "Activate and sign in"}
          </BaseerButton>
          <BaseerButton
            className="daily-sales-secondary"
            type="button"
            variant="secondary"
            onClick={() => {
              setActivationMode(false);
              setError("");
            }}
          >
            {language === "ar" ? "العودة للدخول" : "Back to sign in"}
          </BaseerButton>
          </>}
        </BaseerValidatedForm>
      ) : (
        <BaseerValidatedForm
          className="daily-sales-sign-in"
          values={signInValues}
          schemaFactory={signInSchemaFactory}
          errorSummaryLabel={required}
          onValid={signIn}
        >
          {({ errors }) => <>
          <p>
            {language === "ar"
              ? "ادخل بالبريد الإلكتروني أو اسم المستخدم. الشركات تظهر حسب صلاحياتك."
              : "Sign in with email or username. Your permitted companies will appear automatically."}
          </p>
          <label>
            <span>{copy.login}</span>
            <BaseerTextInput
              type="text"
              value={signInValues.login}
              onChange={(event) => setSignInValues((value) => ({ ...value, login: event.target.value }))}
              autoComplete="username"
              aria-invalid={Boolean(errors.login)}
              aria-describedby={
                errors.login
                  ? "sign-in-login-error"
                  : undefined
              }
            />
            {errors.login ? (
              <span id="sign-in-login-error" role="alert">
                {errors.login.message}
              </span>
            ) : null}
          </label>
          <label>
            <span>{copy.password}</span>
            <input
              type={showPasswords ? "text" : "password"}
              value={signInValues.password}
              onChange={(event) => setSignInValues((value) => ({ ...value, password: event.target.value }))}
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password
                  ? "sign-in-password-error"
                  : undefined
              }
            />
            {errors.password ? (
              <span id="sign-in-password-error" role="alert">
                {errors.password.message}
              </span>
            ) : null}
          </label>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={() => setShowPasswords((current) => !current)}
          >
            {showPasswords
              ? language === "ar"
                ? "إخفاء كلمة المرور"
                : "Hide password"
              : language === "ar"
                ? "إظهار كلمة المرور"
                : "Show password"}
          </button>
          {error && <p className="daily-sales-message error">{error}</p>}
          <BaseerButton
            className="daily-sales-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? copy.signingIn : copy.signIn}
          </BaseerButton>
          <BaseerButton
            className="daily-sales-secondary"
            type="button"
            variant="secondary"
            onClick={() => {
              setActivationMode(true);
              setError("");
              setActivationValues((value) => ({ ...value, login: signInValues.login }));
            }}
          >
            {language === "ar"
              ? "تفعيل المالك العام لأول مرة"
              : "Activate general owner"}
          </BaseerButton>
          </>}
        </BaseerValidatedForm>
      )}
      <p className="daily-sales-session-note">{copy.sessionOnly}</p>
    </section>
  );
}
