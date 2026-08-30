import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

type Row = Record<string, unknown>;
type EvidenceTreatment = 'HISTORICAL' | 'REVIEW';
type EvidenceSource = Readonly<{ sheet: string; entity: string; sourceId: string; sourceChecksum: string; treatment: EvidenceTreatment }>;
type EvidencePlan = Readonly<{ checksum: string; sources: readonly EvidenceSource[] }>;

const VERSION = 'nurix-excel-historical-evidence/v1';
const MAX_SOURCE_ID = 160;
const evidenceSheets: ReadonlyArray<Readonly<{ sheet: string; entity: string; sourceField: string; treatment: EvidenceTreatment }>> = [
  { sheet: 'BankStatements', entity: 'BankStatement', sourceField: 'source_id', treatment: 'HISTORICAL' },
  { sheet: 'BankTransactions', entity: 'BankTransaction', sourceField: 'source_id', treatment: 'HISTORICAL' },
  { sheet: 'VatPlanning', entity: 'VatPlanning', sourceField: 'source_id', treatment: 'HISTORICAL' },
  { sheet: 'Assets', entity: 'Asset', sourceField: 'source_id', treatment: 'HISTORICAL' },
  { sheet: 'CategoryAudit', entity: 'CategoryAudit', sourceField: 'source_category_id', treatment: 'REVIEW' },
];

export type NurixExcelEvidenceArchiveReceipt = Readonly<{
  executionId: string;
  status: 'COMPLETED';
  waves: number;
  archivedRows: Readonly<Record<'BankStatements' | 'BankTransactions' | 'VatPlanning' | 'Assets', number>>;
  reviewRequired: Readonly<Record<'CategoryAudit' | 'Exceptions', number>>;
  sourceMaps: number;
  financialWrites: 0;
}>;

/**
 * Archives only historical source lineage. It never reads or writes a finance
 * balance, journal, outflow, sales closing, supplier, vault, or payroll row.
 * CategoryAudit and Exceptions are deliberately persisted as REVIEW_REQUIRED,
 * not auto-approved evidence.
 */
