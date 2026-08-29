import { Injectable, Logger } from '@nestjs/common';

import { Prisma, type Prisma as PrismaTypes } from '../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { canonicalJson } from './archive-canonical-json.js';
import { LocalArchiveStagingStorage, type ArchiveStorageScope } from './archive-storage.js';
import { ArchivePackager } from './archive-packager.js';
import { verifyArchivePayloadDirectory } from './archive-verifier.js';
import {
  COMPANY_ARCHIVE_FORMAT_VERSION,
  type ArchiveCompany,
  type ArchiveFileDescriptor,
  type ArchiveModuleSummary,
  type CompanyArchiveManifest,
} from './archive.types.js';
import { BackupService, type BackupWorkerJobScope } from './backup.service.js';

type JsonScalar = null | boolean | number | string;
type ArchiveJson = JsonScalar | readonly ArchiveJson[] | { readonly [key: string]: ArchiveJson };
type ArchiveRow = Readonly<Record<string, ArchiveJson>>;
type SnapshotTransaction = PrismaTypes.TransactionClient;

type ArchiveSourceScope = Readonly<{ tenantId: string; companyId: string }>;
type SourceOutput = Readonly<{ rows: readonly ArchiveRow[]; company?: ArchiveCompany }>;
type CompanyArchiveSource = Readonly<{
  /** Stable source id; additions require code review, not database discovery. */
  id: string;
  /** Every dependency must be a previously-exported reviewed source. */
  dependsOn?: readonly string[];
  /** Sources in a cycle must be restored by the same future two-pass adapter. */
  restoreGroup?: 'finance-category-supplier';
  sourceTable: 'Company' | 'CompanyFinanceProfile' | 'FinanceAccount' | 'FinanceCategory' | 'FinanceFiscalPeriod' | 'FinanceRecurringExpenseProfile' | 'FinanceSupplier' | 'FinanceVault';
  module: 'company' | 'finance';
  entryPath: `data/${string}.jsonl`;
  read: (tx: SnapshotTransaction, scope: ArchiveSourceScope) => Promise<SourceOutput>;
}>;

export type CompanyArchiveExportResult = Readonly<{
  archiveId: string;
  storageKey: string;
  manifestSha256: string;
  recordCount: number;
  payloadBytes: bigint;
}>;

const EXPORTER_VERSION = 1;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
/**
 * These financial truth records have mandatory actor/provenance references.
 * They remain blocked until a reviewed restore design maps actors without
 * reusing source user IDs and reconciles the resulting ledger.
 */
const RESTORE_PROVENANCE_BLOCKED_SOURCE_TABLES: ReadonlySet<string> = new Set([
  'FinanceJournalEntry',
  'FinanceJournalLine',
  'FinanceOutflowBatch',
  'FinanceOutflowDocument',
  'FinanceOutflowDocumentRevision',
  'FinanceOutflowAllocation',
]);

/**
 * This is deliberately a closed, code-owned registry.  It must never be
 * replaced with Prisma model enumeration, information_schema queries, or a
 * caller-supplied table list: unreviewed tables can contain tenant-global data,
 * secrets, credentials, or records whose relational closure is unknown.
 *
 * Gate 2 starts with the company identity and a small set of finance setup
 * tables. Categories and suppliers are admitted only together: their explicit
 * closed reference graph is verified, and their future restore is labelled as
 * two-pass. More source tables can be appended only with an explicit
 * ownership and restore-plan review.
 */
