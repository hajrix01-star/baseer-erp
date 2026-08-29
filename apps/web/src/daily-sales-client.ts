import { BaseerApiError, parseBaseerApiResponse } from "./baseer-api-error";

export type Vault = {
  id: string;
  nameAr: string;
  nameEn: string;
  type: "CASH" | "BANK" | "APP";
  isSalesChannel: boolean;
};
export type Allocation = { vaultId: string; grossAmount: string };
export type Closing = {
  closingId: string;
  documentNumber: string;
  businessDate: string;
  scope: DailySalesScope;
  postingVersion: number;
  grossAmount: string;
  netAmount: string;
  vatAmount: string;
  customerCount: number;
  cashHandoverAmount: string | null;
  cashHandoverVaultId: string | null;
  status: "POSTED" | "REVERSED";
  notes: string | null;
  allocations: Allocation[];
};
export type DailySalesPreview = {
  grossAmount: string;
  netAmount: string;
  vatAmount: string;
  vatRateBasisPoints: number;
};
export type DailySalesEntryDate = {
  businessDate: string;
  timezone: "Asia/Riyadh";
};
export type ClosingsReceipt = {
  historyLimit: number;
  closings: Closing[];
  hasMore: boolean;
  nextCursor: string | null;
};
export type CashHandoverReport = {
  totalCashHandoverAmount: string;
  recordCount: number;
  hasMore: boolean;
  handovers: Array<{
    closingId: string;
    documentNumber: string;
    businessDate: string;
    scope: DailySalesScope;
    cashHandoverAmount: string;
    cashHandoverVaultId: string | null;
    notes: string | null;
  }>;
};
export type ShiftSummary = {
  scope: DailySalesScope;
  closingCount: number;
  grossAmount: string;
  customerCount: number;
  averageOrderAmount: string | null;
};
export type DailySalesWorkspaceReceipt = {
  companyId: string;
  fromBusinessDate: string;
  toBusinessDate: string;
  permissionCodes: string[];
  ownerCanCorrect: boolean;
  entryDate: DailySalesEntryDate;
  vaults: Vault[];
  historyLimit: number;
  closings: Closing[];
  hasMore: boolean;
  nextCursor: string | null;
  cashHandovers: CashHandoverReport;
  shifts: ShiftSummary[];
};
export type CalendarDay = {
  businessDate: string;
  operationalStatus: "OPEN" | "CLOSED" | "PARTIAL";
  dataStatus: "RECORDED" | "PENDING" | "CLOSED";
  hasActiveClosing: boolean;
  salesGrossAmount: string;
  customerCount: number;
};
export type AuthSessionReceipt = {
  accessToken: string;
  refreshToken: string;
  sessionExpiresAt: string;
  user: {
    id: string;
    nameAr: string;
    nameEn: string;
    preferredLanguage: string;
  };
};
export type ActiveSession = {
  accessToken: string;
  refreshToken: string;
  sessionExpiresAt: string;
  companyId: string;
};
export type AvailableCompany = {
  id: string;
  nameAr: string;
  nameEn: string;
  permissionCodes: string[];
  // Older private deployments may not have returned this identity hint yet.
  // The shell retains a guarded compatibility path until their API is rebuilt.
  isOwner?: boolean;
};
export type DailySalesScope = "MORNING" | "EVENING" | "ALL";
export type FormState = {
  businessDate: string;
  scope: DailySalesScope;
  customerCount: string;
  allocations: Allocation[];
  cashHandoverAmount: string;
  notes: string;
};
export type DailySalesEntryMode = "CLOSING" | "DAY_OFF";
export type DayOffReason =
  "WEEKLY_CLOSURE" | "HOLIDAY" | "MAINTENANCE" | "EMERGENCY" | "OTHER";

