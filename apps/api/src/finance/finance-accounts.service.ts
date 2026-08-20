import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { BusinessDateService } from "../business-date/business-date.service.js";
import { financeJournalPresentation } from "./finance-journal-presentation.js";

type AccountInput = { from?: Date; to?: Date; q?: string };
type MovementInput = AccountInput & { cursor?: string; pageSize: number };
type Amounts = { balanceDebit: Prisma.Decimal; balanceCredit: Prisma.Decimal; periodDebit: Prisma.Decimal; periodCredit: Prisma.Decimal };

/**
 * Read-only chart-of-accounts drill-down. The journal remains the financial
 * source of truth; account totals come from the daily projection and every
 * movement remains linked to its original immutable journal entry.
 */
@Injectable()
export class FinanceAccountsService {
  constructor(private readonly db: DatabaseService, private readonly dates: BusinessDateService) {}

  async workspace(context: TrustedCompanyActorContext, input: AccountInput) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const businessDate = await this.dates.resolveInTransaction(tx, context, { kind: "current" });
      const asOf = capAsOf(input.to, dateForBusinessDate(businessDate.businessDate));
      const periodTo = input.to ? capAsOf(input.to, asOf) : undefined;
      const accounts = await tx.financeAccount.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          ...(input.q ? { OR: [{ code: { contains: input.q, mode: "insensitive" } }, { nameAr: { contains: input.q, mode: "insensitive" } }, { nameEn: { contains: input.q, mode: "insensitive" } }] } : {}),
        },
        orderBy: [{ type: "asc" }, { code: "asc" }],
        take: 500,
        select: accountSelect,
      });
      const amounts = await this.amountsForAccounts(tx, context, accounts.map((account) => account.id), input.from, periodTo, asOf);
      return {
        companyId: context.companyId,
        asOfBusinessDate: dateValue(asOf),
        fromBusinessDate: input.from ? dateValue(input.from) : null,
        toBusinessDate: periodTo ? dateValue(periodTo) : null,
        accounts: accounts.map((account) => accountReceipt(account, amounts.get(account.id) ?? zeroAmounts())),
      };
    });
  }

  async movements(context: TrustedCompanyActorContext, accountId: string, input: MovementInput) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const businessDate = await this.dates.resolveInTransaction(tx, context, { kind: "current" });
      const asOf = capAsOf(input.to, dateForBusinessDate(businessDate.businessDate));
      const periodTo = input.to ? capAsOf(input.to, asOf) : undefined;
      const account = await tx.financeAccount.findFirst({ where: { id: accountId, tenantId: context.tenantId, companyId: context.companyId }, select: accountSelect });
      if (!account) throw new NotFoundException("The financial account was not found for this company.");
      const amount = (await this.amountsForAccounts(tx, context, [account.id], input.from, periodTo, asOf)).get(account.id) ?? zeroAmounts();
      const period = dateFilter(input.from, periodTo);
      const baseWhere: Prisma.FinanceJournalLineWhereInput = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        accountId,
        ...(period ? { businessDate: period } : {}),
        journalEntry: { is: { status: { in: ["POSTED", "REVERSED"] } } },
      };
      const cursor = input.cursor ? await tx.financeJournalLine.findFirst({
        where: { ...baseWhere, id: input.cursor },
        select: { id: true, businessDate: true, createdAt: true, lineNumber: true },
      }) : null;
      if (input.cursor && !cursor) throw new BadRequestException("The account movement cursor is no longer available.");
      const lines = await tx.financeJournalLine.findMany({
        where: cursor ? {
          ...baseWhere,
          OR: [
            { businessDate: { lt: cursor.businessDate } },
            { businessDate: cursor.businessDate, createdAt: { lt: cursor.createdAt } },
            { businessDate: cursor.businessDate, createdAt: cursor.createdAt, lineNumber: { lt: cursor.lineNumber } },
            { businessDate: cursor.businessDate, createdAt: cursor.createdAt, lineNumber: cursor.lineNumber, id: { lt: cursor.id } },
          ],
        } : baseWhere,
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }, { lineNumber: "desc" }, { id: "desc" }],
        take: input.pageSize + 1,
        select: { id: true, debitAmount: true, creditAmount: true, description: true, journalEntry: { select: journalPresentationSelect } },
      });
      const page = lines.slice(0, input.pageSize);
      const items = page.map((line) => {
        const display = financeJournalPresentation(line.journalEntry);
        return {
        id: line.id,
        journalEntryId: line.journalEntry.id,
        businessDate: dateValue(line.journalEntry.businessDate),
        sourceType: line.journalEntry.sourceType,
        sourceReference: line.journalEntry.sourceReference,
        displayLabelAr: display.labelAr,
        displayLabelEn: display.labelEn,
        displayReference: display.reference,
        description: line.description ?? line.journalEntry.description,
        debitAmount: line.debitAmount.toFixed(4),
        creditAmount: line.creditAmount.toFixed(4),
      }; });
      return {
        account: accountReceipt(account, amount),
        asOfBusinessDate: dateValue(asOf),
        fromBusinessDate: input.from ? dateValue(input.from) : null,
        toBusinessDate: periodTo ? dateValue(periodTo) : null,
        summary: amountReceipt(amount),
        items,
        nextCursor: lines.length > input.pageSize ? items.at(-1)?.id ?? null : null,
      };
    });
  }

  async journalEntry(context: TrustedCompanyActorContext, journalEntryId: string) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const entry = await tx.financeJournalEntry.findFirst({
        where: { id: journalEntryId, tenantId: context.tenantId, companyId: context.companyId },
        select: {
          ...journalPresentationSelect,
          reversalEntry: { select: { id: true } },
          lines: { orderBy: { lineNumber: "asc" }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, description: true, account: { select: { code: true, nameAr: true, nameEn: true } } } },
        },
      });
      if (!entry) throw new NotFoundException("The journal entry was not found for this company.");
      const display = financeJournalPresentation(entry);
      return {
        id: entry.id, sourceType: entry.sourceType, sourceReference: entry.sourceReference, businessDate: dateValue(entry.businessDate),
        displayLabelAr: display.labelAr, displayLabelEn: display.labelEn, displayReference: display.reference,
        description: entry.description, status: entry.status, postedAt: entry.postedAt, reversalOfEntryId: entry.reversalOfEntryId,
        reversalEntryId: entry.reversalEntry?.id ?? null,
        lines: entry.lines.map((line) => ({ id: line.id, lineNumber: line.lineNumber, accountCode: line.account.code, accountNameAr: line.account.nameAr, accountNameEn: line.account.nameEn, debitAmount: line.debitAmount.toFixed(4), creditAmount: line.creditAmount.toFixed(4), description: line.description })),
      };
    });
  }

  private async amountsForAccounts(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, accountIds: string[], from: Date | undefined, to: Date | undefined, asOf: Date) {
    const amounts = new Map<string, Amounts>(accountIds.map((id) => [id, zeroAmounts()]));
    if (!accountIds.length) return amounts;
    const common = { tenantId: context.tenantId, companyId: context.companyId, accountId: { in: accountIds } };
    const currentMonth = monthStart(asOf);
    const [monthlyBalanceGroups, currentMonthBalanceGroups, periodGroups] = await Promise.all([
      tx.financeAccountMonthlyBalance.groupBy({ by: ["accountId"], where: { ...common, monthStart: { lt: currentMonth } }, _sum: { debitAmount: true, creditAmount: true } }),
      tx.financeAccountDailyBalance.groupBy({ by: ["accountId"], where: { ...common, businessDate: { gte: currentMonth, lte: asOf } }, _sum: { debitAmount: true, creditAmount: true } }),
      tx.financeAccountDailyBalance.groupBy({ by: ["accountId"], where: { ...common, ...(dateFilter(from, to) ? { businessDate: dateFilter(from, to)! } : {}) }, _sum: { debitAmount: true, creditAmount: true } }),
    ]);
    for (const group of [...monthlyBalanceGroups, ...currentMonthBalanceGroups]) {
      const value = amounts.get(group.accountId); if (!value) continue;
      value.balanceDebit = value.balanceDebit.plus(decimal(group._sum.debitAmount)); value.balanceCredit = value.balanceCredit.plus(decimal(group._sum.creditAmount));
    }
    for (const group of periodGroups) {
      const value = amounts.get(group.accountId); if (!value) continue;
      value.periodDebit = decimal(group._sum.debitAmount); value.periodCredit = decimal(group._sum.creditAmount);
    }
    return amounts;
  }
}