@Injectable()
export class NurixExcelEvidenceArchiveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: NurixExcelStagingStorageService,
  ) {}

  async execute(
    context: TrustedTenantAdministratorContext,
    packageId: string,
    request: Readonly<{ reason?: string; waveSize?: number }> = {},
  ): Promise<NurixExcelEvidenceArchiveReceipt> {
    const waveSize = request.waveSize ?? 100;
    if (!Number.isInteger(waveSize) || waveSize < 25 || waveSize > 250) throw new BadRequestException('Evidence archive wave size must be between 25 and 250.');
    const packageRow = await this.verifiedPackage(context, packageId);
    const bytes = await this.storage.readVerified({ workbookSha256: packageRow.workbookSha256, artifact: packageRow });
    const plan = buildNurixEvidenceArchivePlan(bytes);
    const execution = await this.prepare(context, packageRow, plan, request.reason, waveSize);
    if (execution.status !== 'COMPLETED') {
      for (;;) {
        const wave = await this.claimWave(context, execution.id);
        if (!wave) break;
        await this.commitWave(context, execution.id, packageRow.targetCompanyId, wave, plan);
      }
      await this.reconcile(context, execution.id, packageRow.targetCompanyId, plan);
    }
    return this.receipt(execution.id, plan, Math.ceil(plan.sources.length / waveSize));
  }

  private async verifiedPackage(context: TrustedTenantAdministratorContext, packageId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const row = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: {
          id: true, targetCompanyId: true, workbookSha256: true, storageReference: true, encryptionIv: true, storedByteSize: true, status: true,
          company: { select: { status: true, migrationReviewLocked: true } },
        },
      });
      if (!row) throw new NotFoundException('The verified Noorix package was not found.');
      if (row.status !== 'READY_FOR_RECONCILIATION' || row.company.status !== 'ACTIVE' || !row.company.migrationReviewLocked) {
        throw new ConflictException('The target company must remain active and migration-locked while historical evidence is archived.');
      }
      if (!row.storageReference || !row.encryptionIv || row.storedByteSize === null) throw new ConflictException('The verified workbook artifact is unavailable.');
      return row as typeof row & { storageReference: string; encryptionIv: string; storedByteSize: bigint };
    });
  }

  private async prepare(context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelEvidenceArchiveService['verifiedPackage']>>, plan: EvidencePlan, reason: string | undefined, waveSize: number) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({
        where: { packageId: packageRow.id, tenantId: context.tenantId, transformVersion: VERSION },
        select: { id: true, status: true, financialPlanSha256: true },
      });
      if (existing) {
        if (existing.financialPlanSha256 !== plan.checksum) throw new ConflictException('The verified evidence plan changed; create a new package revision instead of resuming it.');
        if (!['APPROVED', 'RUNNING', 'COMPLETED'].includes(existing.status)) throw new ConflictException('The evidence execution is not safely resumable.');
        return existing;
      }
      const executionId = randomUUID();
      await tx.nurixExcelFinancialExecution.create({
        data: {
          id: executionId, packageId: packageRow.id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId,
          transformVersion: VERSION, financialPlanSha256: plan.checksum, status: 'APPROVED',
          reason: text(reason) || 'Historical Noorix evidence archive; no financial write.',
          requestedByUserId: context.actorUserId, approvedByUserId: context.actorUserId, approvedAt: new Date(),
        },
      });
      for (let offset = 0; offset < plan.sources.length; offset += waveSize) {
        const group = plan.sources.slice(offset, offset + waveSize);
        const waveId = randomUUID();
        await tx.nurixExcelFinancialWave.create({
          data: { id: waveId, executionId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sequence: offset / waveSize + 1, plannedItems: group.length },
        });
        await tx.nurixExcelFinancialItem.createMany({
          data: group.map((source) => ({
            id: randomUUID(), executionId, waveId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId,
            sourceSheet: source.sheet, sourceEntity: source.entity, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum,
            operationKey: sha({ version: VERSION, source }), status: 'PENDING',
          })),
        });
      }
      await tx.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: packageRow.targetCompanyId, actorUserId: context.actorUserId,
          action: 'nurix_excel.evidence_archive_prepared', entityType: 'NurixExcelFinancialExecution', entityId: executionId,
          requestId: `nurix-excel-evidence-plan:${executionId}`,
          afterJson: { planChecksum: plan.checksum, sources: plan.sources.length, financialWrites: 0 } as Prisma.InputJsonValue,
        },
      });
      return { id: executionId, status: 'APPROVED' as const, financialPlanSha256: plan.checksum };
    });
  }

  private async claimWave(context: TrustedTenantAdministratorContext, executionId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const candidate = await tx.nurixExcelFinancialWave.findFirst({
        where: { executionId, tenantId: context.tenantId, status: 'PENDING' }, orderBy: { sequence: 'asc' }, select: { id: true, sequence: true },
      });
      if (!candidate) return null;
      const token = randomUUID();
      const claim = await tx.nurixExcelFinancialWave.updateMany({
        where: { id: candidate.id, tenantId: context.tenantId, status: 'PENDING' },
        data: { status: 'RUNNING', leaseToken: token, leaseExpiresAt: new Date(Date.now() + 10 * 60_000) },
      });
      return claim.count === 1 ? { ...candidate, token } : null;
    });
  }

  private async commitWave(context: TrustedTenantAdministratorContext, executionId: string, companyId: string, wave: Readonly<{ id: string; sequence: number; token: string }>, plan: EvidencePlan) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const receiptRows = await tx.nurixExcelFinancialItem.findMany({
        where: { waveId: wave.id, tenantId: context.tenantId, status: 'PENDING' }, orderBy: { sourceId: 'asc' },
        select: { id: true, sourceEntity: true, sourceId: true, sourceChecksum: true },
      });
      const sources = new Map(plan.sources.map((source) => [`${source.entity}:${source.sourceId}`, source]));
      let archived = 0; let review = 0;
      for (const row of receiptRows) {
        const source = sources.get(`${row.sourceEntity}:${row.sourceId}`);
        if (!source || source.sourceChecksum !== row.sourceChecksum) throw new ConflictException('An evidence receipt no longer matches the verified workbook.');
        const isHistorical = source.treatment === 'HISTORICAL';
        await tx.nurixExcelFinancialSourceMap.create({
          data: {
            id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId,
            sourceEntity: source.entity, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum,
            targetEntity: isHistorical ? 'NurixHistoricalEvidenceArchive' : 'NurixOwnerReviewDecision',
            targetId: sha({ package: executionId, sheet: source.sheet, sourceId: source.sourceId }),
            state: isHistorical ? 'APPLIED' : 'PLANNED',
          },
        });
        await tx.nurixExcelFinancialItem.update({
          where: { id: row.id },
          data: isHistorical
            ? { status: 'EXCLUDED', targetEntity: 'NurixHistoricalEvidenceArchive', targetId: sha({ package: executionId, sheet: source.sheet, sourceId: source.sourceId }), resultCode: 'HISTORICAL_EVIDENCE_ARCHIVED' }
            : { status: 'REVIEW_REQUIRED', targetEntity: 'NurixOwnerReviewDecision', targetId: sha({ package: executionId, sheet: source.sheet, sourceId: source.sourceId }), resultCode: 'OWNER_REVIEW_REQUIRED' },
        });
        if (isHistorical) archived += 1; else review += 1;
      }
      const summary = { executionId, wave: wave.sequence, archivedRows: archived, reviewRequired: review, financialWrites: 0 };
      const receiptHash = sha(summary);
      await tx.nurixExcelFinancialWave.update({
        where: { id: wave.id },
        data: { status: 'COMMITTED', postedItems: 0, reviewItems: review, committedAt: new Date(), leaseToken: null, leaseExpiresAt: null, reconciliationHash: receiptHash },
      });
      await tx.nurixExcelFinancialReceipt.create({
        data: { id: randomUUID(), executionId, waveId: wave.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: wave.sequence, kind: 'WAVE_COMMITTED', receiptSha256: receiptHash, summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId },
      });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { waveSequence: wave.sequence } });
      await tx.auditEvent.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix_excel.evidence_archive_wave_committed', entityType: 'NurixExcelFinancialWave', entityId: wave.id, requestId: `nurix-excel-evidence-wave:${executionId}:${wave.sequence}`, afterJson: summary as Prisma.InputJsonValue },
      });
    });
  }

  private async reconcile(context: TrustedTenantAdministratorContext, executionId: string, companyId: string, plan: EvidencePlan) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [pending, resolved, lastWave] = await Promise.all([
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: 'PENDING' } }),
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: { in: ['EXCLUDED', 'REVIEW_REQUIRED'] } } }),
        tx.nurixExcelFinancialWave.findFirst({ where: { executionId, tenantId: context.tenantId, status: 'COMMITTED' }, orderBy: { sequence: 'desc' }, select: { id: true } }),
      ]);
      if (pending !== 0 || resolved !== plan.sources.length || !lastWave) throw new ConflictException('Evidence archive did not reconcile completely.');
      const summary = { sources: plan.sources.length, archived: plan.sources.filter((source) => source.treatment === 'HISTORICAL').length, reviewRequired: plan.sources.filter((source) => source.treatment === 'REVIEW').length, financialWrites: 0 };
      const receiptHash = sha(summary);
      const execution = await tx.nurixExcelFinancialExecution.findUniqueOrThrow({ where: { id: executionId }, select: { waveSequence: true } });
      await tx.nurixExcelFinancialReceipt.create({
        data: { id: randomUUID(), executionId, waveId: lastWave.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: execution.waveSequence + 1, kind: 'RECONCILIATION', receiptSha256: receiptHash, summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId },
      });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', leaseToken: null, leaseExpiresAt: null } });
      await tx.auditEvent.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix_excel.evidence_archive_reconciled', entityType: 'NurixExcelFinancialExecution', entityId: executionId, requestId: `nurix-excel-evidence-reconcile:${executionId}`, afterJson: summary as Prisma.InputJsonValue },
      });
    });
  }

  private receipt(executionId: string, plan: EvidencePlan, waves: number): NurixExcelEvidenceArchiveReceipt {
    const count = (sheet: string) => plan.sources.filter((source) => source.sheet === sheet).length;
    return {
      executionId, status: 'COMPLETED', waves,
      archivedRows: { BankStatements: count('BankStatements'), BankTransactions: count('BankTransactions'), VatPlanning: count('VatPlanning'), Assets: count('Assets') },
      reviewRequired: { CategoryAudit: count('CategoryAudit'), Exceptions: count('Exceptions') },
      sourceMaps: plan.sources.length, financialWrites: 0,
    };
  }
}

