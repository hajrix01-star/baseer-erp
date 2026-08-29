import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import dotenv from 'dotenv';

import { BackupService, type BackupWorkerJobScope } from './backup.service.js';
import { BackupWorkerService } from './backup-worker.service.js';
import { assertCompanyArchiveRegistry, COMPANY_ARCHIVE_SOURCE_REGISTRY, CompanyArchiveExporter } from './company-archive-exporter.js';
import { DatabaseService } from '../database/database.service.js';

dotenv.config({ path: 'apps/api/.env.baseer-test', override: true, quiet: true });

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'baseer-company-archive-worker-'));
  const tenantId = '6e6bc129-4c73-4e6e-9b10-2b7c1b0b0081';
  const companyId = 'c0a21e10-27e5-4f01-a8d2-11d22c0b0081';
  const userId = '9b6399bf-6ff8-416a-88c1-33f10d0b0081';
  const accountId = 'a871c101-134b-4c4a-a2dd-44f20e0b0081';
  const categoryId = 'f374ee82-2aac-4272-b4d2-88d60a0b0081';
  const childCategoryId = '922ecdd2-1b48-455c-8933-2cc41b0b0081';
  const supplierId = 'c7a422e3-80d4-4d23-8125-99e70a0b0081';
  const recurringProfileId = '3e1e9199-5c39-40d9-a3fd-1ace1b0b0081';
  const periodId = 'd12bd919-5bd8-4d32-9b7c-55a30f0b0081';
  const vaultId = 'e292d3b4-1f64-41dd-8fb0-66b40a0b0081';
  process.env.BASEER_BACKUP_ARCHIVE_STORAGE_ROOT = root;
  process.env.BASEER_ARCHIVE_APPLICATION_VERSION = 'verification';
  process.env.BASEER_ARCHIVE_SCHEMA_VERSION = 'verification';
  process.env.BASEER_ARCHIVE_KEK_KEYRING_V1 = JSON.stringify({ activeKeyId: 'verification-v1', keys: { 'verification-v1': Buffer.alloc(32, 11).toString('base64') } });
  const database = new DatabaseService();
  try {
    await database.client.$connect();
    await database.client.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, code: 'backup-worker-verification', name: 'Backup worker verification' } });
    await database.inTenantTransaction(tenantId, async (tx) => {
      await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, tenantId, loginNormalized: 'backup-worker-verification', nameAr: 'مدقق النسخ', nameEn: 'Backup worker', passwordHash: 'verification-only' } });
      await tx.company.upsert({ where: { id: companyId }, update: {}, create: { id: companyId, tenantId, nameAr: 'شركة اختبار النسخ', nameEn: 'Backup verification company' } });
      await tx.companyFinanceProfile.upsert({ where: { companyId }, update: {}, create: { id: '7c498bb8-21f2-4d29-8fd1-77c50a0b0081', tenantId, companyId } });
      await tx.financeAccount.upsert({ where: { id: accountId }, update: {}, create: { id: accountId, tenantId, companyId, code: 'CASH-001', nameAr: 'النقدية', nameEn: 'Cash', type: 'ASSET' } });
      // Seed the reviewed category/supplier cycle, including its optional
      // back-reference, so the archive validator proves both sides are present.
      await tx.financeCategory.upsert({ where: { id: categoryId }, update: {}, create: { id: categoryId, tenantId, companyId, accountId, code: 'PUR-001', nameAr: 'مشتريات اختبار', nameEn: 'Verification purchases', kind: 'PURCHASE' } });
      await tx.financeCategory.upsert({ where: { id: childCategoryId }, update: {}, create: { id: childCategoryId, tenantId, companyId, parentId: categoryId, accountId, code: 'PUR-002', nameAr: 'مشتريات فرعية اختبار', nameEn: 'Verification purchases child', kind: 'PURCHASE' } });
      await tx.financeSupplier.upsert({ where: { id: supplierId }, update: { categoryId: childCategoryId }, create: { id: supplierId, tenantId, companyId, categoryId: childCategoryId, supplierType: 'PURCHASE', nameAr: 'مورد اختبار', nameEn: 'Verification supplier' } });
      await tx.financeCategory.update({ where: { id: categoryId }, data: { suggestedSupplierId: supplierId } });
      await tx.financeFiscalPeriod.upsert({ where: { id: periodId }, update: {}, create: { id: periodId, tenantId, companyId, nameAr: 'فترة اختبار', nameEn: 'Verification period', startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2026-12-31T00:00:00.000Z') } });
      await tx.financeVault.upsert({ where: { id: vaultId }, update: {}, create: { id: vaultId, tenantId, companyId, accountId, nameAr: 'صندوق اختبار', nameEn: 'Verification cash', type: 'CASH', paymentMethod: 'CASH', paymentMethods: ['CASH'] } });
      await tx.financeRecurringExpenseProfile.upsert({ where: { id: recurringProfileId }, update: { supplierId, categoryId: childCategoryId, defaultVaultId: vaultId }, create: { id: recurringProfileId, tenantId, companyId, supplierId, categoryId: childCategoryId, nameAr: 'خدمة اختبار دورية', nameEn: 'Verification recurring service', expectedAmount: '125.5000', intervalMonths: 1, nextReminderDate: new Date('2026-09-01T00:00:00.000Z'), serviceNumber: 'VER-REC-001', defaultVaultId: vaultId, allowAmountOverride: false, notes: 'archive integration verification' } });
    });

    const backups = new BackupService(database);
    const exporter = new CompanyArchiveExporter(database, backups);
    const worker = new BackupWorkerService(database, exporter);
    const job = await backups.createCompanyArchiveJob({ tenantId, companyId, actorUserId: userId }, { idempotencyKey: 'backup-worker-integration-verification', reason: 'integration verification' });
    await database.inTenantTransaction(tenantId, async (tx) => {
      await tx.backupArtifact.deleteMany({ where: { jobId: job.id } });
      await tx.backupJob.update({ where: { id: job.id }, data: { status: 'QUEUED', stage: 'QUEUED', progressPercent: 0, checkpointJson: { version: 1, nextStage: 'PRECHECK' }, recordsProcessed: 0, recordsTotal: null, bytesProcessed: 0n, bytesTotal: null, completedAt: null, workerLeaseOwnerId: null, workerLeaseFence: 0n, workerLeaseExpiresAt: null, workerHeartbeatAt: null } });
    });
    assert.equal(await worker.runTenantOnce(tenantId), 1, 'Worker must claim and process the queued job.');

    const completed = await database.inTenantTransaction(tenantId, (tx) => tx.backupJob.findUniqueOrThrow({ where: { id_tenantId: { id: job.id, tenantId } }, include: { artifacts: true } }));
    assert.equal(completed.stage, 'PUBLISHED');
    assert.equal(completed.status, 'PUBLISHED');
    assert.equal(completed.workerLeaseFence, 1n);
    assert.equal(completed.artifacts.length, 1);
    assert.equal(completed.artifacts[0]?.status, 'VERIFIED');
    assert.equal(completed.artifacts[0]?.formatVersion, 'baseer-encrypted-company-archive/v1');
    assert.match(completed.artifacts[0]?.storageKey ?? '', new RegExp(`^encrypted/${tenantId}/${companyId}/${job.id}/1\\.bca$`));
    const encryptedPath = join(root, 'encrypted', tenantId, companyId, job.id, '1.bca');
    assert.equal((await stat(encryptedPath)).isFile(), true, 'Only the encrypted final artifact may be published.');
    await assert.rejects(() => stat(join(root, 'published', tenantId, companyId, job.id, '1')), { code: 'ENOENT' }, 'No plaintext published directory may exist.');
    await verifyCategoryParentCycleRejection(database, tenantId, companyId, accountId);
    verifyFinancialTruthSourcesRemainBlocked();
    await verifyFencedCompareAndSet(database, backups, tenantId, companyId, userId);
    console.log('Company archive worker integration verification passed: queue claim, fenced lease, repeatable export, manifest publication and verified artifact are active.');
  } finally {
    await database.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
  }
}

