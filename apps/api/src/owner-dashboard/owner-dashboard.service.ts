import { Injectable } from "@nestjs/common";
import { type OwnerFinancialMovementDashboardReceipt } from "@baseer-erp/contracts";

import type { TrustedTenantAdministratorContext } from "../administration/tenant-administration-context.service.js";
import { DatabaseService } from "../database/database.service.js";
import { financialMovementSemantic } from "../finance/financial-movement-classification.js";
import {
  CompanyStatus,
  FinanceCashPerformanceEventKind,
  FinanceJournalEntryStatus,
  Prisma,
} from "../generated/prisma/client.js";

type MovementCode = "SALES" | "PURCHASES" | "EXPENSES" | "RECURRING_EXPENSES" | "PAYROLL" | "EMPLOYEE_ADVANCES" | "FINAL_SETTLEMENTS" | "VAT" | "OTHER_INFLOWS" | "OTHER_OUTFLOWS";

const movementCodes: readonly MovementCode[] = ["SALES", "PURCHASES", "EXPENSES", "RECURRING_EXPENSES", "PAYROLL", "EMPLOYEE_ADVANCES", "FINAL_SETTLEMENTS", "VAT", "OTHER_INFLOWS", "OTHER_OUTFLOWS"];

/**
 * Owner-only cash-movement summary. It reads the same sealed vault lines used
 * by the personal cash-performance report, while intentionally leaving each
 * company in its own functional currency.
 */
@Injectable()
export class OwnerDashboardService {
  constructor(private readonly database: DatabaseService) {}

  async financialMovement(context: TrustedTenantAdministratorContext): Promise<OwnerFinancialMovementDashboardReceipt> {
    // Cash movement is a live owner read. Unlike a daily close snapshot, it
    // must include every sealed posting made today in Riyadh.
    const toBusinessDate = riyadhBusinessDate(new Date());
    const fromBusinessDate = `${toBusinessDate.slice(0, 7)}-01`;
    const from = dateAtUtcStart(fromBusinessDate);
    const to = dateAtUtcStart(toBusinessDate);

    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const companies = await tx.company.findMany({
        where: { tenantId: context.tenantId, status: CompanyStatus.ACTIVE },
        orderBy: [{ nameAr: "asc" }, { id: "asc" }],
        select: { id: true, nameAr: true, nameEn: true, financeProfile: { select: { functionalCurrencyCode: true } } },
      });
      const companyIds = companies.map((company) => company.id);
      if (!companyIds.length) return emptyReceipt(fromBusinessDate, toBusinessDate);

      const vaults = await tx.financeVault.findMany({
        where: { tenantId: context.tenantId, companyId: { in: companyIds } },
        select: { companyId: true, accountId: true },
      });
      const vaultAccountIds = [...new Set(vaults.map((vault) => vault.accountId))];
      const vaultAccountsByCompany = new Map<string, Set<string>>();
      for (const vault of vaults) {
        const accounts = vaultAccountsByCompany.get(vault.companyId) ?? new Set<string>();
        accounts.add(vault.accountId);
        vaultAccountsByCompany.set(vault.companyId, accounts);
      }

      const lines = vaultAccountIds.length ? await tx.financeJournalLine.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: { in: companyIds },
          accountId: { in: vaultAccountIds },
          journalEntry: {
            tenantId: context.tenantId,
            companyId: { in: companyIds },
            isSealed: true,
            status: { in: [FinanceJournalEntryStatus.POSTED, FinanceJournalEntryStatus.REVERSED] },
            businessDate: { gte: from, lte: to },
          },
        },
        select: {
          companyId: true,
          accountId: true,
          debitAmount: true,
          creditAmount: true,
          journalEntry: {
            select: {
              id: true,
              sourceType: true,
              reversalOfEntry: { select: { sourceType: true } },
              lines: { select: { accountId: true } },
            },
          },
        },
      }) : [];
      const journalIds = [...new Set(lines.map((line) => line.journalEntry.id))];
      const events = journalIds.length ? await tx.financeCashPerformanceEvent.findMany({
        where: { tenantId: context.tenantId, companyId: { in: companyIds }, sourceJournalEntryId: { in: journalIds } },
        select: { sourceJournalEntryId: true, sourceId: true, kind: true },
      }) : [];
      const recurringDocuments = events.length ? await tx.financeOutflowDocument.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: { in: companyIds },
          id: { in: events.map((event) => event.sourceId) },
          recurringExpenseProfileId: { not: null },
        },
        select: { id: true },
      }) : [];
      const recurringDocumentIds = new Set(recurringDocuments.map((document) => document.id));
      const eventByJournal = new Map(events.map((event) => [event.sourceJournalEntryId, event]));
      const totalsByCompany = new Map(companies.map((company) => [company.id, initialTotals()]));

      for (const line of lines) {
        const entry = line.journalEntry;
        const companyVaultAccounts = vaultAccountsByCompany.get(line.companyId) ?? new Set<string>();
        const sourceType = entry.reversalOfEntry?.sourceType ?? entry.sourceType;
        if (sourceType === "vault_transfer" || entry.lines.every((candidate) => companyVaultAccounts.has(candidate.accountId))) continue;
        const amount = line.debitAmount.minus(line.creditAmount);
        if (amount.isZero()) continue;
        const event = eventByJournal.get(entry.id);
        // A sealed vault movement must never disappear simply because a new
        // source type has not yet received a named presentation category.
        // Keep it reconciled in an explicit direction-based catch-all, which
        // is the same accounting boundary used by the detailed cash report.
        const code = movementCode(sourceType, event?.kind, Boolean(event && recurringDocumentIds.has(event.sourceId)))
          ?? (amount.gt(0) ? "OTHER_INFLOWS" : "OTHER_OUTFLOWS");
        totalsByCompany.get(line.companyId)![code] = totalsByCompany.get(line.companyId)![code].plus(amount);
      }

      return {
        generatedAt: new Date().toISOString(),
        timezone: "Asia/Riyadh",
        period: { fromBusinessDate, toBusinessDate },
        financialContract: {
          amountBasis: "GROSS_VAT_INCLUSIVE_CASH_MOVEMENT" as const,
          dataAuthority: "BACKEND_SEALED_JOURNAL_VAULT_LINES" as const,
          dataQuality: "SEALED_POSTED_OR_REVERSED_ONLY" as const,
        },
        companies: companies.map((company) => receiptCompany(company, totalsByCompany.get(company.id) ?? initialTotals())),
      };
    });
  }
}

