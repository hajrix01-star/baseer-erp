import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma, ReportRunStatus } from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';

/** The frozen boundary policy stored with every R0-B report run. */
export const REPORTING_R0_B_BOUNDARY_POLICY_VERSION = 'REPORTING_R0_B_2026_08_20';
export const SEALED_LEDGER_ENTRY_PREDICATE_VERSION = 'sealed_posted_or_reversed_v1';

/** Distinguishes an expired immutable report snapshot from an unrelated 404. */
export class ReportRunExpiredException extends NotFoundException {
  constructor() { super('The report run has expired.'); }
}

export type CreateReportRunInput = Readonly<{
  reportCode: string;
  definitionVersion: string;
  canonicalOptions: Prisma.InputJsonValue;
  economicAsOfDate: Date;
  sourceCoverage: Prisma.InputJsonValue;
  projectionWatermark?: Prisma.InputJsonValue | null;
  accountMappingVersionId?: string | null;
  accountMappingChecksum?: string | null;
  expiresAt?: Date;
}>;

export type ReportRunReceipt = Readonly<{
  reportRunId: string;
  ledgerRevision: string;
  checksum: string;
  expiresAt: Date;
}>;

/**
 * R0-B owns a report's source boundary, not its calculation or presentation.
 * Future report services must query sealed entries with
 * `ledgerRevision <= receipt.ledgerRevision`; that retains the original entry
 * in a historic run while excluding reversals sealed after that boundary.
 */
@Injectable()
export class ReportRunService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Capture the current sealed-ledger boundary for a live read without
   * persisting a ReportRun. Official output creation uses create() instead.
   */
  async currentLedgerRevision(context: TrustedCompanyActorContext): Promise<bigint> {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => (
      await transaction.financeLedgerRevision.findUnique({
        where: { tenantId_companyId: { tenantId: context.tenantId, companyId: context.companyId } },
        select: { currentRevision: true },
      })
    )?.currentRevision ?? BigInt(0));
  }

  async create(context: TrustedCompanyActorContext, input: CreateReportRunInput): Promise<ReportRunReceipt> {
    const reportCode = requiredText(input.reportCode, 80, 'A report code is required.');
    const definitionVersion = requiredText(input.definitionVersion, 80, 'A report definition version is required.');
    assertDate(input.economicAsOfDate, 'An economic as-of date is required.');
    const canonicalOptions = canonicalJson(input.canonicalOptions, 'Canonical report options are required.');
    const sourceCoverage = canonicalJson(input.sourceCoverage, 'Source coverage metadata is required.');
    const projectionWatermark = input.projectionWatermark === undefined || input.projectionWatermark === null
      ? null
      : canonicalJson(input.projectionWatermark, 'Projection watermark metadata must be valid JSON.');
    const mappingVersionId = optionalUuid(input.accountMappingVersionId, 'The account mapping version identifier must be a UUID.');
    const mappingChecksum = optionalChecksum(input.accountMappingChecksum);
    if ((mappingVersionId === null) !== (mappingChecksum === null)) {
      throw new BadRequestException('An account mapping version and checksum must be supplied together.');
    }
    const expiresAt = input.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1_000);
    assertDate(expiresAt, 'A valid report-run expiry is required.');
    if (expiresAt <= new Date()) throw new BadRequestException('A report-run expiry must be in the future.');

    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const ledgerRevision = (await transaction.financeLedgerRevision.findUnique({
        where: { tenantId_companyId: { tenantId: context.tenantId, companyId: context.companyId } },
        select: { currentRevision: true },
      }))?.currentRevision ?? BigInt(0);
      const checksum = reportRunChecksum({
        reportCode,
        definitionVersion,
        canonicalOptions,
        economicAsOfDate: input.economicAsOfDate,
        ledgerRevision,
        sourceCoverage,
        projectionWatermark,
        accountMappingVersionId: mappingVersionId,
        accountMappingChecksum: mappingChecksum,
      });
      const id = randomUUID();
      await transaction.reportRun.create({
        data: {
          id,
          tenantId: context.tenantId,
          companyId: context.companyId,
          reportCode,
          definitionVersion,
          canonicalOptionsJson: canonicalOptions,
          economicAsOfDate: input.economicAsOfDate,
          ledgerRevision,
          eligibleEntryPredicateVersion: SEALED_LEDGER_ENTRY_PREDICATE_VERSION,
          ...(projectionWatermark === null ? {} : { projectionWatermarkJson: projectionWatermark }),
          sourceCoverageJson: sourceCoverage,
          accountMappingVersionId: mappingVersionId,
          accountMappingChecksum: mappingChecksum,
          checksum,
          expiresAt,
          createdByUserId: context.actorUserId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: 'reports.run.created', entityType: 'ReportRun', entityId: id,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          afterJson: { reportCode, definitionVersion, ledgerRevision: ledgerRevision.toString(), checksum } as Prisma.InputJsonValue,
        },
      });
      return { reportRunId: id, ledgerRevision: ledgerRevision.toString(), checksum, expiresAt };
    });
  }

  async findReady(context: TrustedCompanyActorContext, reportRunId: string) {
    if (!isUuid(reportRunId)) throw new BadRequestException('A valid report run identifier is required.');
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const run = await transaction.reportRun.findFirst({
        where: { id: reportRunId, tenantId: context.tenantId, companyId: context.companyId },
      });
      if (!run) throw new NotFoundException('The ready report run was not found.');
      if (run.status === ReportRunStatus.EXPIRED || run.expiresAt <= new Date()) throw new ReportRunExpiredException();
      if (run.status !== ReportRunStatus.READY) throw new NotFoundException('The ready report run was not found.');
      return run;
    });
  }
}