export const COMPANY_ARCHIVE_SOURCE_REGISTRY: readonly CompanyArchiveSource[] = Object.freeze([
  {
    id: 'company-profile',
    sourceTable: 'Company',
    module: 'company',
    entryPath: 'data/company-profile.jsonl',
    async read(tx, scope) {
      const company = await tx.company.findFirst({
        where: { id: scope.companyId, tenantId: scope.tenantId },
        select: {
          id: true, tenantId: true, nameAr: true, nameEn: true, businessTimezone: true,
          contextLocationCode: true, contextLocationLabelAr: true, contextLatitude: true,
          contextLongitude: true, status: true, createdAt: true, updatedAt: true,
        },
      });
      if (!company) throw new CompanyArchiveExportError('COMPANY_NOT_FOUND', 'The requested company is not available in this tenant snapshot.');
      return {
        company: { companyId: company.id, nameAr: company.nameAr, nameEn: company.nameEn, modules: [] },
        rows: [toArchiveRow(company)],
      };
    },
  },
  {
    id: 'finance-accounts',
    dependsOn: ['company-profile'],
    sourceTable: 'FinanceAccount',
    module: 'finance',
    entryPath: 'data/finance-accounts.jsonl',
    async read(tx, scope) {
      const rows = await tx.financeAccount.findMany({
        where: { tenantId: scope.tenantId, companyId: scope.companyId },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        select: {
          id: true, tenantId: true, companyId: true, code: true, nameAr: true, nameEn: true,
          type: true, systemKey: true, isSystem: true, status: true, createdAt: true, updatedAt: true,
        },
      });
      return { rows: rows.map(toArchiveRow) };
    },
  },
  {
    id: 'finance-fiscal-periods',
    dependsOn: ['company-profile'],
    sourceTable: 'FinanceFiscalPeriod',
    module: 'finance',
    entryPath: 'data/finance-fiscal-periods.jsonl',
    async read(tx, scope) {
      const rows = await tx.financeFiscalPeriod.findMany({
        where: { tenantId: scope.tenantId, companyId: scope.companyId },
        orderBy: [{ startDate: 'asc' }, { endDate: 'asc' }, { id: 'asc' }],
        select: {
          id: true, tenantId: true, companyId: true, nameAr: true, nameEn: true,
          startDate: true, endDate: true, status: true, closedAt: true, closeReason: true,
          lockedAt: true, createdAt: true, updatedAt: true,
        },
      });
      return { rows: rows.map(toArchiveRow) };
    },
  },
  {
    // The company finance profile has only the company composite relation;
    // it deliberately carries no account, vault, user, or external reference.
    // Its dependency is therefore closed by the selected company profile.
    id: 'company-finance-profile',
    dependsOn: ['company-profile'],
    sourceTable: 'CompanyFinanceProfile',
    module: 'finance',
    entryPath: 'data/company-finance-profile.jsonl',
    async read(tx, scope) {
      const rows = await tx.companyFinanceProfile.findMany({
        where: { tenantId: scope.tenantId, companyId: scope.companyId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, tenantId: true, companyId: true, baseSeedVersion: true,
          accountingMode: true, vatAccountingEnabled: true, vatRateBasisPoints: true,
          functionalCurrencyCode: true, initializedAt: true, createdAt: true,
          updatedAt: true,
        },
      });
      if (rows.length > 1) {
        throw new CompanyArchiveExportError('COMPANY_FINANCE_PROFILE_DUPLICATE', 'A company archive may contain at most one company finance profile.');
      }
      assertCompanyScopeRows(
        rows,
        scope,
        'COMPANY_FINANCE_PROFILE_SCOPE_INVALID',
        'A company finance profile does not match the selected company archive scope.',
      );
      return { rows: rows.map(toArchiveRow) };
    },
  },
  {
    // A vault references only a company-local account. We validate that every
    // referenced account is in the archive, rather than trusting the database
    // relation alone, so an incomplete source registry cannot be published.
    id: 'finance-vaults',
    dependsOn: ['finance-accounts'],
    sourceTable: 'FinanceVault',
    module: 'finance',
    entryPath: 'data/finance-vaults.jsonl',
    async read(tx, scope) {
      const [rows, accounts] = await Promise.all([
        tx.financeVault.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          orderBy: [{ sortOrder: 'asc' }, { nameAr: 'asc' }, { id: 'asc' }],
          select: {
            id: true, tenantId: true, companyId: true, accountId: true,
            nameAr: true, nameEn: true, type: true, paymentMethod: true,
            paymentMethods: true, status: true, isSalesChannel: true,
            isPaymentDestination: true, sortOrder: true, createdAt: true,
            updatedAt: true,
          },
        }),
        tx.financeAccount.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          select: { id: true },
        }),
      ]);
      assertForeignKeysPresent(
        rows.map((row) => row.accountId),
        new Set(accounts.map((account) => account.id)),
        'FINANCE_VAULT_ACCOUNT_NOT_ARCHIVED',
        'A finance vault references an account that is absent from the company archive.',
      );
      return { rows: rows.map(toArchiveRow) };
    },
  },
  {
    // Categories and suppliers form an intentionally explicit, closed cycle:
    // category.parentId/accountId/suggestedSupplierId and supplier.categoryId
    // are all checked against rows emitted by this archive. A future importer
    // must hydrate this restoreGroup in two passes before enabling the company.
    id: 'finance-categories',
    dependsOn: ['finance-accounts'],
    restoreGroup: 'finance-category-supplier',
    sourceTable: 'FinanceCategory',
    module: 'finance',
    entryPath: 'data/finance-categories.jsonl',
    async read(tx, scope) {
      const [rows, accounts, suppliers] = await Promise.all([
        tx.financeCategory.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }, { id: 'asc' }],
          select: {
            id: true, tenantId: true, companyId: true, parentId: true,
            accountId: true, suggestedSupplierId: true, code: true, nameAr: true,
            nameEn: true, kind: true, status: true, isPosting: true,
            sortOrder: true, createdAt: true, updatedAt: true,
          },
        }),
        tx.financeAccount.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          select: { id: true },
        }),
        tx.financeSupplier.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          select: { id: true },
        }),
      ]);
      assertCompanyScopeRows(rows, scope, 'FINANCE_CATEGORY_SCOPE_INVALID', 'A finance category does not match the selected company archive scope.');
      const categoryIds = new Set(rows.map((row) => row.id));
      assertForeignKeysPresent(presentIds(rows.map((row) => row.parentId)), categoryIds, 'FINANCE_CATEGORY_PARENT_NOT_ARCHIVED', 'A finance category parent is absent from the company archive.');
      assertFinanceCategoryParentGraph(rows);
      assertForeignKeysPresent(presentIds(rows.map((row) => row.accountId)), new Set(accounts.map((account) => account.id)), 'FINANCE_CATEGORY_ACCOUNT_NOT_ARCHIVED', 'A finance category account is absent from the company archive.');
      assertForeignKeysPresent(presentIds(rows.map((row) => row.suggestedSupplierId)), new Set(suppliers.map((supplier) => supplier.id)), 'FINANCE_CATEGORY_SUGGESTED_SUPPLIER_NOT_ARCHIVED', 'A finance category suggested supplier is absent from the company archive.');
      return { rows: rows.map(toArchiveRow) };
    },
  },
  {
    id: 'finance-suppliers',
    dependsOn: ['finance-accounts'],
    restoreGroup: 'finance-category-supplier',
    sourceTable: 'FinanceSupplier',
    module: 'finance',
    entryPath: 'data/finance-suppliers.jsonl',
    async read(tx, scope) {
      const [rows, categories] = await Promise.all([
        tx.financeSupplier.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          orderBy: [{ supplierType: 'asc' }, { nameAr: 'asc' }, { id: 'asc' }],
          select: {
            id: true, tenantId: true, companyId: true, categoryId: true,
            supplierType: true, nameAr: true, nameEn: true, phone: true,
            taxNumber: true, isTaxRegistered: true, isFavorite: true,
            status: true, createdAt: true, updatedAt: true,
          },
        }),
        tx.financeCategory.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          select: { id: true },
        }),
      ]);
      assertCompanyScopeRows(rows, scope, 'FINANCE_SUPPLIER_SCOPE_INVALID', 'A finance supplier does not match the selected company archive scope.');
      assertForeignKeysPresent(presentIds(rows.map((row) => row.categoryId)), new Set(categories.map((category) => category.id)), 'FINANCE_SUPPLIER_CATEGORY_NOT_ARCHIVED', 'A finance supplier category is absent from the company archive.');
      return { rows: rows.map(toArchiveRow) };
    },
  },
  {
    // This carries recurring-expense configuration only. Its historic payment
    // documents and coverage slots are deliberately exported by no source in
    // this wave, so the worker cannot accidentally represent them as complete.
    id: 'finance-recurring-expense-profiles',
    dependsOn: ['finance-categories', 'finance-suppliers', 'finance-vaults'],
    sourceTable: 'FinanceRecurringExpenseProfile',
    module: 'finance',
    entryPath: 'data/finance-recurring-expense-profiles.jsonl',
    async read(tx, scope) {
      const [rows, categories, suppliers, vaults] = await Promise.all([
        tx.financeRecurringExpenseProfile.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          orderBy: [{ status: 'asc' }, { nextReminderDate: 'asc' }, { nameAr: 'asc' }, { id: 'asc' }],
          select: {
            id: true, tenantId: true, companyId: true, supplierId: true,
            categoryId: true, nameAr: true, nameEn: true, expectedAmount: true,
            intervalMonths: true, nextReminderDate: true, serviceNumber: true,
            defaultVaultId: true, allowAmountOverride: true, status: true,
            notes: true, createdAt: true, updatedAt: true,
          },
        }),
        tx.financeCategory.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          select: { id: true },
        }),
        tx.financeSupplier.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          select: { id: true },
        }),
        tx.financeVault.findMany({
          where: { tenantId: scope.tenantId, companyId: scope.companyId },
          select: { id: true },
        }),
      ]);
      assertCompanyScopeRows(rows, scope, 'FINANCE_RECURRING_EXPENSE_PROFILE_SCOPE_INVALID', 'A recurring expense profile does not match the selected company archive scope.');
      assertForeignKeysPresent(rows.map((row) => row.categoryId), new Set(categories.map((category) => category.id)), 'FINANCE_RECURRING_EXPENSE_PROFILE_CATEGORY_NOT_ARCHIVED', 'A recurring expense profile category is absent from the company archive.');
      assertForeignKeysPresent(presentIds(rows.map((row) => row.supplierId)), new Set(suppliers.map((supplier) => supplier.id)), 'FINANCE_RECURRING_EXPENSE_PROFILE_SUPPLIER_NOT_ARCHIVED', 'A recurring expense profile supplier is absent from the company archive.');
      assertForeignKeysPresent(presentIds(rows.map((row) => row.defaultVaultId)), new Set(vaults.map((vault) => vault.id)), 'FINANCE_RECURRING_EXPENSE_PROFILE_VAULT_NOT_ARCHIVED', 'A recurring expense profile default vault is absent from the company archive.');
      return { rows: rows.map(toArchiveRow) };
    },
  },
]);