const accountSelect = { id: true, code: true, nameAr: true, nameEn: true, type: true, status: true, isSystem: true } satisfies Prisma.FinanceAccountSelect;
const journalPresentationSelect = {
  id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, status: true, postedAt: true, reversalOfEntryId: true,
  hrPayrollAccrual: { select: { runNumber: true } },
  hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
  hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
  hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
  hrFinalSettlementAccrual: { select: { settlementNumber: true } },
  hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
  reversalOfEntry: { select: {
    sourceType: true, sourceReference: true, description: true,
    hrPayrollAccrual: { select: { runNumber: true } },
    hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
    hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
    hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
    hrFinalSettlementAccrual: { select: { settlementNumber: true } },
    hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
  } },
} satisfies Prisma.FinanceJournalEntrySelect;
function accountReceipt(account: Prisma.FinanceAccountGetPayload<{ select: typeof accountSelect }>, amounts: Amounts) { return { ...account, ...amountReceipt(amounts) }; }
function amountReceipt(amounts: Amounts) { return { balanceDebit: amounts.balanceDebit.toFixed(4), balanceCredit: amounts.balanceCredit.toFixed(4), periodDebit: amounts.periodDebit.toFixed(4), periodCredit: amounts.periodCredit.toFixed(4) }; }
function zeroAmounts(): Amounts { return { balanceDebit: new Prisma.Decimal(0), balanceCredit: new Prisma.Decimal(0), periodDebit: new Prisma.Decimal(0), periodCredit: new Prisma.Decimal(0) }; }
function decimal(value: Prisma.Decimal | number | string | null | undefined) { return new Prisma.Decimal(value ?? 0); }
function dateFilter(from?: Date, to?: Date) { return !from && !to ? undefined : { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }; }
function dateForBusinessDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function capAsOf(requested: Date | undefined, current: Date) { return requested && requested < current ? requested : current; }
function dateValue(value: Date) { return value.toISOString().slice(0, 10); }
function monthStart(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)); }