export function reportRunChecksum(input: Readonly<{
  reportCode: string;
  definitionVersion: string;
  canonicalOptions: Prisma.InputJsonValue;
  economicAsOfDate: Date;
  ledgerRevision: bigint;
  sourceCoverage: Prisma.InputJsonValue;
  projectionWatermark: Prisma.InputJsonValue | null;
  accountMappingVersionId: string | null;
  accountMappingChecksum: string | null;
}>): string {
  return createHash('sha256').update(JSON.stringify({
    policyVersion: REPORTING_R0_B_BOUNDARY_POLICY_VERSION,
    predicateVersion: SEALED_LEDGER_ENTRY_PREDICATE_VERSION,
    reportCode: input.reportCode,
    definitionVersion: input.definitionVersion,
    canonicalOptions: input.canonicalOptions,
    economicAsOfDate: input.economicAsOfDate.toISOString().slice(0, 10),
    ledgerRevision: input.ledgerRevision.toString(),
    sourceCoverage: input.sourceCoverage,
    projectionWatermark: input.projectionWatermark,
    accountMappingVersionId: input.accountMappingVersionId,
    accountMappingChecksum: input.accountMappingChecksum,
  })).digest('hex');
}

/** Produces deterministic JSON by sorting keys recursively; arrays retain order. */
export function canonicalJson(value: Prisma.InputJsonValue, message = 'A JSON value is required.'): Prisma.InputJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item, message));
  if (typeof value !== 'object') throw new BadRequestException(message);
  const record = value as Record<string, Prisma.InputJsonValue | undefined>;
  const normalized: Record<string, Prisma.InputJsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) throw new BadRequestException(message);
    normalized[key] = canonicalJson(record[key]!, message);
  }
  return normalized;
}

function requiredText(value: string, maxLength: number, message: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maxLength) throw new BadRequestException(message);
  return normalized;
}

function optionalUuid(value: string | null | undefined, message: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isUuid(value)) throw new BadRequestException(message);
  return value;
}

function optionalChecksum(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!/^[a-f0-9]{64}$/.test(value)) throw new BadRequestException('The account mapping checksum must be a SHA-256 hexadecimal value.');
  return value;
}

function assertDate(value: Date, message: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new BadRequestException(message);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