const tokenStorageKey = "baseer.erp.access-token";
const refreshTokenStorageKey = "baseer.erp.refresh-token";
const sessionExpiryStorageKey = "baseer.erp.session-expires-at";
const companyStorageKey = "baseer.erp.company-id";
let sessionExpiryReloadScheduled = false;
let refreshInFlight: Promise<ActiveSession | null> | null = null;
let refreshRateLimit: { accessToken: string; until: number; error: BaseerApiError } | null = null;
export const baseerApiBaseUrl = (
  import.meta.env.VITE_BASEER_API_URL ?? "/v1"
).replace(/\/$/, "");
function riyadhDateParts(value: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function dateIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthRange(): { from: string; to: string } {
  const current = riyadhDateParts(new Date());
  const monthEnd = new Date(Date.UTC(current.year, current.month, 0));
  return {
    from: dateIso(current.year, current.month, 1),
    to: dateIso(current.year, current.month, monthEnd.getUTCDate()),
  };
}
export function initialForm(vaultId = ""): FormState {
  return {
    businessDate: "",
    scope: "ALL",
    customerCount: "",
    allocations: [{ vaultId, grossAmount: "" }],
    cashHandoverAmount: "",
    notes: "",
  };
}
export type DailySalesShiftForms = Record<DailySalesScope, FormState>;
export function initialShiftFormsForVaults(
  vaults: readonly Vault[],
  businessDate = "",
): DailySalesShiftForms {
  const make = (scope: DailySalesScope): FormState => ({
    ...initialFormForVaults(vaults),
    businessDate,
    scope,
  });
  return {
    MORNING: make("MORNING"),
    EVENING: make("EVENING"),
    ALL: make("ALL"),
  };
}
export function initialFormForVaults(vaults: readonly Vault[]): FormState {
  return {
    ...initialForm(),
    allocations: vaults.map((vault) => ({
      vaultId: vault.id,
      grossAmount: "",
    })),
  };
}
export function activeSession(): ActiveSession | null {
  const accessToken = sessionStorage.getItem(tokenStorageKey);
  const refreshToken = sessionStorage.getItem(refreshTokenStorageKey);
  const sessionExpiresAt = sessionStorage.getItem(sessionExpiryStorageKey);
  const companyId = sessionStorage.getItem(companyStorageKey);
  return accessToken && refreshToken && sessionExpiresAt && companyId
    ? { accessToken, refreshToken, sessionExpiresAt, companyId }
    : null;
}

/** Stores the complete rotating token pair. Access tokens alone are not sessions. */
export function persistActiveSession(receipt: AuthSessionReceipt, companyId: string): void {
  sessionStorage.setItem(tokenStorageKey, receipt.accessToken);
  sessionStorage.setItem(refreshTokenStorageKey, receipt.refreshToken);
  sessionStorage.setItem(sessionExpiryStorageKey, receipt.sessionExpiresAt);
  sessionStorage.setItem(companyStorageKey, companyId);
}

export function clearActiveSession(): void {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(refreshTokenStorageKey);
  sessionStorage.removeItem(sessionExpiryStorageKey);
  sessionStorage.removeItem(companyStorageKey);
}

/** Best-effort server revocation. Callers clear local state regardless of network outcome. */
export async function signOutActiveSession(accessToken: string): Promise<void> {
  await fetch(`${baseerApiBaseUrl}/auth/sign-out`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });
}

function clearExpiredSession(): void {
  clearActiveSession();
  if (sessionExpiryReloadScheduled) return;
  sessionExpiryReloadScheduled = true;
  window.setTimeout(() => window.location.reload(), 0);
}

export function selectActiveCompany(companyId: string): void {
  sessionStorage.setItem(companyStorageKey, companyId);
}

export async function listAvailableCompanies(
  session: ActiveSession,
): Promise<AvailableCompany[]> {
  const receipt = await api<{ companies: AvailableCompany[] }>(
    session,
    "/companies/available",
  );
  return receipt.companies;
}
export function requestId(): string {
  return crypto.randomUUID();
}

