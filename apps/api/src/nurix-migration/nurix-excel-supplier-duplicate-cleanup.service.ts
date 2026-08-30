import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

const FINAL_MAP_STATES = ['APPLIED', 'REUSED', 'REVERSED'] as const;
const APPLY_CONFIRMATION = 'DELETE_UNUSED_SOURCE_IDENTITY_DUPLICATES';

type Row = Record<string, unknown>;
type PackageRecord = Readonly<{
  id: string;
  targetCompanyId: string;
  workbookSha256: string;
  storageReference: string;
  encryptionIv: string;
  storedByteSize: bigint;
}>;
type SourceInvoiceEvidence = Readonly<{ sourceId: string; sourceChecksum: string; supplierSourceId: string }>;

type SupplierUsage = Readonly<{
  outflows: number;
  recurringProfiles: number;
  supplierDues: number;
  dailySalesClosings: number;
  employeeServices: number;
  suggestedCategories: number;
  copyProvenance: number;
}>;

type SupplierTarget = Readonly<{
  targetId: string;
  sourceMapIds: readonly string[];
  usage: SupplierUsage;
  otherSourceMapReferences: number;
}>;

export type NurixExcelSupplierDuplicateCleanupCandidate = Readonly<{
  sourceId: string;
  canonicalTargetId: string | null;
  duplicateTargetId: string;
  sourceMapIds: readonly string[];
  state: 'DELETE_READY' | 'REVIEW_REQUIRED';
  reason: string;
  usage: SupplierUsage;
  otherSourceMapReferences: number;
}>;

export type NurixExcelSupplierDuplicateCleanupReport = Readonly<{
  packageId: string;
  targetCompanyId: string;
  dryRun: boolean;
  sourceIdentitiesInspected: number;
  deletionReady: number;
  reviewRequired: number;
  deleted: number;
  candidates: readonly NurixExcelSupplierDuplicateCleanupCandidate[];
}>;

/**
 * Removes only a provably redundant, unused supplier target. The proof is an
 * immutable Noorix Supplier source identity with more than one target map;
 * display names are never read or used to infer duplicates.
 *
 * It also proves the financial canonical target from the verified Invoices
 * sheet and Invoice lineage when the earlier financial writer did not emit a
 * Supplier source map. No supplier display name participates in that proof.
 */
