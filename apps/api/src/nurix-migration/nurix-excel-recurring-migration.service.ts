import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceCashPerformanceDirection,
  FinanceCashPerformanceEventKind,
  FinanceCategoryKind,
  FinanceCategoryStatus,
  FinanceOutflowDocumentKind,
  FinanceOutflowSettlementKind,
  FinanceRecurringExpenseStatus,
  FinanceVaultPaymentMethod,
  FinanceVaultStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { FinanceCashPerformanceEventService } from '../finance/finance-cash-performance-event.service.js';
import { JournalPostingService } from '../finance/journal/journal-posting.service.js';
import { resolveNoorixVaultReference } from './nurix-excel-reference-mapping.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

type Row = Record<string, unknown>;
type ProfilePlan = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  nameAr: string;
  nameEn: string;
  supplierSourceId: string;
  categoryCode: string;
  expectedAmount: string;
  intervalMonths: number;
  status: 'ACTIVE' | 'ARCHIVED';
  serviceNumber: string | null;
  notes: string | null;
  nextReminderDate: Date;
  /**
   * A profile with no positive expected value is historical evidence, not a
   * valid Baseer recurring profile. Keep it and its payments reviewable
   * instead of allowing a database constraint to stop the entire execution.
   */
  reviewCode: 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE' | null;
}>;
type PaymentPlan = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  profileSourceId: string;
  supplierSourceId: string;
  categoryCode: string;
  vaultSourceId: string;
  documentNumber: string;
  businessDate: Date;
  businessDateIso: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  coverageYear: number;
  coverageStartMonth: number;
  coverageMonths: number;
  /** The coverage table records only one unambiguous source payment per interval. */
  writeCoverage: boolean;
  /** An owner may preserve a known historical source overlap as invoices, but
   * never turn it into future recurring-coverage evidence. */
  historicalCoverageOverride?: boolean;
  status: 'POST' | 'EXCLUDE' | 'REVIEW_REQUIRED';
  reviewCode: 'DUPLICATE_SOURCE_PAYMENT' | 'UNPROVEN_CONCURRENT_COVERAGE' | 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE' | null;
  notes: string | null;
}>;
type PendingPaymentPlan = Omit<PaymentPlan, 'writeCoverage' | 'status' | 'reviewCode'> & Readonly<{
  active: boolean;
  coverageKey: string | null;
  duplicateKey: string | null;
}>;
type SupplierResolution = Readonly<{ targetId: string }> | Readonly<{ reviewCode: 'SUPPLIER_SOURCE_MAP_MISSING' | 'SUPPLIER_SOURCE_MAP_AMBIGUOUS' }>;
type RecurringPlan = Readonly<{
  profiles: readonly ProfilePlan[];
  payments: readonly PaymentPlan[];
  suppliers: ReadonlyMap<string, Readonly<{ nameAr: string; nameEn: string | null; checksum: string }>>;
  vaults: ReadonlyMap<string, Readonly<{ nameAr: string; checksum: string }>>;
  planChecksum: string;
  postedGrossAmount: string;
}>;
type PackageRecord = Readonly<{
  id: string;
  targetCompanyId: string;
  sourceCompanyId: string;
  workbookSha256: string;
  storageReference: string;
  encryptionIv: string;
  storedByteSize: bigint;
}>;

const VERSION = 'nurix-excel-historical-recurring-expense/v1';
// v3 retains the one approved, evidence-backed legacy-category resolution for
// Muqeem and reuses facts written by v2. v1 was stopped before a financial
// write because EXP-002 is a non-posting parent category in BASEER.
const ZERO_EXPECTED_REMEDIATION_VERSION = 'nurix-excel-historical-recurring-expense-zero-expected-remediation/v3';
const ZERO_EXPECTED_REMEDIATION_AUDIT_ACTION = 'nurix_excel.recurring_zero_remediation';
const ZERO_EXPECTED_REMEDIATION_AUDIT_REQUEST_PREFIX = 'nurix-zero-recurring';
const CONCURRENT_COVERAGE_OVERRIDE_VERSION = 'nurix-excel-historical-recurring-concurrent-coverage-owner-override/v1';
const REFERENCE_VERSION = 'nurix-excel-reference-allocation/v1';
const PROFILE_ENTITY = 'RecurringExpenseProfile';
const PAYMENT_ENTITY = 'RecurringExpensePayment';
const SUPPLIER_ENTITY = 'Supplier';
const VAULT_ENTITY = 'Vault';
const REQUIRED_INTERVALS = new Set([1, 2, 3, 4, 6, 12]);
const REOPENABLE_REFERENCE_REVIEW_CODES = new Set([
  'SUPPLIER_SOURCE_MAP_MISSING',
  'SUPPLIER_SOURCE_MAP_AMBIGUOUS',
  'PROFILE_SOURCE_MAP_UNAVAILABLE',
]);

/** Owner-approved values for the only zero-value historical profiles that may
 * be remediated. The key is a normalized *explicit* label, never a fuzzy
 * supplier/profile search. Profiles absent from this list remain evidence. */
const ZERO_EXPECTED_PROFILE_DECISIONS = new Map<string, Readonly<{ expectedAmount: string; targetCategoryCode?: string }>>([
  ['stctel0510611468', { expectedAmount: '216.8700' }], ['vat15', { expectedAmount: '6598.0000' }], ['رخصةالبلدية', { expectedAmount: '4848.5000' }],
  ['رسومماءستيووك', { expectedAmount: '1000.0000' }], ['فتح24', { expectedAmount: '3044.0000' }],
  ['كهرب1كبير', { expectedAmount: '3921.9000' }],
  // Muqeem is an iqama/passport service. EXP-002 is its legacy parent; E2-4
  // is BASEER's active posting child, as defined by the standard supplier seed.
  ['مقيم', { expectedAmount: '1265.0000', targetCategoryCode: 'E2-4' }],
]);

// The owner confirmed these are genuine historical rent invoices despite
// Noorix's incomplete lease-coverage dates. This is an exact source-id list;
// it cannot approve another overlap merely because its name or amount matches.
const APPROVED_CONCURRENT_COVERAGE_PAYMENT_IDS = new Set([
  'cmoocu3ue00024m6y2iy496i9', 'cmqmvdyvt000s4y44y410mqmh',
  'cmrqqyo6v00exnjp08iwswzlf', 'cmt63030w03cvs10ijlza98nd',
]);

export type NurixExcelRecurringMigrationReceipt = Readonly<{
  executionId: string;
  status: 'COMPLETED';
  profiles: number;
  postedPayments: number;
  excludedPayments: number;
  reviewPayments: number;
  grossAmount: string;
  waves: number;
}>;

/**
 * Controlled writer for Noorix fixed-expense history. It deliberately does
 * not use the normal recurring-payment endpoint: that endpoint calculates VAT
 * from today's company configuration, while historical source net/tax/gross
 * must remain exactly as attested in the verified Excel package.
 */
