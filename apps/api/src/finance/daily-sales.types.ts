import {
  FinanceDailySalesClosingScope,
  FinanceDailySalesClosingStatus,
} from "../generated/prisma/client.js";

export const DAILY_SALES_SERIAL_SERIES = "DAILY_SALES";

export type DailySalesAllocationInput = Readonly<{
  vaultId: string;
  grossAmount: string;
}>;
export type DailySalesFields = Readonly<{
  businessDate: Date;
  scope: FinanceDailySalesClosingScope;
  customerCount: number;
  allocations: readonly DailySalesAllocationInput[];
  cashHandoverAmount?: string;
  cashHandoverVaultId?: string;
  notes?: string;
}>;
export type CreateDailySalesClosingRequest = DailySalesFields;
export type CreateDailySalesClosingBatchRequest = Readonly<{
  businessDate: Date;
  entries: readonly Omit<CreateDailySalesClosingRequest, "businessDate">[];
}>;
export type CorrectDailySalesClosingRequest = Omit<
  DailySalesFields,
  "businessDate" | "scope"
> &
  Readonly<{ closingId: string }>;
export type ReverseDailySalesClosingRequest = Readonly<{
  closingId: string;
  businessDate: Date;
  reason: string;
}>;
export type DailySalesCommand<TRequest> = Readonly<{
  context: import("../core-controls/trusted-context.js").TrustedCompanyActorContext;
  idempotencyKey: string;
  request: TRequest;
}>;
export type DailySalesClosingPreview = Readonly<{
  grossAmount: string;
  netAmount: string;
  vatAmount: string;
  vatRateBasisPoints: number;
}>;
export type DailySalesClosingReceipt = Readonly<{
  closingId: string;
  documentNumber: string;
  businessDate: Date;
  scope: FinanceDailySalesClosingScope;
  postingVersion: number;
  journalEntryId: string;
  grossAmount: string;
  netAmount: string;
  vatAmount: string;
  vatRateBasisPoints: number;
  customerCount: number;
  cashHandoverAmount: string | null;
  cashHandoverVaultId: string | null;
  status: FinanceDailySalesClosingStatus;
  allocations: readonly DailySalesAllocationInput[];
}>;
export type DailySalesClosingBatchReceipt = Readonly<{
  closings: readonly DailySalesClosingReceipt[];
}>;
export type DailySalesClosingReversalReceipt = Readonly<{
  closingId: string;
  documentNumber: string;
  originalJournalEntryId: string;
  reversalJournalEntryId: string;
  status: "REVERSED";
}>;