type ExportCheckpoint = Readonly<{
  version: typeof EXPORTER_VERSION;
  exporter: 'company-archive';
  archiveId: string;
  archiveCreatedAt: string;
  company?: ArchiveCompany;
  files?: readonly ArchiveFileDescriptor[];
  recordCount?: number;
  payloadBytes?: string;
}>;

/** Worker-facing export only; this service intentionally has no HTTP route. */
@Injectable()
export class CompanyArchiveExporter {
  private readonly logger = new Logger(CompanyArchiveExporter.name);
  private archiveStorage?: LocalArchiveStagingStorage;
  private archivePackager?: ArchivePackager;

  constructor(
    private readonly database: DatabaseService,
    private readonly backups: BackupService,
  ) {}

  async export(scope: BackupWorkerJobScope): Promise<CompanyArchiveExportResult | undefined> {
    assertCompanyArchiveRegistry(COMPANY_ARCHIVE_SOURCE_REGISTRY);
    try {
      let job = await this.backups.readWorkerJob(scope);
      if (job.stage === 'PUBLISHED') return this.readCompletedResult(scope, job.checkpointJson);
      if (job.stage === 'FAILED' || job.stage === 'CANCELLED') return undefined;

      if (job.stage === 'QUEUED') {
        await this.backups.advanceWorkerJob(scope, {
          stage: 'PRECHECK', progressPercent: 1,
          checkpoint: this.newCheckpoint(scope),
        });
        job = await this.backups.readWorkerJob(scope);
      }
      if (job.stage === 'PRECHECK') {
        await this.backups.advanceWorkerJob(scope, {
          stage: 'CONSISTENT_SNAPSHOT', progressPercent: 5,
          checkpoint: this.checkpointOrThrow(scope, job.checkpointJson),
        });
        job = await this.backups.readWorkerJob(scope);
      }
      if (job.stage === 'CONSISTENT_SNAPSHOT') {
        await this.backups.advanceWorkerJob(scope, {
          stage: 'EXPORT_DATA', progressPercent: 10,
          checkpoint: this.checkpointOrThrow(scope, job.checkpointJson),
        });
        job = await this.backups.readWorkerJob(scope);
      }
      if (job.stage === 'EXPORT_DATA') {
        const checkpoint = this.checkpointOrThrow(scope, job.checkpointJson);
        const exported = await this.exportSnapshot(scope, checkpoint);
        await this.backups.advanceWorkerJob(scope, {
          stage: 'EXPORT_ATTACHMENTS', progressPercent: 72,
          recordsProcessed: exported.recordCount,
          recordsTotal: exported.recordCount,
          bytesProcessed: exported.payloadBytes,
          bytesTotal: exported.payloadBytes,
          checkpoint: exported.checkpoint,
        });
        job = await this.backups.readWorkerJob(scope);
      }
      if (job.stage === 'EXPORT_ATTACHMENTS') {
        // Attachments are intentionally not inferred from FileMetadata in Gate 2:
        // their on-disk ownership and malware/quarantine state need a separate,
        // reviewed exporter. This explicit empty stage prevents a false claim.
        await this.backups.advanceWorkerJob(scope, {
          stage: 'PACKAGE_COMPRESS_ENCRYPT', progressPercent: 76,
          recordsProcessed: job.recordsProcessed,
          recordsTotal: job.recordsTotal,
          bytesProcessed: job.bytesProcessed,
          bytesTotal: job.bytesTotal,
          checkpoint: this.checkpointOrThrow(scope, job.checkpointJson),
        });
        job = await this.backups.readWorkerJob(scope);
      }
      if (job.stage === 'PACKAGE_COMPRESS_ENCRYPT') {
        const checkpoint = this.checkpointOrThrow(scope, job.checkpointJson);
        const manifest = this.manifestFromCheckpoint(scope, checkpoint);
        const recordCount = requiredRecordCount(checkpoint);
        const payloadBytes = requiredPayloadBytes(checkpoint);
        const verification = await verifyArchivePayloadDirectory(this.storage.stageRoot(scope), manifest);
        if (!verification.valid) throw new CompanyArchiveExportError('PAYLOAD_VERIFICATION_FAILED', `Staged archive payload verification failed: ${verification.issues.map((issue) => issue.code).join(', ')}.`);
        await this.storage.finalizePrivateStage(scope, manifest);
        await this.backups.advanceWorkerJob(scope, {
          stage: 'VERIFY_HASHES', progressPercent: 92,
          recordsProcessed: recordCount,
          recordsTotal: recordCount,
          bytesProcessed: payloadBytes,
          bytesTotal: payloadBytes,
          checkpoint,
        });
        job = await this.backups.readWorkerJob(scope);
      }
      if (job.stage === 'VERIFY_HASHES') {
        const checkpoint = this.checkpointOrThrow(scope, job.checkpointJson);
        const manifest = this.manifestFromCheckpoint(scope, checkpoint);
        const packaged = await this.packager.packageFinalizedPrivateStage(scope, manifest);
        const recordCount = requiredRecordCount(checkpoint);
        const payloadBytes = requiredPayloadBytes(checkpoint);
        await this.backups.recordPublishedCompanyArchive(scope, {
          formatVersion: 'baseer-encrypted-company-archive/v1',
          storageKey: packaged.storageKey,
          filename: `${manifest.archiveId}.bca`,
          sha256: packaged.sha256,
          byteSize: packaged.byteSize,
        });
        await this.backups.advanceWorkerJob(scope, {
          stage: 'PUBLISHED', progressPercent: 100,
          recordsProcessed: recordCount,
          recordsTotal: recordCount,
          bytesProcessed: packaged.byteSize,
          bytesTotal: packaged.byteSize,
          checkpoint: { ...checkpoint, storageKey: packaged.storageKey, manifestSha256: packaged.manifestSha256, publishedAt: packaged.createdAt },
        });
        await this.storage.discardStage(scope);
        return {
          archiveId: manifest.archiveId, storageKey: packaged.storageKey, manifestSha256: packaged.manifestSha256,
          recordCount, payloadBytes,
        };
      }
      throw new CompanyArchiveExportError('UNSUPPORTED_JOB_STAGE', `Company archive job is in unsupported stage ${job.stage}.`);
    } catch (error) {
      this.logInternalFailure(scope, error);
      await this.fail(scope, error);
      throw error;
    }
  }