@Injectable()
export class NurixExcelSupplierDuplicateCleanupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: NurixExcelStagingStorageService,
  ) {}

  async dryRun(context: TrustedTenantAdministratorContext, packageId: string): Promise<NurixExcelSupplierDuplicateCleanupReport> {
    const packageRecord = await this.package(context, packageId);
    const invoices = await this.verifiedInvoiceEvidence(packageRecord);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const plan = await this.plan(tx, context, packageRecord, invoices);
      return this.report(plan, true, 0);
    });
  }

  /**
   * Explicitly guarded destructive path. Each deletion removes only the
   * duplicate's own source maps and the unused target in the same transaction,
   * then writes one audit receipt carrying the before/after proof.
   */
  async apply(
    context: TrustedTenantAdministratorContext,
    packageId: string,
    confirmation: string,
  ): Promise<NurixExcelSupplierDuplicateCleanupReport> {
    if (confirmation !== APPLY_CONFIRMATION)
      throw new ConflictException('Supplier duplicate cleanup requires the exact explicit deletion confirmation.');
    const packageRecord = await this.package(context, packageId);
    const invoices = await this.verifiedInvoiceEvidence(packageRecord);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const plan = await this.plan(tx, context, packageRecord, invoices);
      let deleted = 0;
      for (const candidate of plan.candidates.filter((item) => item.state === 'DELETE_READY')) {
        await this.assertStillSafe(tx, context, plan.targetCompanyId, candidate);
        const before = {
          sourceIdentity: { entity: 'Supplier', sourceId: candidate.sourceId },
          canonicalTargetId: candidate.canonicalTargetId,
          duplicateTargetId: candidate.duplicateTargetId,
          duplicateSourceMapIds: candidate.sourceMapIds,
          usage: candidate.usage,
          otherSourceMapReferences: candidate.otherSourceMapReferences,
        };
        const removedMaps = await tx.nurixExcelFinancialSourceMap.deleteMany({
          where: {
            id: { in: [...candidate.sourceMapIds] },
            tenantId: context.tenantId,
            targetCompanyId: plan.targetCompanyId,
            sourceEntity: 'Supplier',
            sourceId: candidate.sourceId,
            targetEntity: 'FinanceSupplier',
            targetId: candidate.duplicateTargetId,
          },
        });
        if (removedMaps.count !== candidate.sourceMapIds.length)
          throw new ConflictException('Supplier duplicate lineage changed before cleanup; run a fresh dry-run.');
        const removedSupplier = await tx.financeSupplier.deleteMany({
          where: { id: candidate.duplicateTargetId, tenantId: context.tenantId, companyId: plan.targetCompanyId },
        });
        if (removedSupplier.count !== 1)
          throw new ConflictException('Unused duplicate supplier could not be removed; run a fresh dry-run.');
        await tx.auditEvent.create({
          data: {
            id: randomUUID(), tenantId: context.tenantId, companyId: plan.targetCompanyId, actorUserId: context.actorUserId,
            action: 'nurix_excel.supplier_duplicate_unused_deleted', entityType: 'FinanceSupplier', entityId: candidate.duplicateTargetId,
            requestId: `nurix-supplier-clean:${sha({ packageId, sourceId: candidate.sourceId, targetId: candidate.duplicateTargetId })}`,
            beforeJson: before as Prisma.InputJsonValue,
            afterJson: { deleted: true, removedSourceMaps: removedMaps.count, supplierId: candidate.duplicateTargetId } as Prisma.InputJsonValue,
          },
        });
        deleted += 1;
      }
      return this.report(plan, false, deleted);
    });
  }

  private async package(context: TrustedTenantAdministratorContext, packageId: string): Promise<PackageRecord> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const packageRow = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: {
          id: true, targetCompanyId: true, workbookSha256: true, storageReference: true, encryptionIv: true, storedByteSize: true,
          status: true, company: { select: { status: true, migrationReviewLocked: true } },
        },
      });
      if (!packageRow) throw new NotFoundException('The verified Noorix package was not found.');
      if (packageRow.status !== 'READY_FOR_RECONCILIATION' || packageRow.company.status !== 'ACTIVE' || !packageRow.company.migrationReviewLocked)
        throw new ConflictException('Supplier duplicate cleanup is allowed only for an active migration-locked company with a verified package.');
      if (!packageRow.storageReference || !packageRow.encryptionIv || packageRow.storedByteSize === null)
        throw new ConflictException('The verified package artifact is unavailable.');
      return packageRow as PackageRecord;
    });
  }

  private async verifiedInvoiceEvidence(packageRecord: PackageRecord): Promise<readonly SourceInvoiceEvidence[]> {
    const bytes = await this.storage.readVerified({
      workbookSha256: packageRecord.workbookSha256,
      artifact: {
        storageReference: packageRecord.storageReference,
        encryptionIv: packageRecord.encryptionIv,
        storedByteSize: packageRecord.storedByteSize,
      },
    });
    const workbook = XLSX.read(bytes, { type: 'buffer', raw: true });
    const sheet = workbook.Sheets.Invoices;
    if (!sheet) throw new ConflictException('The verified package is missing Invoices.');
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: true });
    const unique = new Map<string, SourceInvoiceEvidence>();
    for (const row of rows) {
      const sourceId = text(row.source_id);
      const supplierSourceId = text(row.supplier_source_id);
      if (!sourceId || !supplierSourceId || unique.has(sourceId))
        throw new ConflictException('Verified invoice source identity is incomplete or duplicated.');
      unique.set(sourceId, { sourceId, supplierSourceId, sourceChecksum: sha(row) });
    }
    return [...unique.values()];
  }

  private async plan(
    tx: Prisma.TransactionClient,
    context: TrustedTenantAdministratorContext,
    packageRecord: PackageRecord,
    invoices: readonly SourceInvoiceEvidence[],
  ) {
    const sourceMaps = await tx.nurixExcelFinancialSourceMap.findMany({
      where: {
        tenantId: context.tenantId,
        targetCompanyId: packageRecord.targetCompanyId,
        sourceEntity: 'Supplier',
        targetEntity: 'FinanceSupplier',
        state: { in: [...FINAL_MAP_STATES] },
        execution: { packageId: packageRecord.id, status: 'COMPLETED' },
      },
      select: { id: true, sourceId: true, targetId: true },
    });
    const invoiceById = new Map(invoices.map((invoice) => [invoice.sourceId, invoice]));
    const invoiceMaps = await tx.nurixExcelFinancialSourceMap.findMany({
      where: {
        tenantId: context.tenantId,
        targetCompanyId: packageRecord.targetCompanyId,
        sourceEntity: 'Invoice',
        targetEntity: 'FinanceOutflowDocument',
        state: { in: [...FINAL_MAP_STATES] },
        execution: { packageId: packageRecord.id, status: 'COMPLETED' },
      },
      select: { sourceId: true, sourceChecksum: true, targetId: true },
    });
    // Match both invoice identity and verified source checksum before using an
    // outflow's supplier as the canonical target. A target map alone is not
    // sufficient evidence because a package revision could reuse its id.
    const attestedInvoiceMaps = invoiceMaps.filter((map) => invoiceById.get(map.sourceId)?.sourceChecksum === map.sourceChecksum);
    const documents = await tx.financeOutflowDocument.findMany({
      where: { id: { in: [...new Set(attestedInvoiceMaps.map((map) => map.targetId))] }, tenantId: context.tenantId, companyId: packageRecord.targetCompanyId },
      select: { id: true, supplierId: true },
    });
    const supplierByDocumentId = new Map(documents.filter((document) => document.supplierId).map((document) => [document.id, document.supplierId!]));
    const financialTargetsBySource = new Map<string, Set<string>>();
    for (const map of attestedInvoiceMaps) {
      const invoice = invoiceById.get(map.sourceId);
      const supplierId = supplierByDocumentId.get(map.targetId);
      if (!invoice || !supplierId) continue;
      const targetsForSource = financialTargetsBySource.get(invoice.supplierSourceId) ?? new Set<string>();
      targetsForSource.add(supplierId);
      financialTargetsBySource.set(invoice.supplierSourceId, targetsForSource);
    }
    const targets = [...new Set([
      ...sourceMaps.map((map) => map.targetId),
      ...[...financialTargetsBySource.values()].flatMap((targetIds) => [...targetIds]),
    ])];
    const [suppliers, provenance, allTargetMaps] = await Promise.all([
      tx.financeSupplier.findMany({
        where: { id: { in: targets }, tenantId: context.tenantId, companyId: packageRecord.targetCompanyId },
        select: {
          id: true,
          _count: { select: {
            outflowDocuments: true, recurringExpenseProfiles: true, dues: true, dailySalesClosings: true,
            hrEmployeeServices: true, suggestedForCategories: true,
          } },
        },
      }),
      tx.supplierCopyProvenance.findMany({
        where: { tenantId: context.tenantId, companyId: packageRecord.targetCompanyId, targetSupplierId: { in: targets } },
        select: { targetSupplierId: true },
      }),
      tx.nurixExcelFinancialSourceMap.findMany({
        where: { tenantId: context.tenantId, targetCompanyId: packageRecord.targetCompanyId, targetEntity: 'FinanceSupplier', targetId: { in: targets } },
        select: { id: true, targetId: true, sourceEntity: true, sourceId: true },
      }),
    ]);
    const usageByTarget = new Map<string, SupplierUsage>();
    const provenanceByTarget = countBy(provenance, (row) => row.targetSupplierId);
    for (const supplier of suppliers) {
      usageByTarget.set(supplier.id, {
        outflows: supplier._count.outflowDocuments,
        recurringProfiles: supplier._count.recurringExpenseProfiles,
        supplierDues: supplier._count.dues,
        dailySalesClosings: supplier._count.dailySalesClosings,
        employeeServices: supplier._count.hrEmployeeServices,
        suggestedCategories: supplier._count.suggestedForCategories,
        copyProvenance: provenanceByTarget.get(supplier.id) ?? 0,
      });
    }
    const allMapsByTarget = groupBy(allTargetMaps, (map) => map.targetId);
    const mapsBySource = groupBy(sourceMaps, (map) => map.sourceId);
    const sourceIds = new Set([...mapsBySource.keys(), ...financialTargetsBySource.keys()]);
    const candidates: NurixExcelSupplierDuplicateCleanupCandidate[] = [];
    for (const sourceId of sourceIds) {
      const maps = mapsBySource.get(sourceId) ?? [];
      const mapIdsByTarget = groupBy(maps, (map) => map.targetId);
      for (const targetId of financialTargetsBySource.get(sourceId) ?? []) {
        if (!mapIdsByTarget.has(targetId)) mapIdsByTarget.set(targetId, []);
      }
      if (mapIdsByTarget.size < 2) continue;
      const targetRows: SupplierTarget[] = [...mapIdsByTarget.entries()].map(([targetId, entries]) => {
        const usage = usageByTarget.get(targetId);
        const sourceMapIds = entries.map((entry) => entry.id);
        // Any map not selected for this exact completed package group blocks
        // deletion, even if it happens to repeat the same source identity in
        // another execution. Leaving a dangling PLANNED/pending map would be
        // worse than retaining an unused supplier for review.
        const otherSourceMapReferences = (allMapsByTarget.get(targetId) ?? [])
          .filter((entry) => !sourceMapIds.includes(entry.id)).length;
        return { targetId, sourceMapIds, usage: usage ?? emptyUsage(), otherSourceMapReferences };
      });
      candidates.push(...selectSupplierDuplicateDeletions(sourceId, targetRows));
    }
    return { packageId: packageRecord.id, targetCompanyId: packageRecord.targetCompanyId, sourceIdentitiesInspected: sourceIds.size, candidates };
  }

  private async assertStillSafe(
    tx: Prisma.TransactionClient,
    context: TrustedTenantAdministratorContext,
    companyId: string,
    candidate: NurixExcelSupplierDuplicateCleanupCandidate,
  ): Promise<void> {
    const supplier = await tx.financeSupplier.findFirst({
      where: { id: candidate.duplicateTargetId, tenantId: context.tenantId, companyId },
      select: { id: true, _count: { select: { outflowDocuments: true, recurringExpenseProfiles: true, dues: true, dailySalesClosings: true, hrEmployeeServices: true, suggestedForCategories: true } } },
    });
    const provenance = await tx.supplierCopyProvenance.count({ where: { tenantId: context.tenantId, companyId, targetSupplierId: candidate.duplicateTargetId } });
    if (!supplier || usageTotal({
      outflows: supplier._count.outflowDocuments, recurringProfiles: supplier._count.recurringExpenseProfiles,
      supplierDues: supplier._count.dues, dailySalesClosings: supplier._count.dailySalesClosings,
      employeeServices: supplier._count.hrEmployeeServices, suggestedCategories: supplier._count.suggestedForCategories,
      copyProvenance: provenance,
    }) !== 0 || candidate.otherSourceMapReferences !== 0)
      throw new ConflictException('Duplicate supplier is no longer proven unused; run a fresh dry-run.');
  }

  private report(
    plan: Readonly<{ packageId: string; targetCompanyId: string; sourceIdentitiesInspected: number; candidates: readonly NurixExcelSupplierDuplicateCleanupCandidate[] }>,
    dryRun: boolean,
    deleted: number,
  ): NurixExcelSupplierDuplicateCleanupReport {
    return {
      packageId: plan.packageId,
      targetCompanyId: plan.targetCompanyId,
      dryRun,
      sourceIdentitiesInspected: plan.sourceIdentitiesInspected,
      deletionReady: plan.candidates.filter((candidate) => candidate.state === 'DELETE_READY').length,
      reviewRequired: plan.candidates.filter((candidate) => candidate.state === 'REVIEW_REQUIRED').length,
      deleted,
      candidates: plan.candidates,
    };
  }
}

