import { BaseerApiError, parseBaseerApiResponse } from "./baseer-api-error";

export type Vault = {
  id: string;
  nameAr: string;
  nameEn: string;
  type: "CASH" | "BANK" | "ELECTRONIC";
  isSalesChannel: boolean;
};
export type Allocation = { vaultId: string; grossAmount: string };
export type Closing = {
  closingId: string;
  documentNumber: string;
  businessDate: string;
  scope: "MORNING" | "EVENING" | "ALL";
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
};
export type CashHandoverReport = {
  totalCashHandoverAmount: string;
  recordCount: number;
  handovers: Array<{
    closingId: string;
    documentNumber: string;
    businessDate: string;
    scope: "MORNING" | "EVENING" | "ALL";
    cashHandoverAmount: string;
    cashHandoverVaultId: string;
    notes: string | null;
  }>;
};
export type ShiftSummary = {
  scope: "MORNING" | "EVENING" | "ALL";
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
  entryDate: DailySalesEntryDate;
  vaults: Vault[];
  historyLimit: number;
  closings: Closing[];
  cashHandovers: CashHandoverReport;
  shifts: ShiftSummary[];
};export type CalendarDay = {
  businessDate: string;
  operationalStatus: "OPEN" | "CLOSED" | "PARTIAL";
  dataStatus: "RECORDED" | "PENDING" | "CLOSED";
  hasActiveClosing: boolean;
  salesGrossAmount: string;
  customerCount: number;
};
export type ActiveSession = { accessToken: string; companyId: string };
export type AvailableCompany = {
  id: string;
  nameAr: string;
  nameEn: string;
  permissionCodes: string[];
};
export type FormState = {
  businessDate: string;
  scope: "MORNING" | "EVENING" | "ALL";
  customerCount: string;
  allocations: Allocation[];
  cashHandoverAmount: string;
  cashHandoverVaultId: string;
  notes: string;
};
export type DailySalesEntryMode = "CLOSING" | "DAY_OFF";
export type DayOffReason =
  "WEEKLY_CLOSURE" | "HOLIDAY" | "MAINTENANCE" | "EMERGENCY" | "OTHER";

const tokenStorageKey = "baseer.erp.access-token";
const companyStorageKey = "baseer.erp.company-id";
let sessionExpiryReloadScheduled = false;
export const baseerApiBaseUrl = (
  import.meta.env.VITE_BASEER_API_URL ?? "/v1"
).replace(/\/$/, "");
function riyadhDateParts(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
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
    customerCount: "0",
    allocations: [{ vaultId, grossAmount: "" }],
    cashHandoverAmount: "",
    cashHandoverVaultId: vaultId,
    notes: "",
  };
}
export function initialFormForVaults(vaults: readonly Vault[]): FormState {
  const cashVaultId = vaults.find((vault) => vault.type === "CASH")?.id ?? "";
  return {
    ...initialForm(cashVaultId),
    allocations: vaults.map((vault) => ({
      vaultId: vault.id,
      grossAmount: "",
    })),
    cashHandoverVaultId: cashVaultId,
  };
}
export function activeSession(): ActiveSession | null {
  const accessToken = sessionStorage.getItem(tokenStorageKey);
  const companyId = sessionStorage.getItem(companyStorageKey);
  return accessToken && companyId ? { accessToken, companyId } : null;
}

export function clearActiveSession(): void {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(companyStorageKey);
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
  const response = await fetch(`${baseerApiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-Baseer-Company-Id": session.companyId,
      ...(options?.headers ?? {}),
    },
  });
  try {
    return await parseBaseerApiResponse<T>(response);
  } catch (error) {
    if (error instanceof BaseerApiError && error.status === 401) clearExpiredSession();
    throw error;
  }
}