function verifyFinancialTruthSourcesRemainBlocked(): void {
  const base = COMPANY_ARCHIVE_SOURCE_REGISTRY[0];
  if (!base) throw new Error('Company archive registry must contain its company source.');
  const unsafeJournalSource = {
    ...base,
    id: 'unsafe-finance-journal',
    sourceTable: 'FinanceJournalEntry' as never,
    entryPath: 'data/unsafe-finance-journal.jsonl' as never,
  } as typeof base;
  assert.throws(
    () => assertCompanyArchiveRegistry([...COMPANY_ARCHIVE_SOURCE_REGISTRY, unsafeJournalSource]),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'REGISTRY_RESTORE_PROVENANCE_REQUIRED',
    'Journal/outflow sources must stay out of the archive until actor mapping and ledger reconciliation are reviewed.',
  );
}

void main();

async function verifyCategoryParentCycleRejection(database: DatabaseService, tenantId: string, companyId: string, accountId: string): Promise<void> {
  const categoriesSource = COMPANY_ARCHIVE_SOURCE_REGISTRY.find((source) => source.id === 'finance-categories');
  if (!categoriesSource) throw new Error('Finance category source must be registered for cycle verification.');
  const selfId = '2ee9e2b6-1410-4d1f-8610-b8fa1b0b0081';
  const cycleAId = 'e5ccf9f5-54e5-4986-a214-7d9e1b0b0081';
  const cycleBId = '7c8b12f9-4f40-4eeb-a4e2-6cad1b0b0081';
  try {
    await database.inTenantTransaction(tenantId, async (tx) => {
      await tx.financeCategory.upsert({ where: { id: selfId }, update: { parentId: selfId }, create: { id: selfId, tenantId, companyId, parentId: selfId, accountId, code: 'CYCLE-SELF', nameAr: 'فئة ذاتية', nameEn: 'Self cycle', kind: 'PURCHASE' } });
    });
    await assert.rejects(
      () => database.inTenantReadSnapshot(tenantId, (tx) => categoriesSource.read(tx, { tenantId, companyId })),
      isFinanceCategoryParentCycle,
      'A self-parented category must block archive publication.',
    );
    await database.inTenantTransaction(tenantId, async (tx) => {
      await tx.financeCategory.update({ where: { id: selfId }, data: { parentId: null } });
      await tx.financeCategory.delete({ where: { id: selfId } });
      await tx.financeCategory.upsert({ where: { id: cycleAId }, update: { parentId: cycleBId }, create: { id: cycleAId, tenantId, companyId, parentId: null, accountId, code: 'CYCLE-A', nameAr: 'فئة دائرة أ', nameEn: 'Cycle A', kind: 'PURCHASE' } });
      await tx.financeCategory.upsert({ where: { id: cycleBId }, update: { parentId: cycleAId }, create: { id: cycleBId, tenantId, companyId, parentId: cycleAId, accountId, code: 'CYCLE-B', nameAr: 'فئة دائرة ب', nameEn: 'Cycle B', kind: 'PURCHASE' } });
      await tx.financeCategory.update({ where: { id: cycleAId }, data: { parentId: cycleBId } });
    });
    await assert.rejects(
      () => database.inTenantReadSnapshot(tenantId, (tx) => categoriesSource.read(tx, { tenantId, companyId })),
      isFinanceCategoryParentCycle,
      'A two-category parent cycle must block archive publication.',
    );
  } finally {
    await database.inTenantTransaction(tenantId, async (tx) => {
      await tx.financeCategory.updateMany({ where: { id: { in: [selfId, cycleAId, cycleBId] }, tenantId, companyId }, data: { parentId: null } });
      await tx.financeCategory.deleteMany({ where: { id: { in: [selfId, cycleAId, cycleBId] }, tenantId, companyId } });
    });
  }
}

