import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, FinanceVaultReconciliationKind, FinanceVaultReconciliationStatus, FinanceVaultStatus, FinanceVaultType } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { IdempotencyPayloadMismatchError, IdempotencyService } from "../core-controls/idempotency.service.js";
import { DocumentSerialService, type SqlDate } from "../core-controls/document-serial.service.js";
import { JournalPostingService } from "./journal/journal-posting.service.js";
import { FinanceVaultService } from "./finance-vault.service.js";
import { RequestContext } from "../observability/request-context.js";
import { BusinessDateService } from "../business-date/business-date.service.js";
import { financeJournalPresentation } from "./finance-journal-presentation.js";

type TreasuryInput = { from?: Date; to?: Date; businessMonths?: readonly string[]; includeArchived: boolean };
type ActivityInput = { from?: Date; to?: Date; businessMonths?: readonly string[]; cursor?: string; pageSize: number };
type ReconciliationInput = { vaultId: string; kind: FinanceVaultReconciliationKind; asOfBusinessDate: Date; observedBalance: string; referenceNumber?: string; notes?: string; idempotencyKey: string };
type ReconciliationsInput = { vaultId?: string; kind?: FinanceVaultReconciliationKind; cursor?: string; pageSize: number };
type VaultRecord = { id: string; nameAr: string; nameEn: string; type: "CASH" | "BANK" | "APP"; paymentMethod: "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP"; paymentMethods: ("CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP")[]; status: FinanceVaultStatus; isSalesChannel: boolean; isPaymentDestination: boolean; sortOrder: number; accountId: string };
type Amounts = { openingBalance: Prisma.Decimal; balanceAsOf: Prisma.Decimal; inflow: Prisma.Decimal; outflow: Prisma.Decimal };

