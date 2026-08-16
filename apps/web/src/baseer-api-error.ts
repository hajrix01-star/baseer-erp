export type BaseerApiErrorCode =
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "CONFLICT"
  | "DEPENDENCY_UNAVAILABLE"
  | "IDEMPOTENCY_MISMATCH"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "VALIDATION_FAILED";

type LocalizedMessage = { ar: string; en: string };
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
  if (!(error instanceof BaseerApiError)) return fallback;
  const message = error.localizedMessage?.[language] ?? fallback;
  const retry = error.retry?.kind === "retry-after" && error.retry.retryAfterSeconds
    ? language === "ar"
      ? ` أعد المحاولة بعد ${error.retry.retryAfterSeconds} ثانية.`
      : ` Try again after ${error.retry.retryAfterSeconds} seconds.`
    : "";
  const reference = error.correlationId
    ? language === "ar"
      ? ` رقم المتابعة: ${error.correlationId}.`
      : ` Reference: ${error.correlationId}.`
    : "";
  return `${message}${retry}${reference}`;
}