function isFinanceCategoryParentCycle(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'FINANCE_CATEGORY_PARENT_CYCLE';
}

async function verifyFencedCompareAndSet(database: DatabaseService, backups: BackupService, tenantId: string, companyId: string, userId: string): Promise<void> {
  const job = await backups.createCompanyArchiveJob({ tenantId, companyId, actorUserId: userId }, { idempotencyKey: 'backup-worker-fencing-verification', reason: 'fencing verification' });
  const ownerA = '10c11d52-2d59-4fba-8f8d-100000000081';
  const ownerB = '20c11d52-2d59-4fba-8f8d-200000000081';
  const racing = new RacingBackupService(database, ownerB);
  const scopeA = (fence: bigint): BackupWorkerJobScope => ({ tenantId, companyId, jobId: job.id, workerLeaseOwnerId: ownerA, workerLeaseFence: fence });

  await resetFencedJob(database, tenantId, companyId, job.id, ownerA, 1n, 'QUEUED');
  await assert.rejects(
    () => racing.advanceWorkerJob(scopeA(1n), { stage: 'PRECHECK', progressPercent: 1, checkpoint: { version: 1, nextStage: 'PRECHECK' } }),
    /fenced/i,
    'A worker that loses its fence after reading a job must not transition it.',
  );
  const afterTransitionRace = await database.inTenantTransaction(tenantId, (tx) => tx.backupJob.findUniqueOrThrow({ where: { id_tenantId: { id: job.id, tenantId } }, select: { stage: true, workerLeaseOwnerId: true, workerLeaseFence: true } }));
  assert.deepEqual(afterTransitionRace, { stage: 'QUEUED', workerLeaseOwnerId: ownerB, workerLeaseFence: 2n });

  await resetFencedJob(database, tenantId, companyId, job.id, ownerA, 7n, 'VERIFY_HASHES');
  await assert.rejects(
    () => racing.recordPublishedCompanyArchive(scopeA(7n), { formatVersion: 'baseer-encrypted-company-archive/v1', storageKey: 'encrypted/test/fenced.bca', filename: 'fenced.bca', sha256: 'a'.repeat(64), byteSize: 1n }),
    /fenced|eligible/i,
    'A worker that loses its fence must not create or record an artifact.',
  );
  const afterArtifactRace = await database.inTenantTransaction(tenantId, (tx) => tx.backupArtifact.findMany({ where: { jobId: job.id } }));
  assert.equal(afterArtifactRace.length, 0, 'A stale worker must not persist an artifact after a fence race.');
}