@Injectable()
export class NurixExcelRecurringMigrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: NurixExcelStagingStorageService,
    private readonly journals: JournalPostingService,
    private readonly cashEvents: FinanceCashPerformanceEventService,
  ) {}

  async execute(
    context: TrustedTenantAdministratorContext,
    packageId: string,
    input: Readonly<{ reason?: string; waveSize?: number }> = {},
  ): Promise<NurixExcelRecurringMigrationReceipt> {
    const waveSize = this.waveSize(input.waveSize);
    const packageRecord = await this.package(context, packageId);
    const bytes = await this.storage.readVerified({
      workbookSha256: packageRecord.workbookSha256,
      artifact: {
        storageReference: packageRecord.storageReference,
        encryptionIv: packageRecord.encryptionIv,
        storedByteSize: packageRecord.storedByteSize,
      },
    });
    const plan = planNurixRecurringExpenseRows(this.readRows(bytes));
    const execution = await this.prepare(context, packageRecord, plan, input.reason, waveSize);
    if (execution.status === 'COMPLETED') return this.receipt(execution.id, plan, Math.max(1, execution.waveSequence - 1));

    await this.recoverExpiredWaves(context, execution.id);
    for (;;) {
      const wave = await this.claimNextWave(context, execution.id);
      if (!wave) break;
      await this.commitWave(context, packageRecord.id, packageRecord.targetCompanyId, execution.id, wave, plan);
    }
    await this.reconcile(context, packageRecord.targetCompanyId, execution.id, plan);
    return this.receipt(execution.id, plan, Math.ceil(plan.payments.length / waveSize) + 1);
  }

  /**
   * A separate, owner-approved remediation transform for the explicit
   * zero-expected profiles. It never reopens or rewrites the first recurring
   * execution: its own version, source maps, waves and receipts form the
   * idempotency boundary. Profiles without an approved value and profiles
   * without an active historical payment are deliberately absent.
   */
  async executeZeroExpectedProfileRemediation(
    context: TrustedTenantAdministratorContext,
    packageId: string,
    input: Readonly<{ reason?: string; waveSize?: number }> = {},
  ): Promise<NurixExcelRecurringMigrationReceipt> {
    const waveSize = this.waveSize(input.waveSize);
    const packageRecord = await this.package(context, packageId);
    const bytes = await this.storage.readVerified({
      workbookSha256: packageRecord.workbookSha256,
      artifact: {
        storageReference: packageRecord.storageReference,
        encryptionIv: packageRecord.encryptionIv,
        storedByteSize: packageRecord.storedByteSize,
      },
    });
    const plan = planApprovedZeroExpectedRecurringRemediation(planNurixRecurringExpenseRows(this.readRows(bytes)));
    if (!plan.profiles.length || !plan.payments.length)
      throw new ConflictException('No owner-approved zero-expected recurring profile has an active historical payment in this verified package.');
    const execution = await this.prepare(context, packageRecord, plan, input.reason, waveSize, ZERO_EXPECTED_REMEDIATION_VERSION);
    if (execution.status === 'COMPLETED') return this.receipt(execution.id, plan, Math.max(1, execution.waveSequence - 1));
    await this.recoverExpiredWaves(context, execution.id);
    for (;;) {
      const wave = await this.claimNextWave(context, execution.id);
      if (!wave) break;
      await this.commitWave(context, packageRecord.id, packageRecord.targetCompanyId, execution.id, wave, plan);
    }
    await this.reconcile(context, packageRecord.targetCompanyId, execution.id, plan);
    return this.receipt(execution.id, plan, Math.ceil(plan.payments.length / waveSize) + 1);
  }

  /**
   * Owner-confirmed historical rent invoices whose Noorix coverage dates
   * overlap. They are posted with their original dates and amounts, but no
   * recurring-coverage slots are created; the overlap therefore cannot block
   * or manufacture a future recurring obligation in BASEER.
   */
  async executeApprovedConcurrentCoverageOverride(
    context: TrustedTenantAdministratorContext,
    packageId: string,
    input: Readonly<{ reason?: string; waveSize?: number }> = {},
  ): Promise<NurixExcelRecurringMigrationReceipt> {
    const waveSize = this.waveSize(input.waveSize);
    const packageRecord = await this.package(context, packageId);
    const bytes = await this.storage.readVerified({
      workbookSha256: packageRecord.workbookSha256,
      artifact: {
        storageReference: packageRecord.storageReference,
        encryptionIv: packageRecord.encryptionIv,
        storedByteSize: packageRecord.storedByteSize,
      },
    });
    const plan = planApprovedConcurrentCoverageOverride(planNurixRecurringExpenseRows(this.readRows(bytes)));
    const execution = await this.prepare(context, packageRecord, plan, input.reason, waveSize, CONCURRENT_COVERAGE_OVERRIDE_VERSION);
    if (execution.status === 'COMPLETED') return this.receipt(execution.id, plan, Math.max(1, execution.waveSequence - 1));
    await this.recoverExpiredWaves(context, execution.id);
    for (;;) {
      const wave = await this.claimNextWave(context, execution.id);
      if (!wave) break;
      await this.commitWave(context, packageRecord.id, packageRecord.targetCompanyId, execution.id, wave, plan);
    }
    await this.reconcile(context, packageRecord.targetCompanyId, execution.id, plan);
    return this.receipt(execution.id, plan, Math.ceil(plan.payments.length / waveSize) + 1);
  }

  private async package(context: TrustedTenantAdministratorContext, packageId: string): Promise<PackageRecord> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const value = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: {
          id: true, targetCompanyId: true, sourceCompanyId: true, workbookSha256: true,
          storageReference: true, encryptionIv: true, storedByteSize: true, status: true,
          company: { select: { status: true, migrationReviewLocked: true } },
        },
      });
      if (!value) throw new NotFoundException('The verified Noorix package was not found.');
      if (value.status !== 'READY_FOR_RECONCILIATION' || value.company.status !== 'ACTIVE' || !value.company.migrationReviewLocked)
        throw new ConflictException('The target company must remain active and migration-locked for recurring-expense history import.');
      if (!value.storageReference || !value.encryptionIv || value.storedByteSize === null)
        throw new ConflictException('The verified workbook artifact is unavailable.');
      return value as PackageRecord;
    });
  }

  private async prepare(
    context: TrustedTenantAdministratorContext,
    packageRecord: PackageRecord,
    plan: RecurringPlan,
    reason: string | undefined,
    waveSize: number,
    transformVersion = VERSION,
  ) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({
        where: { packageId: packageRecord.id, tenantId: context.tenantId, transformVersion },
        select: { id: true, status: true, waveSequence: true, financialPlanSha256: true },
      });
      if (existing) {
        if (existing.financialPlanSha256 !== plan.planChecksum)
          throw new ConflictException('The verified recurring-expense plan differs from its existing resume checkpoint.');
        if (!['APPROVED', 'COMPLETED'].includes(existing.status))
          throw new ConflictException('This recurring-expense execution is not available to resume.');
        // A first recurring run can reach its review checkpoint before the
        // independent supplier-reference writer has completed. Reopen only
        // those dependency-blocked rows; evidence-based coverage reviews
        // remain terminal and create no financial fact.
        const reopened = await this.reopenResolvedReferenceReviews(tx, existing.id);
        if (!reopened) return existing;
        return tx.nurixExcelFinancialExecution.update({
          where: { id: existing.id },
          data: { status: 'APPROVED', leaseToken: null, leaseExpiresAt: null },
          select: { id: true, status: true, waveSequence: true, financialPlanSha256: true },
        });
      }

      const executionId = randomUUID();
      await tx.nurixExcelFinancialExecution.create({
        data: {
          id: executionId, packageId: packageRecord.id, tenantId: context.tenantId,
          targetCompanyId: packageRecord.targetCompanyId, transformVersion,
          financialPlanSha256: plan.planChecksum, status: 'APPROVED',
          reason: optionalText(reason) ?? 'Owner-authorized historical Noorix recurring-expense import.',
          requestedByUserId: context.actorUserId, approvedByUserId: context.actorUserId, approvedAt: new Date(),
        },
      });
      const groups: Array<readonly (ProfilePlan | PaymentPlan)[]> = [plan.profiles, ...chunk(plan.payments, waveSize)];
      for (const [index, rows] of groups.entries()) {
        const waveId = randomUUID();
        await tx.nurixExcelFinancialWave.create({
          data: { id: waveId, executionId, tenantId: context.tenantId, targetCompanyId: packageRecord.targetCompanyId, sequence: index + 1, plannedItems: rows.length },
        });
        await tx.nurixExcelFinancialItem.createMany({
          data: rows.map((row) => ({
            id: randomUUID(), executionId, waveId, tenantId: context.tenantId, targetCompanyId: packageRecord.targetCompanyId,
            sourceSheet: isProfile(row) ? 'RecurringExpenseProfiles' : 'RecurringExpensePayments',
            sourceEntity: isProfile(row) ? PROFILE_ENTITY : PAYMENT_ENTITY,
            sourceId: row.sourceId, sourceChecksum: row.sourceChecksum,
            operationKey: sha({ version: transformVersion, entity: isProfile(row) ? PROFILE_ENTITY : PAYMENT_ENTITY, sourceId: row.sourceId }),
            status: (isProfile(row) && row.reviewCode) || (!isProfile(row) && row.status === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : 'PENDING',
            ...(isProfile(row) && row.reviewCode ? { resultCode: row.reviewCode, targetEntity: 'NoorixRecurringProfileReviewEvidence', targetId: row.sourceId } : {}),
            ...(!isProfile(row) && row.reviewCode ? { resultCode: row.reviewCode, targetEntity: 'NoorixRecurringPaymentReviewEvidence', targetId: row.sourceId } : {}),
          })),
        });
      }
      await tx.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: packageRecord.targetCompanyId, actorUserId: context.actorUserId,
          // The transform version is immutable execution metadata, not an
          // AuditEvent action. In particular the zero-value remediation
          // version is longer than the audit column's 120-character contract.
          action: transformVersion === ZERO_EXPECTED_REMEDIATION_VERSION
            ? ZERO_EXPECTED_REMEDIATION_AUDIT_ACTION
            : 'nurix_excel.recurring_execution_approved',
          entityType: 'NurixExcelFinancialExecution', entityId: executionId,
          requestId: transformVersion === ZERO_EXPECTED_REMEDIATION_VERSION
            ? `${ZERO_EXPECTED_REMEDIATION_AUDIT_REQUEST_PREFIX}:${executionId}`
            : `nurix-excel-recurring-plan:${executionId}`,
          afterJson: { transformVersion, profiles: plan.profiles.length, payments: plan.payments.length, grossAmount: plan.postedGrossAmount, planChecksum: plan.planChecksum } as Prisma.InputJsonValue,
        },
      });
      return { id: executionId, status: 'APPROVED' as const, waveSequence: 0, financialPlanSha256: plan.planChecksum };
    });
  }

  /**
   * REVIEW_REQUIRED is normally terminal evidence. These specific codes only
   * say that a package-local reference dependency was unavailable earlier.
   * They create neither a target nor a source map, so this reset cannot
   * duplicate a financial fact. The wave keeps its identity and receipt slot.
   */
  private async reopenResolvedReferenceReviews(tx: Prisma.TransactionClient, executionId: string): Promise<boolean> {
    const retryable = await tx.nurixExcelFinancialItem.findMany({
      where: {
        executionId,
        status: 'REVIEW_REQUIRED',
        resultCode: { in: [...REOPENABLE_REFERENCE_REVIEW_CODES] },
      },
      select: { id: true, waveId: true },
    });
    if (!retryable.length) return false;
    const itemIds = retryable.map((item) => item.id);
    const waveIds = [...new Set(retryable.map((item) => item.waveId))];
    await tx.nurixExcelFinancialItem.updateMany({
      where: {
        id: { in: itemIds },
        executionId,
        status: 'REVIEW_REQUIRED',
        resultCode: { in: [...REOPENABLE_REFERENCE_REVIEW_CODES] },
      },
      data: { status: 'PENDING', targetEntity: null, targetId: null, resultCode: null },
    });
    await tx.nurixExcelFinancialWave.updateMany({
      where: { id: { in: waveIds }, executionId, status: { in: ['COMMITTED', 'FAILED'] } },
      data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null, committedAt: null },
    });
    return true;
  }

  /**
   * Claiming a wave and committing it use separate transactions. A process
   * crash can therefore leave only the lease in RUNNING; all business writes
   * and the final COMMITTED status are in the later single transaction. Once
   * the lease expires, including for the profile wave, returning it to PENDING
   * is safe and resumes through the same idempotent receipt slot.
   */
  private async recoverExpiredWaves(context: TrustedTenantAdministratorContext, executionId: string) {
    return this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelFinancialWave.updateMany({
      where: { executionId, tenantId: context.tenantId, status: 'RUNNING', leaseExpiresAt: { lt: new Date() } },
      data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null },
    }));
  }

  private async claimNextWave(context: TrustedTenantAdministratorContext, executionId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const next = await tx.nurixExcelFinancialWave.findFirst({
        where: { executionId, tenantId: context.tenantId, status: { not: 'COMMITTED' } },
        orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, status: true },
      });
      if (!next) return null;
      if (next.status === 'RUNNING') throw new ConflictException('A recurring-expense import wave is already running.');
      if (next.status !== 'PENDING') throw new ConflictException('A recurring-expense import wave requires review before it can resume.');
      const leaseToken = randomUUID();
      const claimed = await tx.nurixExcelFinancialWave.updateMany({
        where: { id: next.id, tenantId: context.tenantId, status: 'PENDING' },
        data: { status: 'RUNNING', leaseToken, leaseExpiresAt: new Date(Date.now() + 10 * 60_000) },
      });
      if (claimed.count !== 1) throw new ConflictException('The recurring-expense import wave lease was not acquired.');
      return { id: next.id, sequence: next.sequence, leaseToken };
    });
  }

  private async commitWave(
    context: TrustedTenantAdministratorContext,
    packageId: string,
    companyId: string,
    executionId: string,
    wave: Readonly<{ id: string; sequence: number; leaseToken: string }>,
    plan: RecurringPlan,
  ) {
    const profileById = new Map(plan.profiles.map((row) => [row.sourceId, row]));
    const paymentById = new Map(plan.payments.map((row) => [row.sourceId, row]));
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const owned = await tx.nurixExcelFinancialWave.findFirst({
        where: { id: wave.id, executionId, tenantId: context.tenantId, status: 'RUNNING', leaseToken: wave.leaseToken },
        select: { id: true },
      });
      if (!owned) throw new ConflictException('The recurring-expense import wave lease was lost before posting.');
      const items = await tx.nurixExcelFinancialItem.findMany({
        where: { waveId: wave.id, tenantId: context.tenantId, status: { in: ['PENDING', 'REVIEW_REQUIRED'] } },
        orderBy: { sourceId: 'asc' }, select: { id: true, sourceEntity: true, sourceId: true, sourceChecksum: true },
      });
      if (!items.length) throw new ConflictException('A recurring-expense wave has no pending items.');
      const company = { tenantId: context.tenantId, companyId, actorUserId: context.actorUserId };
      let posted = 0;
      let excluded = 0;
      let review = 0;
      let gross = new Prisma.Decimal(0);
      for (const item of items) {
        if (item.sourceEntity === PROFILE_ENTITY) {
          const source = profileById.get(item.sourceId);
          if (!source || source.sourceChecksum !== item.sourceChecksum) throw new ConflictException('A recurring profile receipt no longer matches verified workbook evidence.');
          if (await this.writeProfile(tx, company, packageId, executionId, item.id, source, plan.suppliers) === 'REVIEW_REQUIRED') review += 1;
        } else if (item.sourceEntity === PAYMENT_ENTITY) {
          const source = paymentById.get(item.sourceId);
          if (!source || source.sourceChecksum !== item.sourceChecksum) throw new ConflictException('A recurring payment receipt no longer matches verified workbook evidence.');
          if (source.status === 'REVIEW_REQUIRED') {
            await this.recordReviewPayment(tx, item.id, source);
            review += 1;
          } else if (source.status === 'EXCLUDE') {
            await this.excludePayment(tx, company, executionId, item.id, source);
            excluded += 1;
          } else {
            if (await this.writePayment(tx, company, packageId, executionId, item.id, source, profileById, plan.suppliers, plan.vaults) === 'REVIEW_REQUIRED') review += 1;
            else { posted += 1; gross = gross.plus(source.grossAmount); }
          }
        } else throw new ConflictException('A recurring-expense execution contains an unsupported source entity.');
      }
      const summary = { executionId, wave: wave.sequence, profiles: items.filter((item) => item.sourceEntity === PROFILE_ENTITY).length, postedPayments: posted, excludedPayments: excluded, reviewPayments: review, grossAmount: gross.toFixed(4) };
      const receiptSha256 = sha(summary);
      await tx.nurixExcelFinancialWave.update({
        where: { id: wave.id },
        data: { status: 'COMMITTED', postedItems: posted + excluded + items.filter((item) => item.sourceEntity === PROFILE_ENTITY).length, reviewItems: review, committedAt: new Date(), leaseToken: null, leaseExpiresAt: null, reconciliationHash: receiptSha256 },
      });
      // A reopened wave retains its original sequence. Keep one canonical
      // technical receipt for that checkpoint instead of appending a second.
      await tx.nurixExcelFinancialReceipt.upsert({
        where: { executionId_sequence: { executionId, sequence: wave.sequence } },
        create: { id: randomUUID(), executionId, waveId: wave.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: wave.sequence, kind: 'WAVE_COMMITTED', receiptSha256, summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId },
        update: { waveId: wave.id, kind: 'WAVE_COMMITTED', receiptSha256, summaryJson: summary as Prisma.InputJsonValue },
      });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { waveSequence: wave.sequence } });
      await tx.auditEvent.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix_excel.recurring_wave_committed', entityType: 'NurixExcelFinancialWave', entityId: wave.id, requestId: `nurix-excel-recurring-wave:${executionId}:${wave.sequence}`, afterJson: summary as Prisma.InputJsonValue },
      });
    });
  }

  private async writeProfile(tx: Prisma.TransactionClient, context: { tenantId: string; companyId: string; actorUserId: string }, packageId: string, executionId: string, itemId: string, source: ProfilePlan, suppliers: RecurringPlan['suppliers']): Promise<'POSTED' | 'REVIEW_REQUIRED'> {
    if (source.reviewCode) {
      await this.recordReviewProfile(tx, itemId, source.sourceId, source.reviewCode);
      return 'REVIEW_REQUIRED';
    }
    const mapped = await tx.nurixExcelFinancialSourceMap.findFirst({
      where: { executionId, tenantId: context.tenantId, sourceEntity: PROFILE_ENTITY, sourceId: source.sourceId },
      select: { targetId: true, sourceChecksum: true },
    });
    if (mapped) {
      if (mapped.sourceChecksum !== source.sourceChecksum) throw new ConflictException('Recurring profile source checksum changed after approval.');
      await tx.nurixExcelFinancialItem.update({ where: { id: itemId }, data: { status: 'REUSED', targetEntity: 'FinanceRecurringExpenseProfile', targetId: mapped.targetId, resultCode: 'REUSED_PROFILE_MAP' } });
      return 'POSTED';
    }
    // A corrected remediation version must never recreate a profile already
    // committed by an earlier completed version of the *same package*. Reuse
    // only exact source lineage, never a display-name comparison.
    const completedMap = await tx.nurixExcelFinancialSourceMap.findFirst({
      where: {
        tenantId: context.tenantId, targetCompanyId: context.companyId,
        sourceEntity: PROFILE_ENTITY, sourceId: source.sourceId,
        execution: { packageId, targetCompanyId: context.companyId, status: 'COMPLETED' },
      },
      select: { targetId: true, sourceChecksum: true },
    });
    if (completedMap) {
      if (completedMap.sourceChecksum !== source.sourceChecksum) throw new ConflictException('Completed recurring profile source checksum conflicts with this verified package.');
      const completedProfile = await tx.financeRecurringExpenseProfile.findFirst({
        where: { id: completedMap.targetId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceRecurringExpenseStatus.ACTIVE, category: { code: source.categoryCode } },
        select: { id: true },
      });
      if (!completedProfile) throw new ConflictException('Completed recurring profile does not match the approved category resolution.');
      await tx.nurixExcelFinancialSourceMap.create({
        data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: context.companyId, sourceEntity: PROFILE_ENTITY, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceRecurringExpenseProfile', targetId: completedMap.targetId, state: 'APPLIED' },
      });
      await tx.nurixExcelFinancialItem.update({ where: { id: itemId }, data: { status: 'REUSED', targetEntity: 'FinanceRecurringExpenseProfile', targetId: completedMap.targetId, resultCode: 'REUSED_COMPLETED_PACKAGE_PROFILE' } });
      return 'POSTED';
    }
    const supplierResolution = await this.supplier(tx, context, packageId, source.supplierSourceId, suppliers.get(source.supplierSourceId));
    if ('reviewCode' in supplierResolution) { await this.recordReviewItem(tx, itemId, source.sourceId, supplierResolution.reviewCode); return 'REVIEW_REQUIRED'; }
    const supplierId = supplierResolution.targetId;
    const category = await tx.financeCategory.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, code: source.categoryCode, status: FinanceCategoryStatus.ACTIVE, isPosting: true, kind: FinanceCategoryKind.EXPENSE },
      select: { id: true },
    });
    if (!category) throw new ConflictException(`Recurring profile category ${source.categoryCode} is unavailable for posting.`);
    const profileId = randomUUID();
    await tx.financeRecurringExpenseProfile.create({
      data: {
        id: profileId, tenantId: context.tenantId, companyId: context.companyId, supplierId, categoryId: category.id,
        nameAr: source.nameAr, nameEn: source.nameEn, expectedAmount: source.expectedAmount, intervalMonths: source.intervalMonths,
        nextReminderDate: source.nextReminderDate, serviceNumber: source.serviceNumber, defaultVaultId: null,
        allowAmountOverride: true, status: source.status === 'ACTIVE' ? FinanceRecurringExpenseStatus.ACTIVE : FinanceRecurringExpenseStatus.ARCHIVED,
        notes: source.notes,
      },
    });
    await tx.nurixExcelFinancialSourceMap.create({
      data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: context.companyId, sourceEntity: PROFILE_ENTITY, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceRecurringExpenseProfile', targetId: profileId, state: 'APPLIED' },
    });
    await tx.nurixExcelFinancialItem.update({ where: { id: itemId }, data: { status: 'POSTED', targetEntity: 'FinanceRecurringExpenseProfile', targetId: profileId, resultCode: 'PROFILE_CREATED' } });
    return 'POSTED';
  }

  private async writePayment(tx: Prisma.TransactionClient, context: { tenantId: string; companyId: string; actorUserId: string }, packageId: string, executionId: string, itemId: string, source: PaymentPlan, profiles: ReadonlyMap<string, ProfilePlan>, suppliers: RecurringPlan['suppliers'], vaults: RecurringPlan['vaults']): Promise<'POSTED' | 'REVIEW_REQUIRED'> {
    const profileSource = profiles.get(source.profileSourceId);
    if (!profileSource) throw new ConflictException('The recurring payment profile is not part of the approved plan.');
    if (profileSource.reviewCode) {
      await this.recordReviewItem(tx, itemId, source.sourceId, profileSource.reviewCode);
      return 'REVIEW_REQUIRED';
    }
    const profileMap = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId, tenantId: context.tenantId, sourceEntity: PROFILE_ENTITY, sourceId: source.profileSourceId }, select: { targetId: true } });
    if (!profileMap) { await this.recordReviewItem(tx, itemId, source.sourceId, 'PROFILE_SOURCE_MAP_UNAVAILABLE'); return 'REVIEW_REQUIRED'; }
    const profile = await tx.financeRecurringExpenseProfile.findFirst({ where: { id: profileMap.targetId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceRecurringExpenseStatus.ACTIVE }, select: { id: true, supplierId: true, categoryId: true, intervalMonths: true } });
    if (!profile) throw new ConflictException('The mapped recurring profile is no longer active.');
    const supplierResolution = await this.supplier(tx, context, packageId, source.supplierSourceId, suppliers.get(source.supplierSourceId));
    if ('reviewCode' in supplierResolution) { await this.recordReviewItem(tx, itemId, source.sourceId, supplierResolution.reviewCode); return 'REVIEW_REQUIRED'; }
    const supplierId = supplierResolution.targetId;
    if (profile.supplierId !== supplierId || profileSource.categoryCode !== source.categoryCode) throw new ConflictException('The recurring payment conflicts with its approved profile supplier or category.');
    const category = await tx.financeCategory.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: source.categoryCode, status: FinanceCategoryStatus.ACTIVE, isPosting: true, kind: FinanceCategoryKind.EXPENSE }, select: { id: true, code: true, nameAr: true, nameEn: true, kind: true, accountId: true } });
    if (!category?.accountId || category.id !== profile.categoryId) throw new ConflictException('The recurring payment category is not the active mapped profile category.');
    const completedMap = await tx.nurixExcelFinancialSourceMap.findFirst({
      where: {
        tenantId: context.tenantId, targetCompanyId: context.companyId,
        sourceEntity: PAYMENT_ENTITY, sourceId: source.sourceId,
        execution: { packageId, targetCompanyId: context.companyId, status: 'COMPLETED' },
      },
      select: { targetId: true, sourceChecksum: true },
    });
    if (completedMap) {
      if (completedMap.sourceChecksum !== source.sourceChecksum) throw new ConflictException('Completed recurring payment source checksum conflicts with this verified package.');
      const completedDocument = await tx.financeOutflowDocument.findFirst({
        where: { id: completedMap.targetId, tenantId: context.tenantId, companyId: context.companyId, recurringExpenseProfileId: profile.id, categoryId: category.id, supplierInvoiceNumber: source.documentNumber },
        select: { id: true },
      });
      if (!completedDocument) throw new ConflictException('Completed recurring payment does not match the approved profile, category, or invoice number.');
      await tx.nurixExcelFinancialSourceMap.create({
        data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: context.companyId, sourceEntity: PAYMENT_ENTITY, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: completedMap.targetId, state: 'APPLIED' },
      });
      await tx.nurixExcelFinancialItem.update({ where: { id: itemId }, data: { status: 'REUSED', targetEntity: 'FinanceOutflowDocument', targetId: completedMap.targetId, resultCode: 'REUSED_COMPLETED_PACKAGE_PAYMENT' } });
      return 'POSTED';
    }
    const vault = await this.vault(tx, context, executionId, source.vaultSourceId, vaults.get(source.vaultSourceId));
    const existing = await tx.financeJournalEntry.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, sourceType: 'nurix_excel_historical_recurring', sourceReference: source.sourceId }, select: { id: true } });
    if (existing) throw new ConflictException('A recurring historical journal already exists outside this resumable execution.');
    const vatAccount = new Prisma.Decimal(source.taxAmount).isZero() ? null : await tx.financeAccount.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: 'VAT_INPUT', status: 'ACTIVE' }, select: { id: true } });
    if (!new Prisma.Decimal(source.taxAmount).isZero() && !vatAccount) throw new ConflictException('The VAT input account is unavailable for a historical recurring payment.');
    const documentId = randomUUID();
    const documentNumber = `NXR-R-${source.businessDateIso.replaceAll('-', '')}-${sha(source.sourceId).slice(0, 12).toUpperCase()}`;
    const journal = await this.journals.postInTransaction(tx, {
      ...context, requestId: `nurix-excel-recurring:${executionId}:${source.sourceId}`,
      sourceType: 'nurix_excel_historical_recurring', sourceReference: source.sourceId, businessDate: source.businessDate,
      description: `ترحيل مصروف دوري تاريخي من نوركس: ${source.documentNumber}`,
      lines: [
        { accountId: category.accountId, debitAmount: source.netAmount, description: documentNumber },
        ...(vatAccount ? [{ accountId: vatAccount.id, debitAmount: source.taxAmount, description: documentNumber }] : []),
        { accountId: vault.accountId, creditAmount: source.grossAmount, description: documentNumber },
      ],
    });
    const supplier = await tx.financeSupplier.findFirst({ where: { id: supplierId, tenantId: context.tenantId, companyId: context.companyId }, select: { nameAr: true, nameEn: true } });
    if (!supplier) throw new ConflictException('The recurring payment supplier is unavailable.');
    // Coverage carries a composite foreign key to the actual outflow document.
    // Create and retain that database record first: an ID generated locally is
    // not a valid coverage reference until its document exists in this tenant
    // and company. The entire wave is one transaction, so a later coverage
    // conflict rolls back this document, its journal and every receipt as one
    // unit; a resumed lease therefore cannot duplicate a payment.
    const document = await tx.financeOutflowDocument.create({
      data: {
        id: documentId, tenantId: context.tenantId, companyId: context.companyId, kind: FinanceOutflowDocumentKind.EXPENSE,
        settlementKind: FinanceOutflowSettlementKind.PAID, recurringExpenseProfileId: profile.id,
        coverageYear: source.historicalCoverageOverride ? null : source.coverageYear,
        coverageStartMonth: source.historicalCoverageOverride ? null : source.coverageStartMonth,
        coverageMonths: source.historicalCoverageOverride ? null : source.coverageMonths,
        documentNumber, supplierId, supplierNameSnapshotAr: supplier.nameAr, supplierNameSnapshotEn: supplier.nameEn,
        categoryId: category.id, supplierInvoiceNumber: source.documentNumber,
        supplierInvoiceNumberNormalized: source.documentNumber.toLocaleUpperCase('en-US'), businessDate: source.businessDate,
        supplierInvoiceDate: source.businessDate, grossAmount: source.grossAmount, netAmount: source.netAmount, vatAmount: source.taxAmount,
        vatRateBasisPoints: vatRate(source.netAmount, source.taxAmount), notes: recurringNotes(source), journalEntryId: journal.journalEntryId,
        createdByUserId: context.actorUserId,
      },
      select: { id: true, tenantId: true, companyId: true },
    });
    if (document.tenantId !== context.tenantId || document.companyId !== context.companyId)
      throw new ConflictException('The recurring payment document was created outside the target company.');
    if (source.writeCoverage) {
      const months = Array.from({ length: source.coverageMonths }, (_, index) => source.coverageStartMonth + index);
      try {
        await tx.financeRecurringExpenseCoverage.createMany({
          data: months.map((coverageMonth) => ({
            id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
            profileId: profile.id, coverageYear: source.coverageYear, coverageMonth,
            documentId: document.id,
          })),
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A recurring payment conflicts with previously committed coverage; retain it for reviewed resolution.');
        throw error;
      }
    }
    await tx.financeOutflowAllocation.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, documentId: document.id, vaultId: vault.id, grossAmount: source.grossAmount, paymentMethod: vault.paymentMethod } });
    await this.cashEvents.recordInTransaction(tx, context, {
      kind: FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT, direction: FinanceCashPerformanceDirection.OUTFLOW,
      businessDate: source.businessDate, grossAmount: source.grossAmount, netAmount: source.netAmount, vatAmount: source.taxAmount,
      sourceType: 'nurix_excel_historical_recurring', sourceId: document.id, sourceJournalEntryId: journal.journalEntryId,
      ledgerRevision: journal.ledgerRevision, category: { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, kind: category.kind },
      destinations: [{ vaultId: vault.id, amount: source.grossAmount, paymentMethod: vault.paymentMethod }],
    });
    await tx.nurixExcelFinancialSourceMap.createMany({
      data: [
        { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: context.companyId, sourceEntity: PAYMENT_ENTITY, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: document.id, state: 'APPLIED' },
      ],
    });
    await tx.nurixExcelFinancialItem.update({ where: { id: itemId }, data: { status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: document.id, resultCode: 'POSTED_HISTORICAL_RECURRING' } });
    return 'POSTED';
  }

  private async recordReviewPayment(tx: Prisma.TransactionClient, itemId: string, source: PaymentPlan) {
    if (!source.reviewCode) throw new ConflictException('A recurring payment review receipt is missing its immutable review code.');
    await this.recordReviewItem(tx, itemId, source.sourceId, source.reviewCode);
  }

  private async recordReviewProfile(tx: Prisma.TransactionClient, itemId: string, sourceId: string, code: string) {
    await tx.nurixExcelFinancialItem.update({
      where: { id: itemId },
      data: { status: 'REVIEW_REQUIRED', targetEntity: 'NoorixRecurringProfileReviewEvidence', targetId: sourceId, resultCode: code },
    });
  }

  private async recordReviewItem(tx: Prisma.TransactionClient, itemId: string, sourceId: string, code: string) {
    await tx.nurixExcelFinancialItem.update({
      where: { id: itemId },
      data: { status: 'REVIEW_REQUIRED', targetEntity: 'NoorixRecurringPaymentReviewEvidence', targetId: sourceId, resultCode: code },
    });
  }

  private async excludePayment(tx: Prisma.TransactionClient, context: { tenantId: string; companyId: string }, executionId: string, itemId: string, source: PaymentPlan) {
    await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: context.companyId, sourceEntity: PAYMENT_ENTITY, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'NoorixCancelledRecurringExpensePayment', targetId: source.sourceId, state: 'APPLIED' } });
    await tx.nurixExcelFinancialItem.update({ where: { id: itemId }, data: { status: 'EXCLUDED', targetEntity: 'NoorixCancelledRecurringExpensePayment', targetId: source.sourceId, resultCode: 'SOURCE_CANCELLED' } });
  }

  private async supplier(tx: Prisma.TransactionClient, context: { tenantId: string; companyId: string }, packageId: string, sourceId: string, source: Readonly<{ checksum: string }> | undefined): Promise<SupplierResolution> {
    if (!source) return { reviewCode: 'SUPPLIER_SOURCE_MAP_MISSING' };
    // Staging is the accepted lineage authority. Raw SheetJS serialization can
    // hash empty cells differently from intake and must not hide a valid map.
    const staged = await tx.nurixExcelStagingRow.findFirst({
      where: { packageId, tenantId: context.tenantId, sheet: 'Suppliers', sourceId, status: 'ACCEPTED' },
      select: { sourceChecksum: true },
    });
    if (!staged) return { reviewCode: 'SUPPLIER_SOURCE_MAP_MISSING' };
    const sourceMaps = await tx.nurixExcelFinancialSourceMap.findMany({
      where: {
        tenantId: context.tenantId, targetCompanyId: context.companyId, sourceEntity: SUPPLIER_ENTITY, sourceId,
        sourceChecksum: staged.sourceChecksum, targetEntity: 'FinanceSupplier', state: { in: ['APPLIED', 'REUSED'] },
        execution: { packageId, transformVersion: REFERENCE_VERSION, status: 'COMPLETED' },
      },
      select: { targetId: true },
    });
    const targetIds = [...new Set(sourceMaps.map((map) => map.targetId))];
    if (targetIds.length > 1) return { reviewCode: 'SUPPLIER_SOURCE_MAP_AMBIGUOUS' };
    const targetId = targetIds[0] ?? await this.canonicalSupplierFromDeletedDuplicateAudit(tx, context, packageId, sourceId);
    if (!targetId) return { reviewCode: 'SUPPLIER_SOURCE_MAP_MISSING' };
    const target = await tx.financeSupplier.findFirst({ where: { id: targetId, tenantId: context.tenantId, companyId: context.companyId, status: 'ACTIVE' }, select: { id: true } });
    return target ? { targetId: target.id } : { reviewCode: 'SUPPLIER_SOURCE_MAP_MISSING' };
  }

  /**
   * The duplicate-cleanup workflow intentionally deletes only a duplicate
   * Supplier map, retaining an audit receipt naming the canonical supplier.
   * Use that receipt only when it is bound to this exact package via the
   * deterministic cleanup request key. This is a recovery path for deleted
   * lineage, not a search: names and loose audit rows are never considered.
   */
  private async canonicalSupplierFromDeletedDuplicateAudit(tx: Prisma.TransactionClient, context: { tenantId: string; companyId: string }, packageId: string, sourceId: string): Promise<string | null> {
    const events = await tx.auditEvent.findMany({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        action: 'nurix_excel.supplier_duplicate_unused_deleted',
        entityType: 'FinanceSupplier',
      },
      select: { entityId: true, requestId: true, beforeJson: true },
    });
    const canonicalIds = new Set<string>();
    for (const event of events) {
      const before = event.beforeJson;
      if (!isDeletedSupplierDuplicateAudit(before, sourceId)) continue;
      // The cleanup audit predates packageId in beforeJson. Its request key is
      // a deterministic hash of package/source/deleted-target and therefore
      // remains the package-scoped proof without weakening the evidence.
      const expectedRequestId = `nurix-supplier-clean:${sha({ packageId, sourceId, targetId: event.entityId })}`;
      if (event.requestId !== expectedRequestId) continue;
      canonicalIds.add(before.canonicalTargetId);
    }
    return canonicalIds.size === 1 ? [...canonicalIds][0]! : null;
  }

  private async vault(tx: Prisma.TransactionClient, context: { tenantId: string; companyId: string }, executionId: string, sourceId: string, source: Readonly<{ nameAr: string; checksum: string }> | undefined) {
    const mapped = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId, tenantId: context.tenantId, sourceEntity: VAULT_ENTITY, sourceId }, select: { targetId: true } });
    if (mapped) {
      const target = await tx.financeVault.findFirst({ where: { id: mapped.targetId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceVaultStatus.ACTIVE, isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true, paymentMethods: true } });
      if (!target) throw new ConflictException('A recurring payment vault checkpoint is no longer an active payment destination.');
      return { ...target, paymentMethod: target.paymentMethod as FinanceVaultPaymentMethod };
    }
    if (!source) throw new ConflictException(`Vault ${sourceId} was not proven by the approved recurring plan.`);
    const resolution = resolveNoorixVaultReference({ sourceId, nameAr: source.nameAr });
    if (resolution.status !== 'MATCHED') throw new ConflictException(`Vault ${sourceId} requires an approved identity map.`);
    const vaults = await tx.financeVault.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceVaultStatus.ACTIVE, isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true, paymentMethods: true, account: { select: { code: true } } } });
    const target = vaults.find((candidate) => candidate.account.code.replace(/^NURIX-/, '') === resolution.mapping.targetVaultCode && candidate.paymentMethods.includes(resolution.mapping.paymentMethod as FinanceVaultPaymentMethod));
    if (!target) throw new ConflictException(`Vault ${resolution.mapping.targetNameAr} is not an active payment destination.`);
    await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: context.companyId, sourceEntity: VAULT_ENTITY, sourceId, sourceChecksum: source.checksum, targetEntity: 'FinanceVault', targetId: target.id, state: 'APPLIED' } });
    return { id: target.id, accountId: target.accountId, paymentMethod: resolution.mapping.paymentMethod as FinanceVaultPaymentMethod, paymentMethods: target.paymentMethods };
  }

  private async reconcile(context: TrustedTenantAdministratorContext, companyId: string, executionId: string, plan: RecurringPlan) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [unresolved, posted, excluded, review, latestWave] = await Promise.all([
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: { notIn: ['POSTED', 'REUSED', 'EXCLUDED', 'REVIEW_REQUIRED'] } } }),
        // A newer correction may reuse an exact fact committed by an earlier
        // completed version of this same package. It is reconciled financial
        // coverage, not an omission, and must count exactly once here.
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, sourceEntity: PAYMENT_ENTITY, status: { in: ['POSTED', 'REUSED'] } } }),
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, sourceEntity: PAYMENT_ENTITY, status: 'EXCLUDED' } }),
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, sourceEntity: PAYMENT_ENTITY, status: 'REVIEW_REQUIRED' } }),
        tx.nurixExcelFinancialWave.findFirst({ where: { executionId, tenantId: context.tenantId, status: 'COMMITTED' }, orderBy: { sequence: 'desc' }, select: { id: true } }),
      ]);
      if (unresolved || posted + excluded + review !== plan.payments.length || !latestWave) throw new ConflictException('The recurring-expense import did not reconcile completely.');
      const summary = { profiles: plan.profiles.length, postedPayments: posted, excludedPayments: excluded, reviewPayments: review, grossAmount: plan.postedGrossAmount, planChecksum: plan.planChecksum };
      const receiptSha256 = sha(summary);
      const sequence = (await tx.nurixExcelFinancialExecution.findUniqueOrThrow({ where: { id: executionId }, select: { waveSequence: true } })).waveSequence + 1;
      await tx.nurixExcelFinancialReceipt.upsert({
        where: { executionId_sequence: { executionId, sequence } },
        create: { id: randomUUID(), executionId, waveId: latestWave.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence, kind: 'RECONCILIATION', receiptSha256, summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId },
        update: { waveId: latestWave.id, kind: 'RECONCILIATION', receiptSha256, summaryJson: summary as Prisma.InputJsonValue },
      });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', waveSequence: sequence, leaseToken: null, leaseExpiresAt: null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix_excel.recurring_execution_reconciled', entityType: 'NurixExcelFinancialExecution', entityId: executionId, requestId: `nurix-excel-recurring-reconcile:${executionId}`, afterJson: summary as Prisma.InputJsonValue } });
    });
  }

  private receipt(executionId: string, plan: RecurringPlan, waves: number): NurixExcelRecurringMigrationReceipt {
    return { executionId, status: 'COMPLETED', profiles: plan.profiles.length, postedPayments: plan.payments.filter((item) => item.status === 'POST').length, excludedPayments: plan.payments.filter((item) => item.status === 'EXCLUDE').length, reviewPayments: plan.payments.filter((item) => item.status === 'REVIEW_REQUIRED').length, grossAmount: plan.postedGrossAmount, waves };
  }

  private readRows(bytes: Buffer) {
    const workbook = XLSX.read(bytes, { type: 'buffer', raw: true });
    const table = (name: string) => {
      const sheet = workbook.Sheets[name];
      if (!sheet) throw new BadRequestException(`The verified workbook is missing ${name}.`);
      return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: true });
    };
    return { profiles: table('RecurringExpenseProfiles'), payments: table('RecurringExpensePayments'), suppliers: table('Suppliers'), vaults: table('Vaults') };
  }

  private waveSize(value: number | undefined): number {
    if (value === undefined) return 10;
    if (!Number.isInteger(value) || value < 5 || value > 25) throw new BadRequestException('Recurring-expense wave size must be between 5 and 25.');
    return value;
  }
}

