import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { type CanonicalJsonValue, IdempotencyPayloadMismatchError, IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { FinanceAccountStatus, FinanceAccountType, FinanceVaultPaymentMethod, FinanceVaultStatus, FinanceVaultType, Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

const CREATE_VAULT_OPERATION = "finance.vault.create";
const UPDATE_VAULT_OPERATION = "finance.vault.update";
const REMOVE_VAULT_OPERATION = "finance.vault.remove_or_archive";
const RESTORE_VAULT_OPERATION = "finance.vault.restore";
const REORDER_VAULTS_OPERATION = "finance.vault.reorder";

@Injectable()
export class VaultManagementService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async addCustomVault(context: TrustedCompanyActorContext, input: { nameAr: string; nameEn: string; type: FinanceVaultType; paymentMethod?: FinanceVaultPaymentMethod | undefined; paymentMethods?: readonly FinanceVaultPaymentMethod[] | undefined; isSalesChannel?: boolean; isPaymentDestination?: boolean }, idempotencyKey?: string): Promise<string> {
    const nameAr = text(input.nameAr, 160);
    const nameEn = text(input.nameEn, 160);
    const paymentMethods = paymentMethodsFor(input.type, input.paymentMethods, input.paymentMethod); const paymentMethod = paymentMethods[0]!;
    return this.withIdempotency(context, CREATE_VAULT_OPERATION, idempotencyKey, { nameAr, nameEn, type: input.type, paymentMethod, paymentMethods, isSalesChannel: input.isSalesChannel ?? false, isPaymentDestination: input.isPaymentDestination ?? false }, 201, async (transaction) => {
      const id = randomUUID();
      const accountId = randomUUID();
      await transaction.financeAccount.create({ data: { id: accountId, tenantId: context.tenantId, companyId: context.companyId, code: `VAULT-${id.slice(0, 8).toUpperCase()}`, nameAr, nameEn, type: FinanceAccountType.ASSET, isSystem: false, status: FinanceAccountStatus.ACTIVE } });
      await transaction.financeVault.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, accountId, nameAr, nameEn, type: input.type, paymentMethod, paymentMethods, status: FinanceVaultStatus.ACTIVE, isSalesChannel: input.isSalesChannel ?? false, isPaymentDestination: input.isPaymentDestination ?? false } });
      await this.audit(transaction, context, "finance.vault.created", id, { accountId, type: input.type, paymentMethod, paymentMethods });
      return { vaultId: id };
    }).then((receipt) => receipt.vaultId);
  }

  async update(context: TrustedCompanyActorContext, input: { vaultId: string; nameAr: string; nameEn: string; type: FinanceVaultType; paymentMethod?: FinanceVaultPaymentMethod | undefined; paymentMethods?: readonly FinanceVaultPaymentMethod[] | undefined; isSalesChannel: boolean; isPaymentDestination: boolean; idempotencyKey: string }): Promise<string> {
    const nameAr = text(input.nameAr, 160);
    const nameEn = text(input.nameEn, 160);
    const paymentMethods = paymentMethodsFor(input.type, input.paymentMethods, input.paymentMethod); const paymentMethod = paymentMethods[0]!;
    const receipt = await this.withIdempotency(context, UPDATE_VAULT_OPERATION, input.idempotencyKey, { vaultId: input.vaultId, nameAr, nameEn, type: input.type, paymentMethod, paymentMethods, isSalesChannel: input.isSalesChannel, isPaymentDestination: input.isPaymentDestination, idempotencyKey: input.idempotencyKey }, 200, async (transaction) => {
      const vault = await this.getVault(transaction, context, input.vaultId);
      const history = await transaction.financeJournalLine.count({ where: { tenantId: context.tenantId, companyId: context.companyId, accountId: vault.accountId } });
      if (history > 0 && vault.type !== input.type) throw new BadRequestException("A vault with financial history cannot change type.");
      await transaction.financeVault.update({ where: { id: vault.id }, data: { nameAr, nameEn, type: input.type, paymentMethod, paymentMethods, isSalesChannel: input.isSalesChannel, isPaymentDestination: input.isPaymentDestination } });
      await transaction.financeAccount.update({ where: { id: vault.accountId }, data: { nameAr, nameEn } });
      await this.audit(transaction, context, "finance.vault.updated", vault.id, { nameAr, nameEn, type: input.type, paymentMethod, paymentMethods, isSalesChannel: input.isSalesChannel, isPaymentDestination: input.isPaymentDestination, historyPreserved: history > 0 });
      return { vaultId: vault.id };
    });
    return receipt.vaultId;
  }

  async reorder(context: TrustedCompanyActorContext, vaultIds: string[], idempotencyKey: string): Promise<{ vaultIds: string[] }> {
    const orderedIds = [...vaultIds];
    if (new Set(orderedIds).size !== orderedIds.length) throw new BadRequestException("Vault order contains duplicate vaults.");
    return this.withIdempotency(context, REORDER_VAULTS_OPERATION, idempotencyKey, { vaultIds: orderedIds }, 200, async (transaction) => {
      const activeVaults = await transaction.financeVault.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceVaultStatus.ACTIVE }, select: { id: true } });
      const activeIds = new Set(activeVaults.map((vault) => vault.id));
      if (activeIds.size !== orderedIds.length || orderedIds.some((vaultId) => !activeIds.has(vaultId))) throw new BadRequestException("Vault order must include every active company vault exactly once.");
      await Promise.all(orderedIds.map((vaultId, index) => transaction.financeVault.update({ where: { id: vaultId }, data: { sortOrder: (index + 1) * 10 } })));
      await this.audit(transaction, context, "finance.vault.reordered", context.companyId, { vaultIds: orderedIds });
      return { vaultIds: orderedIds };
    });
  }
  async restore(context: TrustedCompanyActorContext, vaultId: string, idempotencyKey: string): Promise<string> {
    const receipt = await this.withIdempotency(context, RESTORE_VAULT_OPERATION, idempotencyKey, { vaultId }, 200, async (transaction) => {
      const vault = await this.getVault(transaction, context, vaultId);
      if (vault.status === FinanceVaultStatus.ACTIVE) return { vaultId: vault.id };
      await transaction.financeVault.update({ where: { id: vault.id }, data: { status: FinanceVaultStatus.ACTIVE } });
      await this.audit(transaction, context, "finance.vault.restored", vault.id, { status: FinanceVaultStatus.ACTIVE });
      return { vaultId: vault.id };
    });
    return receipt.vaultId;
  }

  async removeOrArchive(context: TrustedCompanyActorContext, vaultId: string, idempotencyKey?: string): Promise<"deleted" | "archived"> {
    const receipt = await this.withIdempotency(context, REMOVE_VAULT_OPERATION, idempotencyKey, { vaultId }, 200, async (transaction) => {
      const vault = await this.getVault(transaction, context, vaultId);
      const [supplierPayments, loanPayments, journalLines, balanceGroups] = await Promise.all([
        transaction.financeSupplierDuePayment.count({ where: { tenantId: context.tenantId, companyId: context.companyId, vaultId } }),
        transaction.financeInclusiveLoanPayment.count({ where: { tenantId: context.tenantId, companyId: context.companyId, vaultId } }),
        transaction.financeJournalLine.count({ where: { tenantId: context.tenantId, companyId: context.companyId, accountId: vault.accountId } }),
        transaction.financeJournalLine.groupBy({ by: ["accountId"], where: { tenantId: context.tenantId, companyId: context.companyId, accountId: vault.accountId, journalEntry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debitAmount: true, creditAmount: true } }),
      ]);
      const balance = new Prisma.Decimal(balanceGroups[0]?._sum.debitAmount ?? 0).minus(balanceGroups[0]?._sum.creditAmount ?? 0);
      const mustArchive = vault.account.isSystem || supplierPayments + loanPayments + journalLines > 0;
      if (mustArchive && !balance.isZero()) throw new BadRequestException("A vault with a non-zero ledger balance must be transferred or settled before archiving.");
      const result: "deleted" | "archived" = mustArchive ? "archived" : "deleted";
      if (result === "archived") {
        await transaction.financeVault.update({ where: { id: vault.id }, data: { status: FinanceVaultStatus.ARCHIVED, isSalesChannel: false, isPaymentDestination: false } });
        await this.audit(transaction, context, "finance.vault.archived", vault.id, { reason: vault.account.isSystem ? "system_vault_protected" : "financial_history_exists", ledgerHistory: journalLines, balance: balance.toFixed(4) });
      } else {
        await transaction.financeVault.delete({ where: { id: vault.id } });
        await transaction.financeAccount.update({ where: { id: vault.accountId }, data: { status: FinanceAccountStatus.ARCHIVED } });
        await this.audit(transaction, context, "finance.vault.deleted", vault.id, { accountArchived: true });
      }
      return { result };
    });
    return receipt.result;
  }

  private async withIdempotency<T extends CanonicalJsonValue>(context: TrustedCompanyActorContext, operation: string, key: string | undefined, request: CanonicalJsonValue, status: number, action: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        const begun = key ? await this.idempotency.beginInTransaction(transaction, context, { operation, key, request, expiresAt: new Date(Date.now() + 86_400_000) }) : null;
        if (begun?.kind === "replay") return begun.response.body as T;
        if (begun?.kind === "in-progress") throw new ConflictException("The vault request is still in progress.");
        const receipt = await action(transaction);
        if (begun?.kind === "started") await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status, headers: null, body: receipt } });
        return receipt;
      });
    } catch (error) {
      if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was used with different vault data.");
      throw error;
    }
  }

  private async getVault(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, vaultId: string) {
    const vault = await transaction.financeVault.findFirst({ where: { id: vaultId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, accountId: true, type: true, status: true, account: { select: { isSystem: true } } } });
    if (!vault) throw new NotFoundException("The company vault was not found.");
    return vault;
  }

  private async audit(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, afterJson: Prisma.InputJsonValue): Promise<void> {
    await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: "FinanceVault", entityId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson } });
  }
}

function paymentMethodsFor(type: FinanceVaultType, candidates: readonly FinanceVaultPaymentMethod[] | undefined, legacy: FinanceVaultPaymentMethod | undefined): FinanceVaultPaymentMethod[] {
  const permitted: FinanceVaultPaymentMethod[] = type === FinanceVaultType.BANK
    ? [FinanceVaultPaymentMethod.BANK_TRANSFER, FinanceVaultPaymentMethod.BANK_CARD, FinanceVaultPaymentMethod.BANK_PAYMENT]
    : [type === FinanceVaultType.CASH ? FinanceVaultPaymentMethod.CASH : FinanceVaultPaymentMethod.APP];
  const requested = candidates?.length ? candidates : legacy ? [legacy] : [permitted[0]!];
  if (new Set(requested).size !== requested.length || requested.some((method) => !permitted.includes(method))) throw new BadRequestException("The payment methods do not match the vault type.");
  return permitted.filter((method) => requested.includes(method));
}

function text(value: string, maximumLength: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumLength) throw new BadRequestException("Vault names are required and must be at most 160 characters.");
  return normalized;
}