  private async exportSnapshot(scope: BackupWorkerJobScope, checkpoint: ExportCheckpoint) {
    const storageScope: ArchiveStorageScope = scope;
    return this.database.inTenantReadSnapshot(scope.tenantId, async (tx) => {
      let company: ArchiveCompany | undefined;
      const files: ArchiveFileDescriptor[] = [];
      const moduleCounts = new Map<string, number>();
      let recordCount = 0;
      let payloadBytes = 0n;
      for (const source of COMPANY_ARCHIVE_SOURCE_REGISTRY) {
        const output = await source.read(tx, scope);
        if (output.company) {
          if (company) throw new CompanyArchiveExportError('REGISTRY_COMPANY_PROFILE_DUPLICATE', 'The company archive registry emitted more than one company profile.');
          company = output.company;
        }
        const bytes = jsonlBuffer(output.rows, source.id);
        const written = await this.storage.writeStageFile(storageScope, source.entryPath, bytes);
        files.push({ path: source.entryPath, byteSize: written.byteSize, sha256: written.sha256 });
        recordCount += output.rows.length;
        payloadBytes += BigInt(written.byteSize);
        moduleCounts.set(source.module, (moduleCounts.get(source.module) ?? 0) + output.rows.length);
      }
      if (!company) throw new CompanyArchiveExportError('COMPANY_PROFILE_MISSING', 'The company archive registry did not emit the selected company profile.');
      const modules: ArchiveModuleSummary[] = [...moduleCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([module, count]) => ({ module, recordCount: count }));
      const archiveCompany: ArchiveCompany = { ...company, modules };
      return {
        recordCount,
        payloadBytes,
        checkpoint: {
          ...checkpoint,
          company: archiveCompany,
          files: files.sort((left, right) => left.path.localeCompare(right.path)),
          recordCount,
          payloadBytes: payloadBytes.toString(),
        } satisfies ExportCheckpoint,
      };
    });
  }

