import type { ReactNode } from "react";

import { BaseerButton } from "./baseer-button";
import "./baseer-async-state.css";

type Language = "ar" | "en";

export type BaseerAsyncStatus = "ready" | "loading" | "empty" | "error" | "stale";

export type BaseerAsyncStateProps = {
  /** `stale` keeps existing content visible while making its freshness explicit. */
  status: BaseerAsyncStatus;
  language: Language;
  title?: ReactNode;
  description?: ReactNode;
  /** Required only when this state can retry a read. */
  onRetry?: () => void;
  retryLabel?: ReactNode;
  retrying?: boolean;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
};

const copy: Record<Language, Record<Exclude<BaseerAsyncStatus, "ready">, string>> = {
  ar: {
    loading: "جارٍ تحميل البيانات…",
    empty: "لا توجد بيانات للعرض.",
    error: "تعذر تحميل البيانات.",
    stale: "قد تكون البيانات المعروضة غير محدثة."
  },
  en: {
    loading: "Loading data…",
    empty: "There is no data to show.",
    error: "The data could not be loaded.",
    stale: "The displayed data may be out of date."
  },
};

/**
 * One semantic contract for asynchronous read states. It deliberately keeps
 * `ready` content unwrapped and keeps `stale` content visible, so a temporary
 * refresh failure never erases a user’s last trustworthy read.
 */
export function BaseerAsyncState({ status, language, title, description, onRetry, retryLabel, retrying = false, children, className, "aria-label": ariaLabel }: BaseerAsyncStateProps) {
  if (status === "ready") return <>{children}</>;

  const fallback = copy[language][status];
  const canRetry = Boolean(onRetry);
  const retry = retryLabel ?? (language === "ar" ? "إعادة المحاولة" : "Retry");
  const isError = status === "error";
  const role = isError ? "alert" : "status";

  return <section
    className={["baseer-async-state", `baseer-async-state--${status}`, className].filter(Boolean).join(" ")}
    role={role}
    aria-live={isError ? "assertive" : "polite"}
    aria-busy={status === "loading" || retrying || undefined}
    aria-label={ariaLabel}
    data-baseer-async-state={status}
  >
    {status === "loading" ? <span className="baseer-async-state__indicator" aria-hidden="true" /> : null}
    <div className="baseer-async-state__content">
      <strong>{title ?? fallback}</strong>
      {description ? <p>{description}</p> : title ? <p>{fallback}</p> : null}
      {canRetry ? <BaseerButton type="button" variant="secondary" disabled={retrying} onClick={onRetry}>{retrying ? (language === "ar" ? "جارٍ إعادة المحاولة…" : "Retrying…") : retry}</BaseerButton> : null}
    </div>
    {status === "stale" && children ? <div className="baseer-async-state__stale-content">{children}</div> : null}
  </section>;
}