/** Exported for deterministic verification without a database or ERP writer. */
export function buildNurixEvidenceArchivePlan(bytes: Buffer): EvidencePlan {
  const workbook = XLSX.read(bytes, { type: 'buffer', raw: true });
  const sources: EvidenceSource[] = [];
  for (const definition of evidenceSheets) {
    const sheet = workbook.Sheets[definition.sheet];
    if (!sheet) throw new BadRequestException(`The verified workbook is missing ${definition.sheet}.`);
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: true });
    for (const row of rows) sources.push(source(definition.sheet, definition.entity, definition.sourceField, definition.treatment, row));
  }
  const exceptions = workbook.Sheets.Exceptions;
  if (!exceptions) throw new BadRequestException('The verified workbook is missing Exceptions.');
  for (const row of XLSX.utils.sheet_to_json<Row>(exceptions, { defval: '', raw: true })) {
    const sourceSheet = text(row.source_sheet);
    const sourceId = text(row.source_id);
    if (!sourceSheet || !sourceId) throw new BadRequestException('An Exceptions row has no source identity.');
    sources.push({ sheet: 'Exceptions', entity: `NoorixException:${sourceSheet}`, sourceId: bounded(sourceId), sourceChecksum: sha(canonical(row)), treatment: 'REVIEW' });
  }
  const seen = new Set<string>();
  for (const item of sources) {
    const key = `${item.entity}:${item.sourceId}`;
    if (seen.has(key)) throw new ConflictException(`Duplicate historical evidence source identity: ${key}.`);
    seen.add(key);
  }
  return { checksum: sha({ version: VERSION, sources: sources.map((item) => [item.sheet, item.entity, item.sourceId, item.sourceChecksum, item.treatment]) }), sources };
}

function source(sheet: string, entity: string, sourceField: string, treatment: EvidenceTreatment, row: Row): EvidenceSource {
  const sourceId = bounded(text(row[sourceField]));
  if (!sourceId) throw new BadRequestException(`${sheet} has a row without ${sourceField}.`);
  return { sheet, entity, sourceId, sourceChecksum: sha(canonical(row)), treatment };
}

function canonical(row: Row): Record<string, string> { return Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, text(value)])); }
function bounded(value: string): string { if (value.length > MAX_SOURCE_ID) throw new BadRequestException('A historical evidence source identity exceeds the allowed length.'); return value; }
function text(value: unknown): string { return value === undefined || value === null ? '' : String(value).trim(); }
function sha(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