  private manifestFromCheckpoint(scope: BackupWorkerJobScope, checkpoint: ExportCheckpoint): CompanyArchiveManifest {
    if (!checkpoint.company || !checkpoint.files || checkpoint.recordCount === undefined || checkpoint.payloadBytes === undefined) {
      throw new CompanyArchiveExportError('CHECKPOINT_INCOMPLETE', 'The durable export checkpoint does not contain a complete staged archive manifest.');
    }
    return {
      archiveFormatVersion: COMPANY_ARCHIVE_FORMAT_VERSION,
      archiveId: checkpoint.archiveId,
      createdAt: checkpoint.archiveCreatedAt,
      source: {
        applicationVersion: requireEnvironment('BASEER_ARCHIVE_APPLICATION_VERSION'),
        schemaVersion: requireEnvironment('BASEER_ARCHIVE_SCHEMA_VERSION'),
        tenantId: scope.tenantId,
      },
      companies: [checkpoint.company],
      files: checkpoint.files,
    };
  }

  private checkpointOrThrow(scope: BackupWorkerJobScope, value: unknown): ExportCheckpoint {
    if (!isExportCheckpoint(value) || value.archiveId !== scope.jobId) {
      throw new CompanyArchiveExportError('CHECKPOINT_INVALID', 'The backup job checkpoint is invalid or belongs to another archive.');
    }
    return value;
  }