/** Pure selection rule, intentionally independent of supplier display names. */
export function selectSupplierDuplicateDeletions(sourceId: string, targets: readonly SupplierTarget[]): NurixExcelSupplierDuplicateCleanupCandidate[] {
  const used = targets.filter((target) => usageTotal(target.usage) > 0);
  if (used.length !== 1) {
    return targets.map((target) => ({
      sourceId, canonicalTargetId: null, duplicateTargetId: target.targetId, sourceMapIds: target.sourceMapIds,
      state: 'REVIEW_REQUIRED' as const,
      reason: used.length === 0 ? 'NO_USED_CANONICAL_TARGET' : 'MULTIPLE_USED_TARGETS',
      usage: target.usage, otherSourceMapReferences: target.otherSourceMapReferences,
    }));
  }
  const canonical = used[0]!;
  return targets
    .filter((target) => target.targetId !== canonical.targetId)
    .map((target) => ({
      sourceId,
      canonicalTargetId: canonical.targetId,
      duplicateTargetId: target.targetId,
      sourceMapIds: target.sourceMapIds,
      state: usageTotal(target.usage) === 0 && target.otherSourceMapReferences === 0 ? 'DELETE_READY' as const : 'REVIEW_REQUIRED' as const,
      reason: usageTotal(target.usage) !== 0 ? 'DUPLICATE_TARGET_IS_USED'
        : target.otherSourceMapReferences !== 0 ? 'DUPLICATE_TARGET_HAS_OTHER_LINEAGE'
          : 'UNUSED_DUPLICATE_WITH_ONE_USED_CANONICAL_TARGET',
      usage: target.usage,
      otherSourceMapReferences: target.otherSourceMapReferences,
    }));
}

function emptyUsage(): SupplierUsage {
  return { outflows: 0, recurringProfiles: 0, supplierDues: 0, dailySalesClosings: 0, employeeServices: 0, suggestedCategories: 0, copyProvenance: 0 };
}

function usageTotal(usage: SupplierUsage): number {
  return usage.outflows + usage.recurringProfiles + usage.supplierDues + usage.dailySalesClosings
    + usage.employeeServices + usage.suggestedCategories + usage.copyProvenance;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    const group = groups.get(value) ?? [];
    group.push(row);
    groups.set(value, group);
  }
  return groups;
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