@Injectable()
export class TreasuryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly idem: IdempotencyService,
    private readonly serials: DocumentSerialService,
    private readonly journals: JournalPostingService,
    private readonly vaults: FinanceVaultService,
    private readonly dates: BusinessDateService,
  ) {}

  /**
   * Treasury is the sole read model for cash and bank positions. Its balances
   * and movement totals are derived from the sealed accounting journal; it
   * does not create a parallel financial truth. The financial register shows
   * source events and journal evidence, not vault balances.
   */
  async workspace(context: TrustedCompanyActorContext, input: TreasuryInput) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const businessDate = await this.dates.currentForTrustedContext(context);
      const asOf = capAsOfDate(input.to, dateForBusinessDate(businessDate.businessDate));
      const vaults = await tx.financeVault.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, ...(input.includeArchived ? {} : { status: FinanceVaultStatus.ACTIVE }) },
        orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
        select: { id: true, nameAr: true, nameEn: true, type: true, paymentMethod: true, paymentMethods: true, status: true, isSalesChannel: true, isPaymentDestination: true, sortOrder: true, accountId: true },
      });
      const amounts = await this.amountsForVaults(tx, context, vaults, input.from, input.to, asOf, input.businessMonths);
      const mapped = vaults.map((vault) => this.vaultReceipt(vault, amounts.get(vault.id) ?? zeroAmounts()));
      const groupVaults = {
        COLLECTION_CHANNELS: mapped.filter((vault) => vault.status === "ACTIVE" && vault.isSalesChannel),
        OTHER_VAULTS: mapped.filter((vault) => vault.status === "ACTIVE" && !vault.isSalesChannel),
        ARCHIVED: mapped.filter((vault) => vault.status === "ARCHIVED"),
      } as const;
      const groups = (Object.entries(groupVaults) as Array<["COLLECTION_CHANNELS" | "OTHER_VAULTS" | "ARCHIVED", typeof mapped]>).map(([key, items]) => ({
        key,
        count: items.length,
        openingBalance: sum(items, "openingBalance"),
        balanceAsOf: sum(items, "balanceAsOf"),
        inflow: sum(items, "inflow"),
        outflow: sum(items, "outflow"),
      }));
      const summary = {
        openingBalance: sum(mapped, "openingBalance"),
        balanceAsOf: sum(mapped, "balanceAsOf"),
        inflow: sum(mapped, "inflow"),
        outflow: sum(mapped, "outflow"),
      };
      return {
        companyId: context.companyId,
        businessDate: businessDate.businessDate,
        asOfBusinessDate: businessDateValue(asOf),
        fromBusinessDate: input.from ? businessDateValue(input.from) : null,
        toBusinessDate: input.to ? businessDateValue(input.to) : null,
        summary: { ...summary, net: decimal(summary.inflow).minus(summary.outflow).toFixed(4) },
        groups,
        vaults: mapped,
      };
    });
  }

  async activity(context: TrustedCompanyActorContext, vaultId: string, input: ActivityInput) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const businessDate = await this.dates.currentForTrustedContext(context);
      const asOf = capAsOfDate(input.to, dateForBusinessDate(businessDate.businessDate));
      const vault = await tx.financeVault.findFirst({
        where: { id: vaultId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, nameAr: true, nameEn: true, type: true, paymentMethod: true, paymentMethods: true, status: true, isSalesChannel: true, isPaymentDestination: true, sortOrder: true, accountId: true },
      });
      if (!vault) throw new NotFoundException("The company vault was not found.");
      const amounts = await this.amountsForVaults(tx, context, [vault], input.from, input.to, asOf, input.businessMonths);
      const amount = amounts.get(vault.id) ?? zeroAmounts();
      const period = journalPeriodWhere(input.from, input.to, input.businessMonths);
      const baseWhere: Prisma.FinanceJournalLineWhereInput = {
          tenantId: context.tenantId,
          companyId: context.companyId,
          accountId: vault.accountId,
          ...(period ? { AND: [period] } : {}),
          journalEntry: { is: { status: { in: ["POSTED", "REVERSED"] } } },
        };
      const cursor = input.cursor
        ? await tx.financeJournalLine.findFirst({
            where: { ...baseWhere, id: input.cursor },
            select: { id: true, businessDate: true, createdAt: true, lineNumber: true },
          })
        : null;
      if (input.cursor && !cursor)
        throw new BadRequestException("The vault activity cursor is no longer valid.");
      const lines = await tx.financeJournalLine.findMany({
        where: cursor
          ? {
              ...baseWhere,
              AND: [
                ...(period ? [period] : []),
                { OR: [
                { businessDate: { lt: cursor.businessDate } },
                { businessDate: cursor.businessDate, createdAt: { lt: cursor.createdAt } },
                { businessDate: cursor.businessDate, createdAt: cursor.createdAt, lineNumber: { lt: cursor.lineNumber } },
                { businessDate: cursor.businessDate, createdAt: cursor.createdAt, lineNumber: cursor.lineNumber, id: { lt: cursor.id } },
                ] },
              ],
            }
          : baseWhere,
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }, { lineNumber: "desc" }, { id: "desc" }],
        take: input.pageSize + 1,
        select: {
          id: true,
          debitAmount: true,
          creditAmount: true,
          journalEntry: {
            select: {
              id: true,
              businessDate: true,
              sourceType: true,
              sourceReference: true,
              description: true,
              hrPayrollAccrual: { select: { runNumber: true } },
              hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
              hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
              hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
              hrFinalSettlementAccrual: { select: { settlementNumber: true } },
              hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
              dailySalesClosing: { select: { documentNumber: true } },
              vatSettlement: { select: { referenceNumber: true } },
              reversalOfEntry: { select: {
                sourceType: true, sourceReference: true, description: true,
                hrPayrollAccrual: { select: { runNumber: true } },
                hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
                hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
                hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
                hrFinalSettlementAccrual: { select: { settlementNumber: true } },
                hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
                dailySalesClosing: { select: { documentNumber: true } },
                vatSettlement: { select: { referenceNumber: true } },
              } },
              lines: {
                where: { accountId: { not: vault.accountId } },
                orderBy: { lineNumber: "asc" },
                select: { account: { select: { nameAr: true, nameEn: true } } },
              },
            },
          },
        },
      });
      const hasMore = lines.length > input.pageSize;
      const items = lines.slice(0, input.pageSize).map((line) => {
        const counterparts = line.journalEntry.lines.map((counterpart) => counterpart.account);
        const display = financeJournalPresentation(line.journalEntry);
        return {
          id: line.id,
          journalEntryId: line.journalEntry.id,
          businessDate: businessDateValue(line.journalEntry.businessDate),
          sourceType: line.journalEntry.sourceType,
          sourceReference: display.reference,
          description: line.journalEntry.description,
          counterpartNameAr: counterpartLabel(counterparts.map((account) => account.nameAr), "أخرى"),
          counterpartNameEn: counterpartLabel(counterparts.map((account) => account.nameEn), "others"),
          inflow: line.debitAmount.toFixed(4),
          outflow: line.creditAmount.toFixed(4),
        };
      });
      return {
        vault: this.vaultReceipt(vault, amount),
        asOfBusinessDate: businessDateValue(asOf),
        fromBusinessDate: input.from ? businessDateValue(input.from) : null,
        toBusinessDate: input.to ? businessDateValue(input.to) : null,
        summary: { openingBalance: amount.openingBalance.toFixed(4), balanceAsOf: amount.balanceAsOf.toFixed(4), inflow: amount.inflow.toFixed(4), outflow: amount.outflow.toFixed(4), net: amount.inflow.minus(amount.outflow).toFixed(4) },
        items,
        nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      };
    });
  }

  private async amountsForVaults(
    tx: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    vaults: VaultRecord[],
    from: Date | undefined,
    to: Date | undefined,
    asOf: Date,
    businessMonths: readonly string[] | undefined,
  ) {
    const results = new Map<string, Amounts>();
    for (const vault of vaults) results.set(vault.id, zeroAmounts());
    if (!vaults.length) return results;
    const accountIds = vaults.map((vault) => vault.accountId);
    const accountToVault = new Map(vaults.map((vault) => [vault.accountId, vault.id]));
    const common = { tenantId: context.tenantId, companyId: context.companyId, accountId: { in: accountIds } };
    const currentMonth = monthStart(asOf);
    const period = dailyPeriodWhere(from, to, businessMonths);
    const periodStart = earliestPeriodStart(from, businessMonths);
    const openingMonth = periodStart ? monthStart(periodStart) : null;
    const openingDate = periodStart ? previousDay(periodStart) : null;
    const [monthlyBalanceGroups, currentMonthBalanceGroups, periodGroups, openingMonthlyGroups, openingDailyGroups] = await Promise.all([
      tx.financeAccountMonthlyBalance.groupBy({
        by: ["accountId"],
        where: { ...common, monthStart: { lt: currentMonth } },
        _sum: { debitAmount: true, creditAmount: true },
      }),
      tx.financeAccountDailyBalance.groupBy({
        by: ["accountId"],
        where: { ...common, businessDate: { gte: currentMonth, lte: asOf } },
        _sum: { debitAmount: true, creditAmount: true },
      }),
      tx.financeAccountDailyBalance.groupBy({
        by: ["accountId"],
        where: { ...common, ...(period ? { AND: [period] } : {}) },
        _sum: { debitAmount: true, creditAmount: true },
      }),
      openingMonth
        ? tx.financeAccountMonthlyBalance.groupBy({
            by: ["accountId"],
            where: { ...common, monthStart: { lt: openingMonth } },
            _sum: { debitAmount: true, creditAmount: true },
          })
        : Promise.resolve([]),
      openingMonth && openingDate
        ? tx.financeAccountDailyBalance.groupBy({
            by: ["accountId"],
            where: { ...common, businessDate: { gte: openingMonth, lte: openingDate } },
            _sum: { debitAmount: true, creditAmount: true },
          })
        : Promise.resolve([]),
    ]);
    for (const group of [...monthlyBalanceGroups, ...currentMonthBalanceGroups]) {
      const vaultId = accountToVault.get(group.accountId);
      if (!vaultId) continue;
      results.get(vaultId)!.balanceAsOf = results.get(vaultId)!.balanceAsOf.plus(decimal(group._sum.debitAmount)).minus(decimal(group._sum.creditAmount));
    }
    for (const group of periodGroups) {
      const vaultId = accountToVault.get(group.accountId);
      if (!vaultId) continue;
      const target = results.get(vaultId)!;
      target.inflow = decimal(group._sum.debitAmount);
      target.outflow = decimal(group._sum.creditAmount);
    }
    for (const group of [...openingMonthlyGroups, ...openingDailyGroups]) {
      const vaultId = accountToVault.get(group.accountId);
      if (!vaultId) continue;
      results.get(vaultId)!.openingBalance = results.get(vaultId)!.openingBalance
        .plus(decimal(group._sum.debitAmount))
        .minus(decimal(group._sum.creditAmount));
    }
    return results;
  }

  private vaultReceipt(vault: VaultRecord, amounts: Amounts) {
    return {
      id: vault.id,
      nameAr: vault.nameAr,
      nameEn: vault.nameEn,
      type: vault.type,
      paymentMethod: vault.paymentMethod,
      paymentMethods: vault.paymentMethods,
      status: vault.status,
      isSalesChannel: vault.isSalesChannel,
      isPaymentDestination: vault.isPaymentDestination,
      sortOrder: vault.sortOrder,
      openingBalance: amounts.openingBalance.toFixed(4),
      balanceAsOf: amounts.balanceAsOf.toFixed(4),
      inflow: amounts.inflow.toFixed(4),
      outflow: amounts.outflow.toFixed(4),
      net: amounts.inflow.minus(amounts.outflow).toFixed(4),
    };
  }

  async transfer(context: TrustedCompanyActorContext, input: { fromVaultId: string; toVaultId: string; amount: string; businessDate: Date; notes?: string; idempotencyKey: string }) {
    if (input.fromVaultId === input.toVaultId) throw new BadRequestException("Source and destination vaults must differ.");
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isFinite() || amount.lte(0)) throw new BadRequestException("Transfer amount must be positive.");
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.idem.beginInTransaction(tx, context, { operation: "finance.vault.transfer", key: input.idempotencyKey, request: { ...input, businessDate: input.businessDate.toISOString().slice(0, 10) }, expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === "replay") return begun.response.body as { transferReference: string; journalEntryId: string; fromVaultId: string; toVaultId: string; amount: string };
      if (begun.kind === "in-progress") throw new ConflictException("The vault transfer is still in progress.");
      const [from, to] = await Promise.all([
        this.vaults.assertActiveVault(tx, { tenantId: context.tenantId, companyId: context.companyId, vaultId: input.fromVaultId }),
        this.vaults.assertActiveVault(tx, { tenantId: context.tenantId, companyId: context.companyId, vaultId: input.toVaultId }),
      ]);
      // The journal keeps this immutable reference.  It must be a business
      // document number, never the internal UUID used for tracing/auditing.
      const businessDate = businessDateValue(input.businessDate) as SqlDate;
      const sequence = await this.serials.reserveInTransaction(tx, context, {
        series: "VAULT_TRANSFER",
        businessDate,
      });
      const transferReference = `VTR-${businessDate.replaceAll("-", "")}-${sequence.toString().padStart(4, "0")}`;
      const requestId = RequestContext.correlationId() ?? randomUUID();
      const posted = await this.journals.postInTransaction(tx, {
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        requestId,
        sourceType: "vault_transfer",
        sourceReference: transferReference,
        businessDate: input.businessDate,
        description: input.notes || "Vault transfer",
        lines: [{ accountId: to.accountId, debitAmount: amount.toFixed(4) }, { accountId: from.accountId, creditAmount: amount.toFixed(4) }],
      });
      const receipt = { transferReference, journalEntryId: posted.journalEntryId, fromVaultId: from.id, toVaultId: to.id, amount: amount.toFixed(4) };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "finance.vault.transferred", entityType: "FinanceVaultTransfer", entityId: transferReference, requestId, afterJson: receipt as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => {
      if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was used with different transfer data.");
      throw error;
    });
  }

  /** A vault transfer is a journal-backed movement. It is corrected only by
   * reversing that source journal; balances are never edited directly. */
  async reverseTransfer(context: TrustedCompanyActorContext, input: { journalEntryId: string; businessDate: Date; reason: string; idempotencyKey: string }) {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('A vault-transfer reversal reason is required.');
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idem.beginInTransaction(tx, context, {
        operation: 'finance.vault.transfer.reverse', key: input.idempotencyKey,
        request: { journalEntryId: input.journalEntryId, businessDate: input.businessDate.toISOString().slice(0, 10), reason },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === 'replay') return begun.response.body as { originalJournalEntryId: string; reversalJournalEntryId: string; businessDate: string };
      if (begun.kind === 'in-progress') throw new ConflictException('The vault-transfer reversal is still in progress.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:vault-transfer-reversal:${input.journalEntryId}`}, 0))`;
      const original = await tx.financeJournalEntry.findFirst({
        where: { id: input.journalEntryId, tenantId: context.tenantId, companyId: context.companyId, sourceType: 'vault_transfer', status: 'POSTED' },
        select: { id: true, businessDate: true, reversalEntry: { select: { id: true } } },
      });
      if (!original) throw new NotFoundException('The posted vault transfer was not found for this company.');
      if (original.reversalEntry) throw new ConflictException('The vault transfer has already been reversed.');
      if (input.businessDate < original.businessDate) throw new BadRequestException('A vault-transfer reversal cannot predate the original transfer.');
      const journal = await this.journals.reverseInTransaction(tx, { ...context, requestId: `vault-transfer-reversal:${original.id}`, journalEntryId: original.id, businessDate: input.businessDate, reason });
      const receipt = { originalJournalEntryId: original.id, reversalJournalEntryId: journal.journalEntryId, businessDate: businessDateValue(input.businessDate) };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'finance.vault.transfer_reversed', entityType: 'FinanceJournalEntry', entityId: original.id, requestId: `vault-transfer-reversal:${original.id}`, afterJson: { ...receipt, reason } as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => {
      if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different vault-transfer reversal data.');
      throw error;
    });
  }

  /**
   * Reconciliation is evidence, not an adjustment. The ledger balance is
   * snapshotted server-side and any variance remains an exception until a
   * separately authorized source document explains it.
   */
  async reconcile(context: TrustedCompanyActorContext, input: ReconciliationInput) {
    const referenceNumber = input.referenceNumber?.trim() || undefined;
    const notes = input.notes?.trim() || undefined;
    const observedBalance = signedDecimal(input.observedBalance, 'Observed balance must be a decimal amount with at most four places.');
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idem.beginInTransaction(tx, context, {
        operation: 'finance.vault.reconcile', key: input.idempotencyKey,
        request: { vaultId: input.vaultId, kind: input.kind, asOfBusinessDate: businessDateValue(input.asOfBusinessDate), observedBalance: observedBalance.toFixed(4), referenceNumber: referenceNumber ?? null, notes: notes ?? null },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === 'replay') return restoreReconciliation(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The treasury control record is still being processed.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.asOfBusinessDate);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:vault-reconciliation:${input.vaultId}:${input.kind}:${businessDateValue(input.asOfBusinessDate)}`}, 0))`;
      const expectedType = input.kind === FinanceVaultReconciliationKind.BANK_RECONCILIATION ? FinanceVaultType.BANK : FinanceVaultType.CASH;
      const vault = await tx.financeVault.findFirst({
        where: { id: input.vaultId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceVaultStatus.ACTIVE, type: expectedType },
        select: { id: true, accountId: true, nameAr: true, nameEn: true, type: true },
      });
      if (!vault) throw new BadRequestException(input.kind === FinanceVaultReconciliationKind.BANK_RECONCILIATION ? 'Choose an active bank vault for a bank reconciliation.' : 'Choose an active cash vault for a cash count.');
      if (input.kind === FinanceVaultReconciliationKind.BANK_RECONCILIATION && !referenceNumber) throw new BadRequestException('A bank statement reference is required for bank reconciliation.');
      if (input.kind === FinanceVaultReconciliationKind.CASH_COUNT && observedBalance.isNegative()) throw new BadRequestException('A physical cash count cannot be negative.');
      const total = await tx.financeAccountDailyBalance.aggregate({
        where: { tenantId: context.tenantId, companyId: context.companyId, accountId: vault.accountId, businessDate: { lte: input.asOfBusinessDate } },
        _sum: { debitAmount: true, creditAmount: true },
      });
      const ledgerBalance = decimal(total._sum.debitAmount).minus(decimal(total._sum.creditAmount));
      const differenceAmount = observedBalance.minus(ledgerBalance);
      if (!differenceAmount.isZero() && !notes) throw new BadRequestException('A variance explanation is required when the observed balance differs from the ledger.');
      const status = differenceAmount.isZero() ? FinanceVaultReconciliationStatus.MATCHED : FinanceVaultReconciliationStatus.VARIANCE;
      const id = randomUUID();
      try {
        await tx.financeVaultReconciliation.create({ data: {
          id, tenantId: context.tenantId, companyId: context.companyId, vaultId: vault.id, kind: input.kind, asOfBusinessDate: input.asOfBusinessDate,
          ledgerBalance, observedBalance, differenceAmount, status, referenceNumber: referenceNumber ?? null, notes: notes ?? null, createdByUserId: context.actorUserId,
        } });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A bank reconciliation or cash count already exists for this vault and date.');
        throw error;
      }
      const receipt: TreasuryReconciliationReceipt = { id, vaultId: vault.id, vaultNameAr: vault.nameAr, vaultNameEn: vault.nameEn, kind: input.kind, asOfBusinessDate: businessDateValue(input.asOfBusinessDate), ledgerBalance: ledgerBalance.toFixed(4), observedBalance: observedBalance.toFixed(4), differenceAmount: differenceAmount.toFixed(4), status, referenceNumber: referenceNumber ?? null, notes: notes ?? null, createdAt: new Date() };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'finance.vault.reconciliation_recorded', entityType: 'FinanceVaultReconciliation', entityId: id, requestId: `vault-reconciliation:${id}`, afterJson: storeReconciliation(receipt) as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: storeReconciliation(receipt) } });
      return receipt;
    }).catch((error) => {
      if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different reconciliation data.');
      throw error;
    });
  }

  async reconciliations(context: TrustedCompanyActorContext, input: ReconciliationsInput) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const baseWhere: Prisma.FinanceVaultReconciliationWhereInput = {
        tenantId: context.tenantId, companyId: context.companyId,
        ...(input.vaultId ? { vaultId: input.vaultId } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      };
      const cursor = input.cursor ? await tx.financeVaultReconciliation.findFirst({ where: { ...baseWhere, id: input.cursor }, select: { id: true, asOfBusinessDate: true } }) : null;
      if (input.cursor && !cursor) throw new BadRequestException('The treasury-control page cursor is no longer available.');
      const rows = await tx.financeVaultReconciliation.findMany({
        where: cursor ? { ...baseWhere, OR: [{ asOfBusinessDate: { lt: cursor.asOfBusinessDate } }, { asOfBusinessDate: cursor.asOfBusinessDate, id: { lt: cursor.id } }] } : baseWhere,
        orderBy: [{ asOfBusinessDate: 'desc' }, { id: 'desc' }], take: input.pageSize + 1,
        select: { id: true, kind: true, asOfBusinessDate: true, ledgerBalance: true, observedBalance: true, differenceAmount: true, status: true, referenceNumber: true, notes: true, createdAt: true, vault: { select: { id: true, nameAr: true, nameEn: true } } },
      });
      const hasMore = rows.length > input.pageSize;
      const page = rows.slice(0, input.pageSize);
      return { companyId: context.companyId, items: page.map((row) => ({ id: row.id, vaultId: row.vault.id, vaultNameAr: row.vault.nameAr, vaultNameEn: row.vault.nameEn, kind: row.kind, asOfBusinessDate: businessDateValue(row.asOfBusinessDate), ledgerBalance: row.ledgerBalance.toFixed(4), observedBalance: row.observedBalance.toFixed(4), differenceAmount: row.differenceAmount.toFixed(4), status: row.status, referenceNumber: row.referenceNumber, notes: row.notes, createdAt: row.createdAt })), nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
    });
  }
}