export async function api<T>(
  session: ActiveSession,
  path: string,
  options?: RequestInit,
): Promise<T> {
  // A fresh sign-in can race a local development API restart or a token
  // rotation already in flight. Keep the recovery bounded, but allow the
  // newly rotated pair one additional authenticated retry before declaring
  // the browser session invalid.
  let current = session;
  for (let refreshAttempt = 0; refreshAttempt < 2; refreshAttempt += 1) {
    try {
      return await requestWithTransientReadRetry<T>(current, path, options);
    } catch (error) {
      if (!(error instanceof BaseerApiError) || error.status !== 401) throw error;
      const refreshed = await refreshSessionOnce(current.accessToken);
      if (!refreshed) throw error;
      current = refreshed;
    }
  }
  // Two newly issued access tokens were rejected. This is an actual invalid
  // session, rather than a transient handoff condition.
  clearExpiredSession();
  throw new BaseerApiError(401, "AUTHENTICATION_FAILED", null, null, null);
}

function canRetryTransientRead(error: unknown, options?: RequestInit) {
  if ((options?.method ?? "GET").toUpperCase() !== "GET" || options?.signal?.aborted) return false;
  // A read may safely retry once if the browser never received a response, or
  // when an intermediary/service is temporarily unavailable. Commands never
  // use this path, so no financial write can be replayed by the client.
  return !(error instanceof BaseerApiError) || [502, 503, 504].includes(error.status);
}

function waitForTransientReadRetry(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 250);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
    }, { once: true });
  });
}

async function requestWithTransientReadRetry<T>(
  session: ActiveSession,
  path: string,
  options?: RequestInit,
): Promise<T> {
  try {
    return await requestWithSession<T>(session, path, options);
  } catch (error) {
    if (!canRetryTransientRead(error, options)) throw error;
    await waitForTransientReadRetry(options?.signal ?? undefined);
    return requestWithSession<T>(session, path, options);
  }
}

async function requestWithSession<T>(
  session: ActiveSession,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseerApiBaseUrl}${path}`, {
    ...options,
    // Financial workspace receipts are live, company-scoped data. Never let a
    // browser reuse a prior company's or prior visit's response.
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-Baseer-Company-Id": session.companyId,
      ...(options?.headers ?? {}),
    },
  });
  return parseBaseerApiResponse<T>(response);
}

/**
 * Uses one shared refresh request for all 401s caused by an expired access
 * token, rotates the pair, then lets each request retry once. A network or
 * server failure intentionally leaves the local session intact; only a failed
 * refresh authentication clears it.
 */
async function refreshSessionOnce(staleAccessToken: string): Promise<ActiveSession | null> {
  const current = activeSession();
  if (!current) return null;
  if (current.accessToken !== staleAccessToken) return current;
  if (refreshRateLimit?.accessToken === staleAccessToken) {
    if (Date.now() < refreshRateLimit.until) throw refreshRateLimit.error;
    refreshRateLimit = null;
  }
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const beforeRefresh = activeSession();
    if (!beforeRefresh) return null;
    if (beforeRefresh.accessToken !== staleAccessToken) return beforeRefresh;
    const response = await fetch(`${baseerApiBaseUrl}/auth/refresh`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: beforeRefresh.refreshToken }),
    });
    try {
      const receipt = await parseBaseerApiResponse<AuthSessionReceipt>(response);
      persistActiveSession(receipt, beforeRefresh.companyId);
      refreshRateLimit = null;
      return activeSession();
    } catch (error) {
      if (error instanceof BaseerApiError && error.status === 401) {
        clearExpiredSession();
        return null;
      }
      if (error instanceof BaseerApiError && error.status === 429) {
        // Preserve the server's cooldown locally: retries from several reads
        // must not keep hitting /auth/refresh while the account is blocked.
        const retryAfterSeconds = error.retry?.kind === "retry-after"
          ? error.retry.retryAfterSeconds ?? 900
          : 900;
        refreshRateLimit = {
          accessToken: staleAccessToken,
          until: Date.now() + retryAfterSeconds * 1000,
          error,
        };
      }
      throw error;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}
