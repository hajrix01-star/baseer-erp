import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';

type FollowUpRequest = { documentId: string; enabled: boolean; idempotencyKey: string };
type CreateAssetRequest = { sourceDocumentId: string; nameAr: string; nameEn?: string | undefined; serialNumber?: string | undefined; location?: string | undefined; warrantyProvider?: string | undefined; warrantyTerms?: string | undefined; warrantyStartsAt?: string | undefined; warrantyEndsAt?: string | undefined; lines?: Array<{ description: string; serialNumber?: string | undefined; warrantyEndsAt?: string | undefined }> | undefined; idempotencyKey: string };
type ArchiveAssetRequest = { assetId: string; idempotencyKey: string };
type Receipt = { id: string; replayed: boolean };

@Injectable()
export class OperationsAssetsWarrantyService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async workspace(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [queue, assets] = await Promise.all([
        tx.financeOutflowDocument.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, assetWarrantyFollowUp: true, assetWarrantyAssets: { none: {} } },
          orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: 1_000,
          include: { supplier: { select: { nameAr: true, nameEn: true } }, assetWarrantyAssets: { select: { id: true } } },
        }),
        tx.operationsAssetWarrantyAsset.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId },
          orderBy: [{ status: 'asc' }, { warrantyEndsAt: 'asc' }, { createdAt: 'desc' }], take: 10_000,
          include: { lines: { orderBy: { createdAt: 'asc' } } },
        }),
      ]);
      return {
        companyId: context.companyId,
        queue: queue.map((document) => ({ documentId: document.id, documentNumber: document.documentNumber, kind: document.kind, businessDate: date(document.businessDate), grossAmount: document.grossAmount.toFixed(4), supplierNameAr: document.supplier?.nameAr ?? null, supplierNameEn: document.supplier?.nameEn ?? null, supplierInvoiceNumber: document.supplierInvoiceNumber, supplierInvoiceDate: document.supplierInvoiceDate ? date(document.supplierInvoiceDate) : null, assetCount: document.assetWarrantyAssets.length })),
        assets: assets.map((asset) => ({ id: asset.id, sourceDocumentId: asset.sourceDocumentId, nameAr: asset.nameAr, nameEn: asset.nameEn, serialNumber: asset.serialNumber, location: asset.location, supplierNameSnapshot: asset.supplierNameSnapshot, invoiceNumberSnapshot: asset.invoiceNumberSnapshot, invoiceDateSnapshot: asset.invoiceDateSnapshot ? date(asset.invoiceDateSnapshot) : null, acquisitionAmount: asset.acquisitionAmount.toFixed(4), warrantyProvider: asset.warrantyProvider, warrantyTerms: asset.warrantyTerms, warrantyStartsAt: asset.warrantyStartsAt ? date(asset.warrantyStartsAt) : null, warrantyEndsAt: asset.warrantyEndsAt ? date(asset.warrantyEndsAt) : null, status: asset.status, lines: asset.lines.map((line) => ({ id: line.id, description: line.description, serialNumber: line.serialNumber, warrantyEndsAt: line.warrantyEndsAt ? date(line.warrantyEndsAt) : null })) })),
      };
    });
  }

  async setFollowUp(context: TrustedCompanyActorContext, request: FollowUpRequest): Promise<Receipt> {
    return this.withIdempotency(context, 'operations.assets.follow_up.set', request.idempotencyKey, request, async (tx) => {
      const document = await tx.financeOutflowDocument.findFirst({ where: { id: request.documentId, tenantId: context.tenantId, companyId: context.companyId }, include: { assetWarrantyAssets: { select: { id: true } } } });
      if (!document) throw new NotFoundException('The source purchase or expense document was not found.');
      if (!request.enabled && document.assetWarrantyAssets.length) throw new ConflictException('A completed asset record keeps this source document traceable. Archive the asset instead of removing its follow-up marker.');
      await tx.financeOutflowDocument.update({ where: { id: document.id }, data: { assetWarrantyFollowUp: request.enabled } });
      await this.audit(tx, context, 'operations.asset_warranty.follow_up_set', 'FinanceOutflowDocument', document.id, { assetWarrantyFollowUp: document.assetWarrantyFollowUp }, { assetWarrantyFollowUp: request.enabled });
      return { id: document.id, replayed: false };
    }, 200);
  }

  async createAsset(context: TrustedCompanyActorContext, request: CreateAssetRequest): Promise<Receipt> {
    const payload = { ...request, nameAr: required(request.nameAr, 160), nameEn: optional(request.nameEn, 160), serialNumber: optional(request.serialNumber, 160), location: optional(request.location, 160), warrantyProvider: optional(request.warrantyProvider, 160), warrantyTerms: optional(request.warrantyTerms, 2_000), lines: (request.lines ?? []).map((line) => ({ description: required(line.description, 500), serialNumber: optional(line.serialNumber, 160), warrantyEndsAt: line.warrantyEndsAt ?? null })) };
    return this.withIdempotency(context, 'operations.assets.create', request.idempotencyKey, payload, async (tx) => {
      const source = await tx.financeOutflowDocument.findFirst({ where: { id: payload.sourceDocumentId, tenantId: context.tenantId, companyId: context.companyId, assetWarrantyFollowUp: true }, include: { supplier: { select: { nameAr: true } }, assetWarrantyAssets: { select: { id: true } } } });
      if (!source) throw new NotFoundException('Choose a source document marked for asset or warranty follow-up.');
      if (source.assetWarrantyAssets.length) throw new ConflictException('This Gate A source is already completed into an asset record.');
      const id = randomUUID();
      await tx.operationsAssetWarrantyAsset.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, sourceDocumentId: source.id, nameAr: payload.nameAr, nameEn: payload.nameEn, serialNumber: payload.serialNumber, location: payload.location, supplierNameSnapshot: source.supplier?.nameAr ?? null, invoiceNumberSnapshot: source.supplierInvoiceNumber, invoiceDateSnapshot: source.supplierInvoiceDate, acquisitionAmount: source.grossAmount, warrantyProvider: payload.warrantyProvider, warrantyTerms: payload.warrantyTerms, warrantyStartsAt: asDate(request.warrantyStartsAt), warrantyEndsAt: asDate(request.warrantyEndsAt), createdByUserId: context.actorUserId, lines: { create: payload.lines.map((line) => ({ id: randomUUID(), description: line.description, serialNumber: line.serialNumber, warrantyEndsAt: asDate(line.warrantyEndsAt) })) } } });
      await this.audit(tx, context, 'operations.asset_warranty.completed', 'OperationsAssetWarrantyAsset', id, null, { sourceDocumentId: source.id, nameAr: payload.nameAr, acquisitionAmount: source.grossAmount.toFixed(4) });
      return { id, replayed: false };
    }, 201);
  }

  async archiveAsset(context: TrustedCompanyActorContext, request: ArchiveAssetRequest): Promise<Receipt> {
    return this.withIdempotency(context, 'operations.assets.archive', request.idempotencyKey, request, async (tx) => {
      const asset = await tx.operationsAssetWarrantyAsset.findFirst({ where: { id: request.assetId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!asset) throw new NotFoundException('The asset record was not found.');
      if (asset.status === 'ARCHIVED') return { id: asset.id, replayed: false };
      await tx.operationsAssetWarrantyAsset.update({ where: { id: asset.id }, data: { status: 'ARCHIVED' } });
      await this.audit(tx, context, 'operations.asset_warranty.archived', 'OperationsAssetWarrantyAsset', asset.id, { status: asset.status }, { status: 'ARCHIVED' });
      return { id: asset.id, replayed: false };
    }, 200);
  }

  private async withIdempotency(context: TrustedCompanyActorContext, operation: string, key: string, request: unknown, action: (tx: Prisma.TransactionClient) => Promise<Receipt>, status: number): Promise<Receipt> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      let begun;
      try { begun = await this.idempotency.beginInTransaction(tx, context, { operation, key, request: request as CanonicalJsonValue, expiresAt: new Date(Date.now() + 86_400_000) }); }
      catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was already used with a different assets request.'); throw error; }
      if (begun.kind === 'replay') return { ...(begun.response.body as Receipt), replayed: true };
      if (begun.kind === 'in-progress') throw new ConflictException('The assets request is still in progress.');
      const receipt = await action(tx);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status, headers: null, body: receipt as CanonicalJsonValue } });
      return receipt;
    });
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, beforeJson: unknown, afterJson: unknown) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: randomUUID(), beforeJson: beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } });
  }
}

function required(value: string, max: number) { const normalized = value.trim(); if (!normalized || normalized.length > max) throw new BadRequestException('An asset value is invalid.'); return normalized; }
function optional(value: string | undefined, max: number) { return value?.trim() ? required(value, max) : null; }
function asDate(value: string | null | undefined) { return value ? new Date(`${value}T00:00:00.000Z`) : null; }
function date(value: Date) { return value.toISOString().slice(0, 10); }