async function resetFencedJob(database: DatabaseService, tenantId: string, companyId: string, jobId: string, ownerId: string, fence: bigint, stage: 'QUEUED' | 'VERIFY_HASHES'): Promise<void> {
  await database.inTenantTransaction(tenantId, async (tx) => {
    await tx.backupArtifact.deleteMany({ where: { jobId } });
    await tx.backupJob.update({ where: { id: jobId }, data: { status: stage, stage, progressPercent: stage === 'VERIFY_HASHES' ? 92 : 0, checkpointJson: { version: 1, nextStage: stage }, workerLeaseOwnerId: ownerId, workerLeaseFence: fence, workerLeaseExpiresAt: new Date(Date.now() + 120_000), workerHeartbeatAt: new Date() } });
  });
}

class RacingBackupService extends BackupService {
  constructor(private readonly raceDatabase: DatabaseService, private readonly winningOwnerId: string) { super(raceDatabase); }

  protected override async beforeWorkerTransitionCompareAndSet(scope: BackupWorkerJobScope): Promise<void> { await this.flipFence(scope); }
  protected override async beforeArtifactCompareAndSet(scope: BackupWorkerJobScope): Promise<void> { await this.flipFence(scope); }

  private async flipFence(scope: BackupWorkerJobScope): Promise<void> {
    await this.raceDatabase.inTenantTransaction(scope.tenantId, (tx) => tx.backupJob.update({
      where: { id: scope.jobId },
      data: { workerLeaseOwnerId: this.winningOwnerId, workerLeaseFence: { increment: 1 }, workerLeaseExpiresAt: new Date(Date.now() + 120_000), workerHeartbeatAt: new Date() },
    }));
  }
}