/**
 * Builds the narrow remediation plan from the verified package, not from the
 * prior execution's review rows. A profile is eligible only when its explicit
 * owner decision matches exactly after harmless case/spacing normalization,
 * the source value is actually non-positive, and it has at least one active
 * payment that the original plan retained as zero-value review evidence.
 */
export function planApprovedZeroExpectedRecurringRemediation(base: RecurringPlan): RecurringPlan {
  const profilesByDecision = new Map<string, ProfilePlan[]>();
  for (const profile of base.profiles) {
    const key = normalizeApprovedProfileLabel(profile.nameAr);
    if (!ZERO_EXPECTED_PROFILE_DECISIONS.has(key)) continue;
    const matches = profilesByDecision.get(key) ?? [];
    matches.push(profile);
    profilesByDecision.set(key, matches);
  }
  for (const [key, profiles] of profilesByDecision) {
    if (profiles.length !== 1)
      throw new ConflictException(`Owner-approved zero-expected profile decision ${key} matches more than one source profile.`);
  }
  const selected = new Map<string, ProfilePlan>();
  const approvedPaymentsByProfile = new Map<string, PaymentPlan[]>();
  for (const [key, profiles] of profilesByDecision) {
    const profile = profiles[0]!;
    const decision = ZERO_EXPECTED_PROFILE_DECISIONS.get(key)!;
    if (profile.reviewCode !== 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE' || profile.status !== 'ACTIVE')
      throw new ConflictException(`Owner-approved zero-expected profile ${profile.nameAr} is not an active zero-value source profile.`);
    const payments = base.payments.filter((payment) =>
      payment.profileSourceId === profile.sourceId
      && payment.status === 'REVIEW_REQUIRED'
      && payment.reviewCode === 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE',
    );
    // No active payment means no financial history to repair. In particular,
    // the tobacco licence zero profile stays outside this transform.
    if (!payments.length) continue;
    const latest = payments.map((payment) => payment.businessDate).sort((left, right) => right.valueOf() - left.valueOf())[0]!;
    if (decision.targetCategoryCode && profile.categoryCode !== 'EXP-002')
      throw new ConflictException(`Owner-approved category resolution for ${profile.nameAr} requires legacy EXP-002 source category.`);
    selected.set(profile.sourceId, {
      ...profile,
      expectedAmount: decision.expectedAmount,
      categoryCode: decision.targetCategoryCode ?? profile.categoryCode,
      reviewCode: null,
      nextReminderDate: new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() + profile.intervalMonths, 1)),
    });
    approvedPaymentsByProfile.set(profile.sourceId, payments.map((payment) => ({
      ...payment,
      categoryCode: decision.targetCategoryCode ?? payment.categoryCode,
    })));
  }
  const coverageGroups = new Map<string, PaymentPlan[]>();
  for (const payments of approvedPaymentsByProfile.values()) {
    for (const payment of payments) {
      const key = `${payment.profileSourceId}:${payment.coverageYear}:${payment.coverageStartMonth}`;
      const group = coverageGroups.get(key) ?? [];
      group.push(payment);
      coverageGroups.set(key, group);
    }
  }
  const payments: PaymentPlan[] = [];
  for (const group of coverageGroups.values()) {
    for (const payment of group) {
      const unambiguous = group.length === 1;
      payments.push({
        ...payment,
        writeCoverage: unambiguous,
        status: unambiguous ? 'POST' : 'REVIEW_REQUIRED',
        reviewCode: unambiguous ? null : 'UNPROVEN_CONCURRENT_COVERAGE',
      });
    }
  }
  payments.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const profiles = [...selected.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const postedGrossAmount = payments
    .filter((payment) => payment.status === 'POST')
    .reduce((total, payment) => total.plus(payment.grossAmount), new Prisma.Decimal(0))
    .toFixed(4);
  return {
    profiles,
    payments,
    suppliers: base.suppliers,
    vaults: base.vaults,
    postedGrossAmount,
    planChecksum: sha({
      version: ZERO_EXPECTED_REMEDIATION_VERSION,
      profiles: profiles.map((profile) => [profile.sourceId, profile.sourceChecksum, profile.expectedAmount, profile.categoryCode]),
      payments: payments.map((payment) => [payment.sourceId, payment.sourceChecksum, payment.categoryCode, payment.status, payment.reviewCode, payment.writeCoverage]),
    }),
  };
}