  private newCheckpoint(scope: BackupWorkerJobScope): ExportCheckpoint {
    return { version: EXPORTER_VERSION, exporter: 'company-archive', archiveId: scope.jobId, archiveCreatedAt: new Date().toISOString() };
  }

  private async readCompletedResult(scope: BackupWorkerJobScope, value: unknown): Promise<CompanyArchiveExportResult | undefined> {
    const checkpoint = this.checkpointOrThrow(scope, value);
    const storageKey = readStringProperty(value, 'storageKey');
    const manifestSha256 = readStringProperty(value, 'manifestSha256');
    if (!storageKey || !manifestSha256 || checkpoint.recordCount === undefined || checkpoint.payloadBytes === undefined) return undefined;
    return { archiveId: checkpoint.archiveId, storageKey, manifestSha256, recordCount: checkpoint.recordCount, payloadBytes: BigInt(checkpoint.payloadBytes) };
  }

  private async fail(scope: BackupWorkerJobScope, error: unknown): Promise<void> {
    const latest = await this.backups.readWorkerJob(scope).catch(() => undefined);
    if (!latest || latest.stage === 'FAILED' || latest.stage === 'CANCELLED' || latest.stage === 'PUBLISHED') return;
    const details = asExportError(error);
    await this.backups.advanceWorkerJob(scope, {
      stage: 'FAILED', progressPercent: Math.min(99, latest.stage === 'QUEUED' ? 0 : 95),
      recordsProcessed: latest.recordsProcessed,
      recordsTotal: latest.recordsTotal,
      bytesProcessed: latest.bytesProcessed,
      bytesTotal: latest.bytesTotal,
      checkpoint: isRecord(latest.checkpointJson) ? latest.checkpointJson : { version: EXPORTER_VERSION, exporter: 'company-archive', archiveId: scope.jobId, archiveCreatedAt: new Date().toISOString() },
      error: { code: details.code, message: details.message },
    }).catch(() => undefined);
  }