function receiptCompany(company: { id: string; nameAr: string; nameEn: string; financeProfile: { functionalCurrencyCode: string } | null }, totals: Record<MovementCode, Prisma.Decimal>) {
  const sales = totals.SALES;
  const total = movementCodes.reduce((value, code) => value.plus(totals[code]), new Prisma.Decimal(0));
  const currencyCode = company.financeProfile?.functionalCurrencyCode ?? null;
  return {
    companyId: company.id,
    nameAr: company.nameAr,
    nameEn: company.nameEn,
    currencyCode,
    rows: [
      ...movementCodes.map((code) => ({
        code,
        amount: totals[code].toFixed(4),
        amountDisplay: displayMoney(totals[code], currencyCode),
        direction: moneyDirection(totals[code]),
        percentOfSales: sales.gt(0) ? (code === "SALES" ? "100.0000" : totals[code].abs().div(sales).mul(100).toFixed(4)) : null,
        percentOfSalesDisplay: sales.gt(0) ? displayPercent(code === "SALES" ? new Prisma.Decimal(100) : totals[code].abs().div(sales).mul(100)) : null,
      })),
      { code: "TOTAL" as const, amount: total.toFixed(4), amountDisplay: displayMoney(total, currencyCode), direction: moneyDirection(total), percentOfSales: null, percentOfSalesDisplay: null },
    ],
  };
}

function initialTotals(): Record<MovementCode, Prisma.Decimal> {
  return Object.fromEntries(movementCodes.map((code) => [code, new Prisma.Decimal(0)])) as Record<MovementCode, Prisma.Decimal>;
}

/** Canonical English-digit formatting happens beside the sealed source, so a
 * client never needs to parse a monetary decimal to render this receipt. */
function displayMoney(value: Prisma.Decimal, currencyCode: string | null) {
  return currencyCode ? `${groupDecimal(value.toFixed(2))} ${currencyCode}` : "—";
}

function displayPercent(value: Prisma.Decimal) {
  return `${groupDecimal(value.toFixed(1))}%`;
}

function moneyDirection(value: Prisma.Decimal): "INFLOW" | "OUTFLOW" | "NEUTRAL" {
  return value.gt(0) ? "INFLOW" : value.lt(0) ? "OUTFLOW" : "NEUTRAL";
}

function groupDecimal(value: string) {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

function movementCode(sourceType: string, eventKind: FinanceCashPerformanceEventKind | undefined, recurringExpense: boolean): MovementCode | null {
  if (sourceType === "daily_sales_closing") return "SALES";
  if (sourceType === "finance_vat_settlement") return "VAT";
  if (sourceType === "hr_final_settlement_payment") return "FINAL_SETTLEMENTS";
  const semantic = financialMovementSemantic(sourceType);
  if (semantic) return semantic.ownerDashboardCode;
  if (eventKind === FinanceCashPerformanceEventKind.PURCHASE_PAYMENT) return "PURCHASES";
  if (eventKind === FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT) return recurringExpense ? "RECURRING_EXPENSES" : "EXPENSES";
  if (sourceType === "finance_outflow_document") return "EXPENSES";
  return null;
}

function emptyReceipt(fromBusinessDate: string, toBusinessDate: string): OwnerFinancialMovementDashboardReceipt {
  return {
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Riyadh",
    period: { fromBusinessDate, toBusinessDate },
    financialContract: {
      amountBasis: "GROSS_VAT_INCLUSIVE_CASH_MOVEMENT",
      dataAuthority: "BACKEND_SEALED_JOURNAL_VAULT_LINES",
      dataQuality: "SEALED_POSTED_OR_REVERSED_ONLY",
    },
    companies: [],
  };
}

function riyadhBusinessDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const fields = new Map(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${fields.get("year")}-${fields.get("month")}-${fields.get("day")}`;
}

function dateAtUtcStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
