import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceVaultStatus,
  FinanceVaultType,
  Prisma,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

const CREATE_VAULT_OPERATION = "finance.vault.create";
const REMOVE_VAULT_OPERATION = "finance.vault.remove_or_archive";
@Injectable()
export class VaultManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
  ) {}
  async addCustomVault(
    context: TrustedCompanyActorContext,
    input: {
      nameAr: string;
      nameEn: string;
      type: FinanceVaultType;
      isSalesChannel?: boolean;
      isPaymentDestination?: boolean;
    },
    idempotencyKey?: string,
  ): Promise<string> {
    const nameAr = text(input.nameAr, 160);
    const nameEn = text(input.nameEn, 160);
    return this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        const begun = idempotencyKey
          ? await this.idempotency.beginInTransaction(transaction, context, {
              operation: CREATE_VAULT_OPERATION,
              key: idempotencyKey,
              request: {
                nameAr,
                nameEn,
                type: input.type,
                isSalesChannel: input.isSalesChannel ?? false,
                isPaymentDestination: input.isPaymentDestination ?? false,
              },
              expiresAt: new Date(Date.now() + 86_400_000),
            })
          : null;
        if (begun?.kind === "replay")
          return (begun.response.body as { vaultId: string }).vaultId;
        if (begun?.kind === "in-progress")
          throw new ConflictException(
            "The vault request is still in progress.",
          );
        const id = randomUUID();
        const accountId = randomUUID();
        await transaction.financeAccount.create({
          data: {
            id: accountId,
            tenantId: context.tenantId,
            companyId: context.companyId,
            code: `VAULT-${id.slice(0, 8).toUpperCase()}`,
            nameAr,
            nameEn,
            type: FinanceAccountType.ASSET,
            isSystem: false,
            status: FinanceAccountStatus.ACTIVE,
          },
        });
        await transaction.financeVault.create({
          data: {
            id,
            tenantId: context.tenantId,
            companyId: context.companyId,
            accountId,
            nameAr,
            nameEn,
            type: input.type,
            status: FinanceVaultStatus.ACTIVE,
            isSalesChannel: input.isSalesChannel ?? false,
            isPaymentDestination: input.isPaymentDestination ?? false,
          },
        });
        await this.audit(transaction, context, "finance.vault.created", id, {
          accountId,
          type: input.type,
        });
        if (begun?.kind === "started")
          await this.idempotency.completeInTransaction(transaction, context, {
            receiptId: begun.receiptId,
            response: { status: 201, headers: null, body: { vaultId: id } },
          });
        return id;
      },
    );
  }
  async removeOrArchive(
    context: TrustedCompanyActorContext,
    vaultId: string,
    idempotencyKey?: string,
  ): Promise<"deleted" | "archived"> {
    return this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        const begun = idempotencyKey
          ? await this.idempotency.beginInTransaction(transaction, context, {
              operation: REMOVE_VAULT_OPERATION,
              key: idempotencyKey,
              request: { vaultId },
              expiresAt: new Date(Date.now() + 86_400_000),
            })
          : null;
        if (begun?.kind === "replay")
          return (begun.response.body as { result: "deleted" | "archived" })
            .result;
        if (begun?.kind === "in-progress")
          throw new ConflictException(
            "The vault request is still in progress.",
          );
        const vault = await transaction.financeVault.findFirst({
          where: {
            id: vaultId,
            tenantId: context.tenantId,
            companyId: context.companyId,
          },
          select: {
            id: true,
            accountId: true,
            account: { select: { isSystem: true } },
          },
        });
        if (!vault)
          throw new NotFoundException("The company vault was not found.");
        const [supplierPayments, loanPayments] = await Promise.all([
          transaction.financeSupplierDuePayment.count({
            where: {
              tenantId: context.tenantId,
              companyId: context.companyId,
              vaultId,
            },
          }),
          transaction.financeInclusiveLoanPayment.count({
            where: {
              tenantId: context.tenantId,
              companyId: context.companyId,
              vaultId,
            },
          }),
        ]);
        const result: "deleted" | "archived" =
          vault.account.isSystem || supplierPayments + loanPayments > 0
            ? "archived"
            : "deleted";
        if (result === "archived") {
          await transaction.financeVault.update({
            where: { id: vault.id },
            data: {
              status: FinanceVaultStatus.ARCHIVED,
              isSalesChannel: false,
              isPaymentDestination: false,
            },
          });
          await this.audit(
            transaction,
            context,
            "finance.vault.archived",
            vault.id,
            {
              reason: vault.account.isSystem
                ? "system_vault_protected"
                : "financial_history_exists",
            },
          );
        } else {
          await transaction.financeVault.delete({ where: { id: vault.id } });
          if (!vault.account.isSystem)
            await transaction.financeAccount.update({
              where: { id: vault.accountId },
              data: { status: FinanceAccountStatus.ARCHIVED },
            });
          await this.audit(
            transaction,
            context,
            "finance.vault.deleted",
            vault.id,
            { accountArchived: !vault.account.isSystem },
          );
        }
        if (begun?.kind === "started")
          await this.idempotency.completeInTransaction(transaction, context, {
            receiptId: begun.receiptId,
            response: { status: 200, headers: null, body: { result } },
          });
        return result;
      },
    );
  }
  private async audit(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    action: string,
    entityId: string,
    afterJson: Prisma.InputJsonValue,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action,
        entityType: "FinanceVault",
        entityId,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson,
      },
    });
  }
}
function text(value: string, maximumLength: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumLength)
    throw new BadRequestException(
      "Vault names are required and must be at most 160 characters.",
    );
  return normalized;
}