/**
 * Turns only the four owner-confirmed Noorix rent invoices into historical
 * facts. Their overlap remains visible in the document notes; it is not
 * represented as recurring coverage and cannot affect future reminders.
 */
export function planApprovedConcurrentCoverageOverride(base: RecurringPlan): RecurringPlan {
  const approved = base.payments.filter((payment) => APPROVED_CONCURRENT_COVERAGE_PAYMENT_IDS.has(payment.sourceId));
  if (approved.length !== APPROVED_CONCURRENT_COVERAGE_PAYMENT_IDS.size)
    throw new ConflictException('The approved Noorix concurrent-coverage payment set is incomplete in this verified package.');
  for (const payment of approved) {
    if (payment.status !== 'REVIEW_REQUIRED' || payment.reviewCode !== 'UNPROVEN_CONCURRENT_COVERAGE')
      throw new ConflictException(`Approved concurrent-coverage invoice ${payment.documentNumber} is not the expected review item.`);
  }
  const profileIds = new Set(approved.map((payment) => payment.profileSourceId));
  const profiles = base.profiles.filter((profile) => profileIds.has(profile.sourceId));
  if (profiles.length !== profileIds.size || profiles.some((profile) => profile.reviewCode || profile.status !== 'ACTIVE'))
    throw new ConflictException('The approved concurrent-coverage profile is unavailable for historical posting.');
  const payments = approved.map((payment) => ({
    ...payment,
    status: 'POST' as const,
    reviewCode: null,
    writeCoverage: false,
    historicalCoverageOverride: true,
  }));
  const postedGrossAmount = payments
    .reduce((total, payment) => total.plus(payment.grossAmount), new Prisma.Decimal(0))
    .toFixed(4);
  return {
    profiles,
    payments,
    suppliers: base.suppliers,
    vaults: base.vaults,
    postedGrossAmount,
    planChecksum: sha({
      version: CONCURRENT_COVERAGE_OVERRIDE_VERSION,
      profileIds: profiles.map((profile) => [profile.sourceId, profile.sourceChecksum]),
      payments: payments.map((payment) => [payment.sourceId, payment.sourceChecksum, payment.documentNumber, payment.businessDateIso, payment.grossAmount]),
    }),
  };
}

