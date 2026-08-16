import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { FinanceAccountStatus, FinanceAccountType, FinanceCategoryStatus, FinanceSupplierStatus, Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

type EntityReceipt = Readonly<{ id: string; status: "ACTIVE" | "ARCHIVED"; replayed: boolean }>;
type CategoryCreate = Readonly<{ code: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" | "SALE"; parentId?: string | undefined }>;
type SupplierWrite = Readonly<{ nameAr: string; nameEn?: string | undefined; phone?: string | undefined; taxNumber?: string | undefined; isTaxRegistered: boolean; categoryId?: string | null | undefined }>;

@Injectable()
export class FinanceMasterDataService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async createCategory(context: TrustedCompanyActorContext, request: CategoryCreate, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { ...request, code: request.code.trim().toUpperCase(), nameAr: required(request.nameAr, 160), nameEn: required(request.nameEn, 160), parentId: request.parentId ?? null };
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: "finance.category.create", key: idempotencyKey, request: payload, expiresAt: tomorrow() });
      if (begun.kind === "replay") return { ...(begun.response.body as EntityReceipt), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The category request is still in progress.");
      if (await tx.financeCategory.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: payload.code }, select: { id: true } })) throw new ConflictException("A category with this code already exists.");
      if (payload.parentId) {
        const parent = await tx.financeCategory.findFirst({ where: { id: payload.parentId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceCategoryStatus.ACTIVE }, select: { kind: true } });
        if (!parent) throw new NotFoundException("The selected active parent category was not found.");
        if (parent.kind !== payload.kind) throw new BadRequestException("A child category must use the same kind as its parent.");
      }
      const id = randomUUID();
      const accountId = randomUUID();
      await tx.financeAccount.create({ data: { id: accountId, tenantId: context.tenantId, companyId: context.companyId, code: `CAT-${id.slice(0, 12).toUpperCase()}`, nameAr: payload.nameAr, nameEn: payload.nameEn, type: payload.kind === "SALE" ? FinanceAccountType.REVENUE : FinanceAccountType.EXPENSE, isSystem: false, status: FinanceAccountStatus.ACTIVE } });
      await tx.financeCategory.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, parentId: payload.parentId, accountId, code: payload.code, nameAr: payload.nameAr, nameEn: payload.nameEn, kind: payload.kind, status: FinanceCategoryStatus.ACTIVE, sortOrder: await tx.financeCategory.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }) + 1 } });
      const receipt: EntityReceipt = { id, status: "ACTIVE", replayed: false };
      await this.audit(tx, context, "finance.category.created", "FinanceCategory", id, null, { ...payload, accountId });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    });
  }

  async archiveCategory(context: TrustedCompanyActorContext, categoryId: string, idempotencyKey: string): Promise<EntityReceipt> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: "finance.category.archive", key: idempotencyKey, request: { categoryId }, expiresAt: tomorrow() });
      if (begun.kind === "replay") return { ...(begun.response.body as EntityReceipt), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The category request is still in progress.");
      const category = await tx.financeCategory.findFirst({ where: { id: categoryId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, accountId: true, status: true, account: { select: { isSystem: true } } } });
      if (!category) throw new NotFoundException("The category was not found.");
      if (category.status !== FinanceCategoryStatus.ARCHIVED) await tx.financeCategory.update({ where: { id: category.id }, data: { status: FinanceCategoryStatus.ARCHIVED } });
      if (category.accountId && !category.account?.isSystem) await tx.financeAccount.update({ where: { id: category.accountId }, data: { status: FinanceAccountStatus.ARCHIVED } });
      const receipt: EntityReceipt = { id: category.id, status: "ARCHIVED", replayed: false };
      await this.audit(tx, context, "finance.category.archived", "FinanceCategory", category.id, { status: category.status }, receipt);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    });
  }

  async createSupplier(context: TrustedCompanyActorContext, request: SupplierWrite, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = normaliseSupplier(request);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: "finance.supplier.create", key: idempotencyKey, request: payload, expiresAt: tomorrow() });
      if (begun.kind === "replay") return { ...(begun.response.body as EntityReceipt), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The supplier request is still in progress.");
      await this.assertCategory(tx, context, payload.categoryId);
      const id = randomUUID();
      await tx.financeSupplier.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...payload, status: FinanceSupplierStatus.ACTIVE } });
      const receipt: EntityReceipt = { id, status: "ACTIVE", replayed: false };
      await this.audit(tx, context, "finance.supplier.created", "FinanceSupplier", id, null, payload);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    });
  }

  async updateSupplier(context: TrustedCompanyActorContext, supplierId: string, request: SupplierWrite, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = normaliseSupplier(request);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: "finance.supplier.update", key: idempotencyKey, request: { supplierId, ...payload }, expiresAt: tomorrow() });
      if (begun.kind === "replay") return { ...(begun.response.body as EntityReceipt), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The supplier request is still in progress.");
      const current = await tx.financeSupplier.findFirst({ where: { id: supplierId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, nameAr: true, nameEn: true, phone: true, taxNumber: true, isTaxRegistered: true, categoryId: true, status: true } });
      if (!current) throw new NotFoundException("The supplier was not found.");
      await this.assertCategory(tx, context, payload.categoryId);
      await tx.financeSupplier.update({ where: { id: current.id }, data: payload });
      const receipt: EntityReceipt = { id: current.id, status: current.status, replayed: false };
      await this.audit(tx, context, "finance.supplier.updated", "FinanceSupplier", current.id, current, payload);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    });
  }

  async archiveSupplier(context: TrustedCompanyActorContext, supplierId: string, idempotencyKey: string): Promise<EntityReceipt> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: "finance.supplier.archive", key: idempotencyKey, request: { supplierId }, expiresAt: tomorrow() });
      if (begun.kind === "replay") return { ...(begun.response.body as EntityReceipt), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The supplier request is still in progress.");
      const supplier = await tx.financeSupplier.findFirst({ where: { id: supplierId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, status: true } });
      if (!supplier) throw new NotFoundException("The supplier was not found.");
      if (supplier.status !== FinanceSupplierStatus.ARCHIVED) await tx.financeSupplier.update({ where: { id: supplier.id }, data: { status: FinanceSupplierStatus.ARCHIVED } });
      const receipt: EntityReceipt = { id: supplier.id, status: "ARCHIVED", replayed: false };
      await this.audit(tx, context, "finance.supplier.archived", "FinanceSupplier", supplier.id, { status: supplier.status }, receipt);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    });
  }

  private async assertCategory(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return;
    const category = await tx.financeCategory.findFirst({ where: { id: categoryId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceCategoryStatus.ACTIVE }, select: { id: true } });
    if (!category) throw new BadRequestException("The selected supplier category is not active.");
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, beforeJson: unknown, afterJson: unknown): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson === null ? Prisma.JsonNull : beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } });
  }
}

function required(value: string, max: number): string { const normalized = value.trim(); if (!normalized || normalized.length > max) throw new BadRequestException("A required text value is invalid."); return normalized; }
function optional(value: string | undefined): string | null { const normalized = value?.trim(); return normalized ? normalized : null; }
function normaliseSupplier(value: SupplierWrite): { nameAr: string; nameEn: string | null; phone: string | null; taxNumber: string | null; isTaxRegistered: boolean; categoryId: string | null } { return { nameAr: required(value.nameAr, 160), nameEn: optional(value.nameEn), phone: optional(value.phone), taxNumber: optional(value.taxNumber), isTaxRegistered: value.isTaxRegistered, categoryId: value.categoryId ?? null }; }
function tomorrow(): Date { return new Date(Date.now() + 86_400_000); }