  /** Internal diagnostics may retain the underlying I/O/database reason; the durable job receipt never does. */
  private logInternalFailure(scope: BackupWorkerJobScope, error: unknown): void {
    const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : 'Non-Error export failure.';
    this.logger.error(`Company archive export failed for job=${scope.jobId} tenant=${scope.tenantId} company=${scope.companyId} fence=${scope.workerLeaseFence.toString()}`, detail);
  }

  /**
   * Export storage configuration is intentionally evaluated only when a job
   * executes. This keeps a missing production archive directory from taking
   * down the API process, while still failing the export closed before any
   * data is written.
   */
  private get storage(): LocalArchiveStagingStorage {
    return this.archiveStorage ??= new LocalArchiveStagingStorage();
  }

  private get packager(): ArchivePackager {
    return this.archivePackager ??= new ArchivePackager(this.storage);
  }
}

export class CompanyArchiveExportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CompanyArchiveExportError'; }
}

export function assertCompanyArchiveRegistry(registry: readonly CompanyArchiveSource[]): void {
  if (registry.length === 0) throw new CompanyArchiveExportError('REGISTRY_EMPTY', 'The company archive registry must contain explicitly reviewed sources.');
  const ids = new Set<string>();
  const paths = new Set<string>();
  const restoreGroups = new Map<string, CompanyArchiveSource[]>();
  for (const source of registry) {
    if (RESTORE_PROVENANCE_BLOCKED_SOURCE_TABLES.has(source.sourceTable)) {
      throw new CompanyArchiveExportError('REGISTRY_RESTORE_PROVENANCE_REQUIRED', 'Financial journal and outflow sources require approved actor mapping and ledger reconciliation before archive export.');
    }
    if (!source.id || ids.has(source.id) || !source.entryPath.startsWith('data/') || !source.entryPath.endsWith('.jsonl') || paths.has(source.entryPath)) {
      throw new CompanyArchiveExportError('REGISTRY_INVALID', 'The company archive registry contains an invalid or duplicate source.');
    }
    ids.add(source.id);
    paths.add(source.entryPath);
    if (source.restoreGroup) {
      const group = restoreGroups.get(source.restoreGroup) ?? [];
      group.push(source);
      restoreGroups.set(source.restoreGroup, group);
    }
    for (const dependency of source.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        throw new CompanyArchiveExportError('REGISTRY_DEPENDENCY_INVALID', `Archive source ${source.id} depends on a missing or later source: ${dependency}.`);
      }
    }
  }
  const categorySupplierGroup = restoreGroups.get('finance-category-supplier') ?? [];
  const cycleTables = new Set(categorySupplierGroup.map((source) => source.sourceTable));
  if (categorySupplierGroup.length !== 2 || !cycleTables.has('FinanceCategory') || !cycleTables.has('FinanceSupplier')) {
    throw new CompanyArchiveExportError('REGISTRY_CYCLE_GROUP_INVALID', 'The finance category/supplier cycle must contain exactly its two reviewed source tables.');
  }
}

function jsonlBuffer(rows: readonly ArchiveRow[], sourceId: string): Buffer {
  const bytes = Buffer.from(rows.length === 0 ? '' : `${rows.map((row) => canonicalJson(row)).join('\n')}\n`, 'utf8');
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new CompanyArchiveExportError('SOURCE_SIZE_LIMIT_EXCEEDED', `Approved source ${sourceId} exceeds the ${MAX_SOURCE_BYTES} byte staging limit.`);
  return bytes;
}