function normalizeApprovedProfileLabel(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');
}

function isDeletedSupplierDuplicateAudit(value: unknown, sourceId: string): value is Readonly<{
  sourceIdentity: Readonly<{ entity: 'Supplier'; sourceId: string }>;
  canonicalTargetId: string;
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const identity = record.sourceIdentity;
  return Boolean(
    identity
    && typeof identity === 'object'
    && !Array.isArray(identity)
    && (identity as Record<string, unknown>).entity === SUPPLIER_ENTITY
    && (identity as Record<string, unknown>).sourceId === sourceId
    && typeof record.canonicalTargetId === 'string'
    && record.canonicalTargetId.length > 0,
  );
}

/** Pure preflight used both by the writer and the policy verification. */
export function planNurixRecurringExpenseRows(input: Readonly<{ profiles: readonly Row[]; payments: readonly Row[]; suppliers: readonly Row[]; vaults: readonly Row[] }>): RecurringPlan {
  const supplierRows = requiredRows(input.suppliers, 'source_id', 'supplier');
  const vaultRows = requiredRows(input.vaults, 'source_id', 'vault');
  const suppliers = new Map([...supplierRows].map(([sourceId, row]) => [sourceId, { nameAr: required(text(row.name_ar), `Supplier ${sourceId} name`), nameEn: optionalText(text(row.name_en)), checksum: sha(row) }]));
  const vaults = new Map([...vaultRows].map(([sourceId, row]) => [sourceId, { nameAr: required(text(row.name_ar), `Vault ${sourceId} name`), checksum: sha(row) }]));
  const profileRows = requiredRows(input.profiles, 'source_id', 'recurring profile');
  const paymentsByProfile = new Map<string, Array<{ date: Date; interval: number }>>();
  const preliminary = new Map<string, Omit<ProfilePlan, 'nextReminderDate'>>();
  for (const row of profileRows.values()) {
    const sourceId = text(row.source_id);
    const supplierSourceId = required(text(row.supplier_source_id), `Recurring profile ${sourceId} supplier`);
    const categoryCode = required(text(row.baseer_category_code), `Recurring profile ${sourceId} category`);
    if (!suppliers.has(supplierSourceId)) throw new ConflictException(`Recurring profile ${sourceId} references an unknown supplier.`);
    const intervalMonths = integer(row.interval_months, `Recurring profile ${sourceId} interval`);
    if (!REQUIRED_INTERVALS.has(intervalMonths)) throw new ConflictException(`Recurring profile ${sourceId} has an unsupported interval.`);
    const status = statusOf(row.status, `Recurring profile ${sourceId}`);
    const expectedAmount = money(row.expected_amount, `Recurring profile ${sourceId} expected amount`, true);
    preliminary.set(sourceId, {
      sourceId, sourceChecksum: sha(row), nameAr: required(text(row.name_ar), `Recurring profile ${sourceId} name`),
      nameEn: optionalText(text(row.name_en)) ?? required(text(row.name_ar), `Recurring profile ${sourceId} name`),
      supplierSourceId, categoryCode, expectedAmount, intervalMonths, status: status === 'active' ? 'ACTIVE' : 'ARCHIVED',
      serviceNumber: optionalText(text(row.service_number)), notes: optionalText(text(row.notes)),
      reviewCode: new Prisma.Decimal(expectedAmount).lessThanOrEqualTo(0) ? 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE' : null,
    });
  }
  const paymentRows = requiredRows(input.payments, 'source_id', 'recurring payment');
  const pendingPayments: PendingPaymentPlan[] = [];
  for (const row of paymentRows.values()) {
    const sourceId = text(row.source_id);
    const sourceStatus = statusOf(row.status, `Recurring payment ${sourceId}`);
    const profileSourceId = required(text(row.profile_source_id), `Recurring payment ${sourceId} profile`);
    const profile = preliminary.get(profileSourceId);
    if (!profile) throw new ConflictException(`Recurring payment ${sourceId} references an unknown recurring profile.`);
    if (sourceStatus === 'active' && profile.status !== 'ACTIVE') throw new ConflictException(`Recurring payment ${sourceId} references an archived recurring profile.`);
    const supplierSourceId = required(text(row.supplier_source_id), `Recurring payment ${sourceId} supplier`);
    const categoryCode = required(text(row.baseer_category_code), `Recurring payment ${sourceId} category`);
    const vaultSourceId = required(text(row.vault_source_id), `Recurring payment ${sourceId} vault`);
    if (!suppliers.has(supplierSourceId) || !vaults.has(vaultSourceId)) throw new ConflictException(`Recurring payment ${sourceId} references an unknown supplier or vault.`);
    if (supplierSourceId !== profile.supplierSourceId || categoryCode !== profile.categoryCode) throw new ConflictException(`Recurring payment ${sourceId} conflicts with its profile supplier or category.`);
    const businessDate = date(row.transaction_date, `Recurring payment ${sourceId} date`);
    const netAmount = money(row.net_amount, `Recurring payment ${sourceId} net amount`);
    const taxAmount = money(row.tax_amount, `Recurring payment ${sourceId} tax amount`, true);
    const grossAmount = money(row.gross_amount, `Recurring payment ${sourceId} gross amount`);
    if (!new Prisma.Decimal(netAmount).plus(taxAmount).equals(grossAmount)) throw new ConflictException(`Recurring payment ${sourceId} has mismatched net, tax, and gross amounts.`);
    const month = businessDate.getUTCMonth() + 1;
    const coverageStartMonth = month - ((month - 1) % profile.intervalMonths);
    const documentNumber = required(text(row.document_number), `Recurring payment ${sourceId} document number`);
    const coverageKey = sourceStatus === 'active' ? `${profileSourceId}:${businessDate.getUTCFullYear()}:${coverageStartMonth}` : null;
    // This exact key identifies a likely duplicated source export. It does not
    // authorize a posting: every competing coverage interval is resolved as
    // evidence unless the package itself has exactly one active payment.
    const duplicateKey = coverageKey ? `${coverageKey}:${netAmount}:${taxAmount}:${grossAmount}:${documentReferenceKey(documentNumber)}` : null;
    pendingPayments.push({ sourceId, sourceChecksum: sha(row), profileSourceId, supplierSourceId, categoryCode, vaultSourceId, documentNumber, businessDate, businessDateIso: businessDate.toISOString().slice(0, 10), netAmount, taxAmount, grossAmount, coverageYear: businessDate.getUTCFullYear(), coverageStartMonth, coverageMonths: profile.intervalMonths, active: sourceStatus === 'active', coverageKey, duplicateKey, notes: optionalText(text(row.notes)) });
  }
  const competingCoverage = new Map<string, PendingPaymentPlan[]>();
  for (const payment of pendingPayments) {
    if (!payment.coverageKey) continue;
    const group = competingCoverage.get(payment.coverageKey) ?? [];
    group.push(payment);
    competingCoverage.set(payment.coverageKey, group);
  }
  const reviewBySourceId = new Map<string, NonNullable<PaymentPlan['reviewCode']>>();
  for (const group of competingCoverage.values()) {
    if (group.length < 2) continue;
    const exactDuplicates = new Set<string>();
    const byDuplicateKey = new Map<string, PendingPaymentPlan[]>();
    for (const payment of group) {
      const matches = byDuplicateKey.get(payment.duplicateKey!) ?? [];
      matches.push(payment);
      byDuplicateKey.set(payment.duplicateKey!, matches);
    }
    for (const matches of byDuplicateKey.values()) if (matches.length > 1) for (const payment of matches) exactDuplicates.add(payment.sourceId);
    // Different references or amounts are not proof of independent
    // obligations. The inspected package gives no invoice/ledger/allocation
    // linkage for these rows, so no competing payment is selected to post.
    for (const payment of group) reviewBySourceId.set(payment.sourceId, exactDuplicates.has(payment.sourceId) ? 'DUPLICATE_SOURCE_PAYMENT' : 'UNPROVEN_CONCURRENT_COVERAGE');
  }
  const payments: PaymentPlan[] = pendingPayments.map((payment) => {
    // A historical payment cannot make an otherwise invalid zero-value profile
    // safe to create. It remains explicit review evidence. For positive
    // profiles, retain the package evidence rule for concurrent coverage.
    const profileReviewCode = preliminary.get(payment.profileSourceId)?.reviewCode ?? null;
    const reviewCode = payment.active ? profileReviewCode ?? reviewBySourceId.get(payment.sourceId) ?? null : null;
    return { ...payment, writeCoverage: payment.active && !reviewCode, status: !payment.active ? 'EXCLUDE' : reviewCode ? 'REVIEW_REQUIRED' : 'POST', reviewCode };
  });
  for (const payment of payments) {
    if (payment.status !== 'POST') continue;
    const bucket = paymentsByProfile.get(payment.profileSourceId) ?? [];
    bucket.push({ date: payment.businessDate, interval: payment.coverageMonths });
    paymentsByProfile.set(payment.profileSourceId, bucket);
  }
  const fallbackReminder = payments.filter((item) => item.status === 'POST').map((item) => item.businessDate).sort((left, right) => right.valueOf() - left.valueOf())[0] ?? new Date();
  const profiles: ProfilePlan[] = [...preliminary.values()].map((profile) => {
    const recent = (paymentsByProfile.get(profile.sourceId) ?? []).sort((left, right) => right.date.valueOf() - left.date.valueOf())[0];
    const base = recent?.date ?? fallbackReminder;
    const nextReminderDate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + (recent?.interval ?? 1), 1));
    return { ...profile, nextReminderDate };
  });
  const postedGrossAmount = payments.filter((item) => item.status === 'POST').reduce((total, item) => total.plus(item.grossAmount), new Prisma.Decimal(0)).toFixed(4);
  return { profiles, payments, suppliers, vaults, postedGrossAmount, planChecksum: sha({ version: VERSION, profiles: profiles.map((item) => [item.sourceId, item.sourceChecksum]), payments: payments.map((item) => [item.sourceId, item.sourceChecksum]), suppliers: [...suppliers.entries()].map(([id, item]) => [id, item.checksum]), vaults: [...vaults.entries()].map(([id, item]) => [id, item.checksum]) }) };
}

