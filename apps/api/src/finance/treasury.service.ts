import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, FinanceVaultStatus } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { IdempotencyPayloadMismatchError, IdempotencyService } from "../core-controls/idempotency.service.js";
import { JournalPostingService } from "./journal/journal-posting.service.js";
import { FinanceVaultService } from "./finance-vault.service.js";
import { RequestContext } from "../observability/request-context.js";
import { BusinessDateService } from "../business-date/business-date.service.js";

type TreasuryInput = { from?: Date; to?: Date; includeArchived: boolean };
type ActivityInput = { from?: Date; to?: Date; cursor?: string; pageSize: number };
type VaultRecord = { id: string; nameAr: string; nameEn: string; type: "CASH" | "BANK" | "APP"; paymentMethod: "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP"; paymentMethods: ("CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP")[]; status: FinanceVaultStatus; isSalesChannel: boolean; isPaymentDestination: boolean; sortOrder: number; accountId: string };
type Amounts = { balanceAsOf: Prisma.Decimal; inflow: Prisma.Decimal; outflow: Prisma.Decimal };

@Injectable()
export class TreasuryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly idem: IdempotencyService,
    private readonly journals: JournalPostingService,
    private readonly vaults: FinanceVaultService,
    private readonly dates: BusinessDateService,
  ) {}

  async workspace(context: TrustedCompanyActorContext, input: TreasuryInput) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const businessDate = await this.dates.currentForTrustedContext(context);
      const asOf = capAsOfDate(input.to, dateForBusinessDate(businessDate.businessDate));
      const vaults = await tx.financeVault.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, ...(input.includeArchived ? {} : { status: FinanceVaultStatus.ACTIVE }) },
        orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
        select: { id: true, nameAr: true, nameEn: true, type: true, paymentMethod: true, paymentMethods: true, status: true, isSalesChannel: true, isPaymentDestination: true, sortOrder: true, accountId: true },
      });
      const amounts = await this.amountsForVaults(tx, context, vaults, input.from, input.to, asOf);
      const mapped = vaults.map((vault) => this.vaultReceipt(vault, amounts.get(vault.id) ?? zeroAmounts()));
      const groupVaults = {
        COLLECTION_CHANNELS: mapped.filter((vault) => vault.status === "ACTIVE" && vault.isSalesChannel),
        OTHER_VAULTS: mapped.filter((vault) => vault.status === "ACTIVE" && !vault.isSalesChannel),
        ARCHIVED: mapped.filter((vault) => vault.status === "ARCHIVED"),
      } as const;
      const groups = (Object.entries(groupVaults) as Array<["COLLECTION_CHANNELS" | "OTHER_VAULTS" | "ARCHIVED", typeof mapped]>).map(([key, items]) => ({
        key,
        count: items.length,
        balanceAsOf: sum(items, "balanceAsOf"),
        inflow: sum(items, "inflow"),
        outflow: sum(items, "outflow"),
      }));
      const summary = {
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
      const amounts = await this.amountsForVaults(tx, context, [vault], input.from, input.to, asOf);
      const amount = amounts.get(vault.id) ?? zeroAmounts();
      const periodDate = dateFilter(input.from, input.to);
      const baseWhere: Prisma.FinanceJournalLineWhereInput = {
          tenantId: context.tenantId,
          companyId: context.companyId,
          accountId: vault.accountId,
          journalEntry: { is: { status: "POSTED", ...(periodDate ? { businessDate: periodDate } : {}) } },
        };
      const cursor = input.cursor
        ? await tx.financeJournalLine.findFirst({
            where: { ...baseWhere, id: input.cursor },
            select: { id: true, createdAt: true, lineNumber: true, journalEntry: { select: { businessDate: true } } },
          })
        : null;
      if (input.cursor && !cursor)
        throw new BadRequestException("The vault activity cursor is no longer valid.");
      const lines = await tx.financeJournalLine.findMany({
        where: cursor
          ? {
              ...baseWhere,
              OR: [
                { journalEntry: { is: { businessDate: { lt: cursor.journalEntry.businessDate } } } },
                { journalEntry: { is: { businessDate: cursor.journalEntry.businessDate } }, createdAt: { lt: cursor.createdAt } },
                { journalEntry: { is: { businessDate: cursor.journalEntry.businessDate } }, createdAt: cursor.createdAt, lineNumber: { lt: cursor.lineNumber } },
                { journalEntry: { is: { businessDate: cursor.journalEntry.businessDate } }, createdAt: cursor.createdAt, lineNumber: cursor.lineNumber, id: { lt: cursor.id } },
              ],
            }
          : baseWhere,
        orderBy: [{ journalEntry: { businessDate: "desc" } }, { createdAt: "desc" }, { lineNumber: "desc" }, { id: "desc" }],
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
              lines: {
                where: { accountId: { not: vault.accountId } },
                take: 1,
                select: { account: { select: { nameAr: true, nameEn: true } } },
              },
            },
          },
        },
      });
      const hasMore = lines.length > input.pageSize;
      const items = lines.slice(0, input.pageSize).map((line) => {
        const counterpart = line.journalEntry.lines[0]?.account;
        return {
          id: line.id,
          journalEntryId: line.journalEntry.id,
          businessDate: businessDateValue(line.journalEntry.businessDate),
          sourceType: line.journalEntry.sourceType,
          sourceReference: line.journalEntry.sourceReference,
          description: line.journalEntry.description,
          counterpartNameAr: counterpart?.nameAr ?? null,
          counterpartNameEn: counterpart?.nameEn ?? null,
          inflow: line.debitAmount.toFixed(4),
          outflow: line.creditAmount.toFixed(4),
        };
      });
      return {
        vault: this.vaultReceipt(vault, amount),
        asOfBusinessDate: businessDateValue(asOf),
        fromBusinessDate: input.from ? businessDateValue(input.from) : null,
        toBusinessDate: input.to ? businessDateValue(input.to) : null,
        summary: { balanceAsOf: amount.balanceAsOf.toFixed(4), inflow: amount.inflow.toFixed(4), outflow: amount.outflow.toFixed(4), net: amount.inflow.minus(amount.outflow).toFixed(4) },
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
  ) {
    const results = new Map<string, Amounts>();
    for (const vault of vaults) results.set(vault.id, zeroAmounts());
    if (!vaults.length) return results;
    const accountIds = vaults.map((vault) => vault.accountId);
    const accountToVault = new Map(vaults.map((vault) => [vault.accountId, vault.id]));
    const common = { tenantId: context.tenantId, companyId: context.companyId, accountId: { in: accountIds }, journalEntry: { status: "POSTED" as const } };
    const [balanceGroups, periodGroups] = await Promise.all([
      tx.financeJournalLine.groupBy({
        by: ["accountId"],
        where: { ...common, journalEntry: { status: "POSTED", businessDate: { lte: asOf } } },
        _sum: { debitAmount: true, creditAmount: true },
      }),
      tx.financeJournalLine.groupBy({
        by: ["accountId"],
        where: { ...common, journalEntry: { status: "POSTED", ...(dateFilter(from, to) ? { businessDate: dateFilter(from, to)! } : {}) } },
        _sum: { debitAmount: true, creditAmount: true },
      }),
    ]);
    for (const group of balanceGroups) {
      const vaultId = accountToVault.get(group.accountId);
      if (!vaultId) continue;
      results.get(vaultId)!.balanceAsOf = decimal(group._sum.debitAmount).minus(decimal(group._sum.creditAmount));
    }
    for (const group of periodGroups) {
      const vaultId = accountToVault.get(group.accountId);
      if (!vaultId) continue;
      const target = results.get(vaultId)!;
      target.inflow = decimal(group._sum.debitAmount);
      target.outflow = decimal(group._sum.creditAmount);
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
      balanceAsOf: amounts.balanceAsOf.toFixed(4),
      inflow: amounts.inflow.toFixed(4),
      outflow: amounts.outflow.toFixed(4),
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
      const transferReference = randomUUID();
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
}

function dateFilter(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}
function decimal(value: Prisma.Decimal | number | string | null | undefined) { return new Prisma.Decimal(value === null || value === undefined ? 0 : value); }
function dateForBusinessDate(value: string) { return new Date(value + "T00:00:00.000Z"); }
function capAsOfDate(requested: Date | undefined, businessDate: Date) { return requested && requested < businessDate ? requested : businessDate; }
function businessDateValue(value: Date) { return value.toISOString().slice(0, 10); }
function zeroAmounts(): Amounts { return { balanceAsOf: new Prisma.Decimal(0), inflow: new Prisma.Decimal(0), outflow: new Prisma.Decimal(0) }; }
function sum(items: Array<{ balanceAsOf: string; inflow: string; outflow: string }>, key: "balanceAsOf" | "inflow" | "outflow") { return items.reduce((total, item) => total.plus(item[key]), new Prisma.Decimal(0)).toFixed(4); }
