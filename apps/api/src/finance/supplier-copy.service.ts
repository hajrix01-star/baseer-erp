import { randomUUID } from 'node:crypto';

import {
  type CopySupplierRequest,
  supplierCopyCandidatesReceiptSchema,
  supplierCopyReceiptSchema,
  type SupplierCopyCandidatesReceipt,
  type SupplierCopyReceipt,
} from '@baseer-erp/contracts';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyService,
} from '../core-controls/idempotency.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  CompanyStatus,
  FinanceSupplierStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';

const TARGET_CAPABILITY = 'finance.foundation.write';
const SOURCE_CAPABILITY = 'finance.suppliers.read';
const COPY_OPERATION = 'finance.supplier.copy';

function normalizedName(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');
}

@Injectable()
export class SupplierCopyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async listCandidates(input: {
    accessToken: string;
    targetCompanyId: string;
  }): Promise<SupplierCopyCandidatesReceipt> {
    const target = await this.authorizeTarget(input.accessToken, input.targetCompanyId);
    return this.database.inTenantTransaction(target.tenantId, async (transaction) => {
      const sourceCompanyIds = await this.authorizedSourceCompanyIds(transaction, target);
      if (sourceCompanyIds.length === 0) {
        return supplierCopyCandidatesReceiptSchema.parse({
          targetCompanyId: target.companyId,
          candidates: [],
        });
      }
      const suppliers = await transaction.financeSupplier.findMany({
        where: {
          tenantId: target.tenantId,
          companyId: { in: sourceCompanyIds },
          status: FinanceSupplierStatus.ACTIVE,
        },
        orderBy: [{ companyId: 'asc' }, { nameAr: 'asc' }, { id: 'asc' }],
        take: 1_000,
        include: {
          company: { select: { id: true, nameAr: true } },
          category: { select: { code: true, nameAr: true } },
        },
      });
      return supplierCopyCandidatesReceiptSchema.parse({
        targetCompanyId: target.companyId,
        candidates: suppliers.map((supplier) => ({
          sourceCompanyId: supplier.company.id,
          sourceCompanyNameAr: supplier.company.nameAr,
          sourceSupplierId: supplier.id,
          nameAr: supplier.nameAr,
          nameEn: supplier.nameEn,
          phone: supplier.phone,
          taxNumber: supplier.taxNumber,
          isTaxRegistered: supplier.isTaxRegistered,
          categoryCode: supplier.category?.code ?? null,
          categoryNameAr: supplier.category?.nameAr ?? null,
        })),
      });
    });
  }

  async copy(input: {
    accessToken: string;
    targetCompanyId: string;
    request: CopySupplierRequest;
  }): Promise<SupplierCopyReceipt> {
    const target = await this.authorizeTarget(input.accessToken, input.targetCompanyId);
    return this.database.inTenantTransaction(target.tenantId, async (transaction) => {
      try {
        const begun = await this.idempotency.beginInTransaction(transaction, target, {
          operation: COPY_OPERATION,
          key: input.request.idempotencyKey,
          request: input.request,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        });
        if (begun.kind === 'in-progress') {
          throw new ConflictException('The supplier-copy request is still in progress.');
        }
        if (begun.kind === 'replay') {
          return supplierCopyReceiptSchema.parse({ ...(begun.response.body as object), replayed: true });
        }

        await this.assertSourceAccess(transaction, target, input.request.sourceCompanyId);
        const copied = await this.copyInTransaction(transaction, target, input.request);
        await this.idempotency.completeInTransaction(transaction, target, {
          receiptId: begun.receiptId,
          response: { status: 201, headers: null, body: copied },
        });
        return copied;
      } catch (error) {
        if (error instanceof IdempotencyPayloadMismatchError) {
          throw new ConflictException('The idempotency key was used with a different supplier-copy request.');
        }
        throw error;
      }
    });
  }

  private async authorizeTarget(accessToken: string, companyId: string): Promise<TrustedCompanyActorContext> {
    const receipt = await this.companyContext.authorize({
      accessToken,
      companyId,
      requiredCapabilities: [TARGET_CAPABILITY],
    });
    return {
      tenantId: receipt.principal.tenantId,
      companyId: receipt.company.id,
      actorUserId: receipt.principal.userId,
    };
  }

  private async authorizedSourceCompanyIds(
    transaction: Prisma.TransactionClient,
    target: TrustedCompanyActorContext,
  ): Promise<string[]> {
    const memberships = await transaction.companyMembership.findMany({
      where: {
        tenantId: target.tenantId,
        userId: target.actorUserId,
        companyId: { not: target.companyId },
        company: { status: CompanyStatus.ACTIVE },
        role: { grants: { some: { permissionCode: SOURCE_CAPABILITY } } },
      },
      select: { companyId: true },
    });
    return memberships.map((membership) => membership.companyId);
  }

  private async assertSourceAccess(
    transaction: Prisma.TransactionClient,
    target: TrustedCompanyActorContext,
    sourceCompanyId: string,
  ): Promise<void> {
    const allowed = await transaction.companyMembership.findFirst({
      where: {
        tenantId: target.tenantId,
        userId: target.actorUserId,
        companyId: sourceCompanyId,
        company: { status: CompanyStatus.ACTIVE },
        role: { grants: { some: { permissionCode: SOURCE_CAPABILITY } } },
      },
      select: { companyId: true },
    });
    if (!allowed) throw new ForbiddenException('Supplier source company access is not permitted.');
  }

  private async copyInTransaction(
    transaction: Prisma.TransactionClient,
    target: TrustedCompanyActorContext,
    request: CopySupplierRequest,
  ): Promise<SupplierCopyReceipt> {
    const profile = await transaction.companyFinanceProfile.findFirst({
      where: { tenantId: target.tenantId, companyId: target.companyId },
      select: { id: true },
    });
    if (!profile) throw new ConflictException('The target company finance foundation is not initialized.');

    const source = await transaction.financeSupplier.findFirst({
      where: {
        id: request.sourceSupplierId,
        tenantId: target.tenantId,
        companyId: request.sourceCompanyId,
        status: FinanceSupplierStatus.ACTIVE,
      },
      include: { category: { select: { code: true } } },
    });
    if (!source) throw new NotFoundException('The selected source supplier was not found.');

    let categoryId: string | null = null;
    if (source.category) {
      const category = await transaction.financeCategory.findFirst({
        where: {
          tenantId: target.tenantId,
          companyId: target.companyId,
          code: source.category.code,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!category) {
        throw new ConflictException('The source supplier category is not available in the target company.');
      }
      categoryId = category.id;
    }

    if (source.taxNumber) {
      const duplicateTax = await transaction.financeSupplier.findFirst({
        where: {
          tenantId: target.tenantId,
          companyId: target.companyId,
          status: FinanceSupplierStatus.ACTIVE,
          taxNumber: source.taxNumber,
        },
        select: { id: true },
      });
      if (duplicateTax) throw new ConflictException('An active target supplier already uses this tax number.');
    }

    const sameName = await transaction.financeSupplier.findFirst({
      where: {
        tenantId: target.tenantId,
        companyId: target.companyId,
        status: FinanceSupplierStatus.ACTIVE,
        OR: [
          { nameAr: source.nameAr },
          ...(source.nameEn ? [{ nameEn: source.nameEn }] : []),
        ],
      },
      select: { id: true, nameAr: true, nameEn: true },
    });
    if (
      sameName
      && (normalizedName(sameName.nameAr) === normalizedName(source.nameAr)
        || normalizedName(sameName.nameEn) === normalizedName(source.nameEn))
      && !request.confirmSameName
    ) {
      throw new ConflictException('A similarly named active target supplier exists; explicit confirmation is required.');
    }

    const supplier = await transaction.financeSupplier.create({
      data: {
        id: randomUUID(),
        tenantId: target.tenantId,
        companyId: target.companyId,
        categoryId,
        nameAr: source.nameAr,
        nameEn: source.nameEn,
        phone: source.phone,
        taxNumber: source.taxNumber,
        isTaxRegistered: source.isTaxRegistered,
      },
    });
    await transaction.supplierCopyProvenance.create({
      data: {
        id: randomUUID(),
        tenantId: target.tenantId,
        companyId: target.companyId,
        targetSupplierId: supplier.id,
        sourceCompanyId: request.sourceCompanyId,
        sourceSupplierId: source.id,
        sourceKind: 'company_supplier_copy',
        copiedByUserId: target.actorUserId,
      },
    });
    const receipt = supplierCopyReceiptSchema.parse({
      id: supplier.id,
      companyId: target.companyId,
      nameAr: supplier.nameAr,
      nameEn: supplier.nameEn,
      taxNumber: supplier.taxNumber,
      categoryCode: source.category?.code ?? null,
      copiedFromCompanyId: request.sourceCompanyId,
      copiedFromSupplierId: source.id,
      copiedByUserId: target.actorUserId,
      replayed: false,
    });
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: target.tenantId,
        companyId: target.companyId,
        actorUserId: target.actorUserId,
        action: 'finance.supplier.copied',
        entityType: 'FinanceSupplier',
        entityId: supplier.id,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson: receipt as Prisma.InputJsonValue,
      },
    });
    return receipt;
  }
}