function requiredRows(rows: readonly Row[], key: string, label: string) {
  const result = new Map<string, Row>();
  for (const row of rows) {
    const value = text(row[key]);
    if (!value || result.has(value)) throw new ConflictException(`The verified workbook has a duplicate or missing ${label} source identity.`);
    result.set(value, row);
  }
  return result;
}
function isProfile(value: ProfilePlan | PaymentPlan): value is ProfilePlan { return 'expectedAmount' in value; }
function chunk<T>(items: readonly T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim(); }
function required(value: string, label: string): string { if (!value) throw new ConflictException(`${label} is required.`); return value; }
function optionalText(value: string | undefined): string | null { const result = value?.trim(); return result || null; }
function documentReferenceKey(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US'); }
function integer(value: unknown, label: string): number { const output = Number(text(value)); if (!Number.isSafeInteger(output)) throw new ConflictException(`${label} must be an integer.`); return output; }
function statusOf(value: unknown, label: string): 'active' | 'cancelled' { const output = text(value).toLowerCase(); if (output === 'active') return output; if (output === 'cancelled' || output === 'inactive' || output === 'archived') return 'cancelled'; throw new ConflictException(`${label} has an unsupported source status.`); }
function date(value: unknown, label: string): Date { const raw = typeof value === 'number' ? (() => { const parsed = XLSX.SSF.parse_date_code(value); return parsed ? `${parsed.y.toString().padStart(4, '0')}-${parsed.m.toString().padStart(2, '0')}-${parsed.d.toString().padStart(2, '0')}` : ''; })() : text(value).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ConflictException(`${label} is invalid.`); const output = new Date(`${raw}T00:00:00.000Z`); if (Number.isNaN(output.valueOf())) throw new ConflictException(`${label} is invalid.`); return output; }
function money(value: unknown, label: string, allowZero = false): string { try { const amount = new Prisma.Decimal(text(value)); if (!amount.isFinite() || amount.lt(0) || (!allowZero && amount.lte(0)) || (amount.decimalPlaces() ?? 0) > 4) throw new Error(); return amount.toFixed(4); } catch { throw new ConflictException(`${label} is invalid.`); } }
function sha(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function vatRate(net: string, tax: string): number { const netAmount = new Prisma.Decimal(net); const taxAmount = new Prisma.Decimal(tax); return netAmount.isZero() || taxAmount.isZero() ? 0 : taxAmount.mul(10_000).div(netAmount).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(); }
function recurringNotes(source: PaymentPlan): string {
  const override = source.historicalCoverageOverride ? ' — اعتماد المالك: تداخل تاريخ التغطية في نوركس؛ حُفظت الفاتورة دون تغطية دورية مستقبلية.' : '';
  return `مصروف دوري تاريخي مستورد من نوركس: ${source.sourceId}${override}${source.notes ? ` — ${source.notes}` : ''}`;
}