function counterpartLabel(names: readonly string[], remainingLabel: string) {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return null;
  if (unique.length <= 2) return unique.join(" + ");
  return `${unique.slice(0, 2).join(" + ")} + ${unique.length - 2} ${remainingLabel}`;
}

type TreasuryReconciliationReceipt = { id: string; vaultId: string; vaultNameAr: string; vaultNameEn: string; kind: FinanceVaultReconciliationKind; asOfBusinessDate: string; ledgerBalance: string; observedBalance: string; differenceAmount: string; status: FinanceVaultReconciliationStatus; referenceNumber: string | null; notes: string | null; createdAt: Date };
type StoredTreasuryReconciliationReceipt = Omit<TreasuryReconciliationReceipt, 'createdAt'> & { createdAt: string };

function dateFilter(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}
function monthDateRanges(months: readonly string[] | undefined) { return (months ?? []).map((month) => { const [year, number] = month.split("-").map(Number); const start = new Date(Date.UTC(year!, number! - 1, 1)); return { gte: start, lte: new Date(Date.UTC(year!, number!, 0)) }; }); }
function journalPeriodWhere(from: Date | undefined, to: Date | undefined, months: readonly string[] | undefined): Prisma.FinanceJournalLineWhereInput | undefined { const ranges = monthDateRanges(months); return ranges.length ? { OR: ranges.map((businessDate) => ({ businessDate })) } : dateFilter(from, to) ? { businessDate: dateFilter(from, to)! } : undefined; }
function dailyPeriodWhere(from: Date | undefined, to: Date | undefined, months: readonly string[] | undefined): Prisma.FinanceAccountDailyBalanceWhereInput | undefined { const ranges = monthDateRanges(months); return ranges.length ? { OR: ranges.map((businessDate) => ({ businessDate })) } : dateFilter(from, to) ? { businessDate: dateFilter(from, to)! } : undefined; }
function decimal(value: Prisma.Decimal | number | string | null | undefined) { return new Prisma.Decimal(value === null || value === undefined ? 0 : value); }
function signedDecimal(value: string, message: string) { let amount: Prisma.Decimal; try { amount = new Prisma.Decimal(value); } catch { throw new BadRequestException(message); } if (!amount.isFinite() || (amount.decimalPlaces() ?? 0) > 4 || amount.abs().gt('99999999999999.9999')) throw new BadRequestException(message); return amount; }
function storeReconciliation(value: TreasuryReconciliationReceipt): StoredTreasuryReconciliationReceipt { return { ...value, createdAt: value.createdAt.toISOString() }; }
function restoreReconciliation(value: unknown): TreasuryReconciliationReceipt { const stored = value as StoredTreasuryReconciliationReceipt; return { ...stored, createdAt: new Date(stored.createdAt) }; }
function dateForBusinessDate(value: string) { return new Date(value + "T00:00:00.000Z"); }
function capAsOfDate(requested: Date | undefined, businessDate: Date) { return requested && requested < businessDate ? requested : businessDate; }
function businessDateValue(value: Date) { return value.toISOString().slice(0, 10); }
function monthStart(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)); }
function zeroAmounts(): Amounts { return { openingBalance: new Prisma.Decimal(0), balanceAsOf: new Prisma.Decimal(0), inflow: new Prisma.Decimal(0), outflow: new Prisma.Decimal(0) }; }
function sum(items: Array<{ openingBalance: string; balanceAsOf: string; inflow: string; outflow: string }>, key: "openingBalance" | "balanceAsOf" | "inflow" | "outflow") { return items.reduce((total, item) => total.plus(item[key]), new Prisma.Decimal(0)).toFixed(4); }
function earliestPeriodStart(from: Date | undefined, months: readonly string[] | undefined) {
  if (from) return from;
  const first = months?.[0];
  return first ? new Date(`${first}-01T00:00:00.000Z`) : undefined;
}
function previousDay(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - 1)); }