function toArchiveRow(value: Record<string, unknown>): ArchiveRow { return normalizeArchiveValue(value) as ArchiveRow; }

function normalizeArchiveValue(value: unknown): ArchiveJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CompanyArchiveExportError('UNSUPPORTED_SOURCE_VALUE', 'A source row contains a non-finite numeric value.');
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value)) return value.map(normalizeArchiveValue);
  if (isRecord(value)) {
    const output: Record<string, ArchiveJson> = {};
    for (const key of Object.keys(value).sort()) output[key] = normalizeArchiveValue(value[key]);
    return output;
  }
  throw new CompanyArchiveExportError('UNSUPPORTED_SOURCE_VALUE', `An approved source emitted an unsupported ${typeof value} value.`);
}

function isExportCheckpoint(value: unknown): value is ExportCheckpoint {
  return isRecord(value)
    && value.version === EXPORTER_VERSION
    && value.exporter === 'company-archive'
    && typeof value.archiveId === 'string'
    && typeof value.archiveCreatedAt === 'string'
    && !Number.isNaN(Date.parse(value.archiveCreatedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringProperty(value: unknown, property: string): string | undefined {
  return isRecord(value) && typeof value[property] === 'string' ? value[property] : undefined;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new CompanyArchiveExportError('ARCHIVE_METADATA_UNCONFIGURED', `${name} must be configured before a company archive can be published.`);
  return value;
}

function requiredRecordCount(checkpoint: ExportCheckpoint): number {
  if (checkpoint.recordCount === undefined) throw new CompanyArchiveExportError('CHECKPOINT_INCOMPLETE', 'The durable export checkpoint is missing its record count.');
  return checkpoint.recordCount;
}

function requiredPayloadBytes(checkpoint: ExportCheckpoint): bigint {
  if (checkpoint.payloadBytes === undefined) throw new CompanyArchiveExportError('CHECKPOINT_INCOMPLETE', 'The durable export checkpoint is missing its payload byte count.');
  return BigInt(checkpoint.payloadBytes);
}

function assertForeignKeysPresent(
  foreignKeys: readonly string[],
  availableIds: ReadonlySet<string>,
  code: string,
  message: string,
): void {
  if (foreignKeys.some((foreignKey) => !availableIds.has(foreignKey))) {
    throw new CompanyArchiveExportError(code, message);
  }
}

function presentIds(values: readonly (string | null)[]): readonly string[] {
  return values.filter((value): value is string => value !== null);
}

/** The importer must never be handed a self-referential or cyclic category tree. */
function assertFinanceCategoryParentGraph(
  rows: readonly Readonly<{ id: string; parentId: string | null }>[],
): void {
  const parents = new Map(rows.map((row) => [row.id, row.parentId]));
  const completed = new Set<string>();
  for (const startId of parents.keys()) {
    if (completed.has(startId)) continue;
    const path = new Set<string>();
    let currentId: string | null = startId;
    while (currentId !== null) {
      if (path.has(currentId)) {
        throw new CompanyArchiveExportError('FINANCE_CATEGORY_PARENT_CYCLE', 'A finance category parent relationship contains a self-reference or cycle.');
      }
      if (completed.has(currentId)) break;
      path.add(currentId);
      currentId = parents.get(currentId) ?? null;
    }
    for (const categoryId of path) completed.add(categoryId);
  }
}

function assertCompanyScopeRows(
  rows: readonly Readonly<{ tenantId: string; companyId: string }>[],
  scope: ArchiveSourceScope,
  code: string,
  message: string,
): void {
  if (rows.some((row) => row.tenantId !== scope.tenantId || row.companyId !== scope.companyId)) {
    throw new CompanyArchiveExportError(code, message);
  }
}

function asExportError(error: unknown): CompanyArchiveExportError {
  const code = error instanceof CompanyArchiveExportError ? error.code : 'ARCHIVE_EXPORT_FAILED';
  return new CompanyArchiveExportError(code, 'The company archive export failed safely. Review the job correlation ID with an authorized administrator.');
}
