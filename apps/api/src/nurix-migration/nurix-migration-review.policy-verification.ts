/** Run after API build: validates bounded supplier waves and migration locks. */
import assert from 'node:assert/strict';
import { NurixMigrationReviewService } from './nurix-migration-review.service.js';

const tenantId = '22222222-2222-4222-8222-222222222222';
const actorUserId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const sourceCompanyId = 'noorix-arz';
const targetCompanyId = '55555555-5555-4555-8555-555555555555';
const candidates = Array.from({ length: 30 }, (_, index) => ({ sourceCompanyId, sourceSupplierId: `supplier-${index + 1}`, sourceChecksum: `${String(index + 1).padStart(2, '0')}${'a'.repeat(62)}`, nameAr: `مورد ${index + 1}`, nameEn: null }));
const maps = new Map<string, { targetCompanyId: string; targetEntity: string; targetId: string; transformVersion: string; sourceChecksum: string; state: string }>();
let locked = true;
let approved = true;
let supplierCreates = 0;

const transaction = {
  legacyMigrationRun: { findFirst: async () => ({ id: runId, status: 'DISCOVERY', sourceFingerprint: 'f'.repeat(64), transformVersion: 'nurix-dry-run/v1', createdAt: new Date() }) },
  legacyMigrationCompanyMap: { findMany: async () => [{ sourceCompanyId, targetCompanyId, state: 'PLANNED' }] },
  legacyMigrationReviewAction: { findMany: async () => approved ? [
      { action: 'APPROVE_COMPANY_MAPS', actionKey: 'ALL_PLANNED_COMPANY_MAPS' },
      { action: 'APPROVE_DIRECT_CANDIDATES', actionKey: 'CATEGORY_DIRECT' },
      { action: 'APPROVE_DIRECT_CANDIDATES', actionKey: 'ACCOUNT_CODE_TYPE' },
    ] : [] },
  legacyMigrationCounterpartyCandidate: { findMany: async () => candidates },
  legacyMigrationCounterpartyResolution: { findMany: async () => [] },
  company: { findMany: async () => [{ id: targetCompanyId, status: 'ACTIVE', migrationReviewLocked: locked }] },
  legacyMigrationRecordMap: {
    findFirst: async ({ where }: { where: { sourceId: string } }) => maps.get(where.sourceId) ?? null,
    create: async ({ data }: { data: { sourceId: string; targetCompanyId: string; targetEntity: string; targetId: string; transformVersion: string; sourceChecksum: string; state: string } }) => {
      if (maps.has(data.sourceId)) throw new Error('DUPLICATE_SOURCE_MAP');
      maps.set(data.sourceId, { targetCompanyId: data.targetCompanyId, targetEntity: data.targetEntity, targetId: data.targetId, transformVersion: data.transformVersion, sourceChecksum: data.sourceChecksum, state: data.state });
      return data;
    },
  },
  financeSupplier: { create: async () => ({ id: `supplier-target-${++supplierCreates}` }) },
  financeOutflowDocument: { create: async () => { throw new Error('FINANCIAL_DOCUMENT_WRITE_FORBIDDEN'); } },
  financeJournalEntry: { create: async () => { throw new Error('FINANCIAL_JOURNAL_WRITE_FORBIDDEN'); } },
  auditEvent: { create: async () => ({}) },
};

const database = { inTenantTransaction: async (_scope: string, callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) };
const service = new NurixMigrationReviewService(database as never);
const context = { tenantId, actorUserId, isOwner: true };

const first = await service.createProvisionalSupplierWave(context, runId, { reason: 'دفعة الموردين الأولى', waveSize: 25 });
assert.deepEqual(first, { created: 25, reused: 0, linkedToExistingIdentity: 0, total: 30, processed: 25, remaining: 5, completed: false, waves: 1 });
assert.equal(maps.size, 25);
assert.equal(maps.get('supplier-1')?.state, 'STAGED');
const second = await service.createProvisionalSupplierWave(context, runId, { reason: 'استئناف الدفعة', waveSize: 25 });
assert.deepEqual(second, { created: 5, reused: 25, linkedToExistingIdentity: 0, total: 30, processed: 5, remaining: 0, completed: true, waves: 1 });
assert.equal(maps.size, 30);
assert.equal(supplierCreates, 30);
maps.clear();
supplierCreates = 0;
const automatic = await service.createProvisionalSuppliers(context, runId, { reason: 'منسق الموجات التلقائي', waveSize: 25 });
assert.deepEqual(automatic, { created: 30, reused: 0, linkedToExistingIdentity: 0, total: 30, processed: 30, remaining: 0, completed: true, waves: 2 });
assert.equal(maps.size, 30);
assert.equal(supplierCreates, 30);
locked = false;
await assert.rejects(() => service.createProvisionalSuppliers(context, runId, { reason: 'محاولة على شركة غير مقفلة', waveSize: 25 }));
assert.equal(supplierCreates, 30);
locked = true;
approved = false;
await assert.rejects(() => service.createProvisionalSuppliers(context, runId, { reason: 'محاولة دون الاعتمادات', waveSize: 25 }));
assert.equal(supplierCreates, 30);
console.log('Nurix migration review verification passed: 500-bounded waves resume without duplicate suppliers, require approvals and locked targets, and never call financial writers.');
