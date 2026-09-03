export type BaseerApiErrorCode =
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "CONFLICT"
  | "DEPENDENCY_UNAVAILABLE"
  | "IDEMPOTENCY_MISMATCH"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "REPORT_RUN_EXPIRED"
  | "VALIDATION_FAILED";

type LocalizedMessage = { ar: string; en: string };
export type BaseerLocalizedSubject = Readonly<{ ar: string; en: string }>;
type RetryGuidance = { kind: "do-not-retry" | "retry" | "retry-after"; retryAfterSeconds?: number };
type ErrorReceipt = { error: { code: BaseerApiErrorCode; message: LocalizedMessage; correlationId: string; retry: RetryGuidance } };

function isErrorReceipt(value: unknown): value is ErrorReceipt {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return !!error && typeof error === "object" && "message" in error && "correlationId" in error;
}

export class BaseerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: BaseerApiErrorCode | "UNEXPECTED_RESPONSE",
    readonly localizedMessage: LocalizedMessage | null,
    readonly correlationId: string | null,
    readonly retry: RetryGuidance | null,
  ) {
    super(localizedMessage?.en ?? `Request failed (${status})`);
    this.name = "BaseerApiError";
  }
}

export async function parseBaseerApiResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as T;
  if (isErrorReceipt(payload)) {
    throw new BaseerApiError(
      response.status,
      payload.error.code,
      payload.error.message,
      payload.error.correlationId,
      payload.error.retry,
    );
  }
  throw new BaseerApiError(
    response.status,
    "UNEXPECTED_RESPONSE",
    null,
    response.headers.get("x-request-id"),
    null,
  );
}

export function presentBaseerApiError(
  error: unknown,
  language: "ar" | "en",
  fallback: string,
): string {
  if (!(error instanceof BaseerApiError)) {
    return language === "ar"
      ? "تعذر الاتصال بالخدمة. تحقق من اتصالك ثم أعد المحاولة."
      : "The service could not be reached. Check your connection and try again.";
  }
  if (error.status === 401 || error.code === "AUTHENTICATION_FAILED") {
    return language === "ar"
      ? "انتهت الجلسة. سجّل الدخول مرة أخرى."
      : "Your session has ended. Sign in again.";
  }
  if (error.status === 403 || error.code === "AUTHORIZATION_DENIED") {
    return language === "ar"
      ? "لا تملك صلاحية تنفيذ هذا الإجراء."
      : "You do not have permission to perform this action.";
  }
  if (error.status === 429 || error.code === "RATE_LIMITED") {
    return language === "ar"
      ? "الخدمة مشغولة مؤقتًا. أعد المحاولة بعد قليل."
      : "The service is temporarily busy. Try again shortly.";
  }
  if ([502, 503, 504].includes(error.status)) {
    return language === "ar"
      ? "الخدمة غير متاحة مؤقتًا. أعد المحاولة."
      : "The service is temporarily unavailable. Try again.";
  }
  // Internal failures are tracked server-side; the person using the ERP only needs a safe next step.
  const message = error.code === "INTERNAL_ERROR" || error.code === "UNEXPECTED_RESPONSE"
    ? fallback
    : error.localizedMessage?.[language] ?? fallback;
  const retry = error.retry?.kind === "retry-after" && error.retry.retryAfterSeconds
    ? language === "ar"
      ? ` أعد المحاولة بعد ${error.retry.retryAfterSeconds} ثانية.`
      : ` Try again after ${error.retry.retryAfterSeconds} seconds.`
    : "";
  // Correlation IDs stay in the server audit trail; they are not actionable UI copy.
  return `${message}${retry}`;
}

/**
 * Read surfaces may expose a retry only when repeating the same request is
 * safe and has a reasonable chance to succeed. Authentication and permission
 * failures need a different user action, while the shared API client already
 * performs its one bounded transient GET retry before this is evaluated.
 */
export function canRetryBaseerApiError(error: unknown): boolean {
  if (!(error instanceof BaseerApiError)) return true;
  if (error.status === 401 || error.status === 403) return false;
  return error.retry?.kind === "retry"
    || error.retry?.kind === "retry-after"
    || [429, 502, 503, 504].includes(error.status);
}

/**
 * Loading copy describes an in-progress request and must never be displayed
 * after a request has failed. Keep the safe fallback here so every read
 * surface uses the same wording while preserving a valid server receipt.
 */
export function presentBaseerLoadError(
  error: unknown,
  language: "ar" | "en",
  subject: BaseerLocalizedSubject,
): string {
  const fallback = language === "ar"
    ? `تعذر تحميل ${subject.ar}. أعد المحاولة.`
    : `Could not load ${subject.en}. Try again.`;
  return presentBaseerApiError(error, language, fallback);
}
