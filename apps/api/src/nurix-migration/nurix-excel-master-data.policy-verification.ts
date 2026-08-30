/** Run after API build against the isolated migration-test database only. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { DatabaseService } from '../database/database.service.js';
import { NurixExcelImportService } from './nurix-excel-import.service.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

const workbookPath = 'outputs/arz-noorix-comprehensive-dry-run-v4/arz-noorix-comprehensive-dry-run-v3.xlsx';

async function main(): Promise<void> {
  const database = new DatabaseService();
  const storage = new NurixExcelStagingStorageService();
  const service = new NurixExcelImportService(database, storage);
  const tenantId = randomUUID(); const companyId = randomUUID(); const userId = randomUUID(); const packageId = randomUUID();
  const bytes = await readFile(workbookPath); const workbookSha256 = createHash('sha256').update(bytes).digest('hex');
  const workbook = XLSX.read(bytes, { type: 'buffer', raw: false });
  const manifest = new Map(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Manifest!, { header: 1, raw: false, defval: '' }).slice(3).map((row) => [String(row[0]), String(row[1])]));
  const sourceCompanyId = manifest.get('source_company_id');
  assert.ok(sourceCompanyId);
  await database.client.tenant.create({ data: { id: tenantId, code: `excel-master-${tenantId.slice(0, 8)}`, name: 'Excel master verification' } });
  await database.inTenantTransaction(tenantId, async (tx) => {
    await tx.user.create({ data: { id: userId, tenantId, loginNormalized: `excel-${userId}@example.invalid`, nameAr: 'مختبر Excel', nameEn: 'Excel verifier', passwordHash: 'not-a-login-password' } });
    await tx.company.create({ data: { id: companyId, tenantId, nameAr: 'شركة اختبار استيراد Excel', nameEn: 'Excel import test company', status: 'ACTIVE', migrationReviewLocked: true } });
  });
  const artifact = await storage.store({ tenantId, packageId, workbookSha256, bytes, existing: { storageReference: null, encryptionIv: null, storedByteSize: null } });
  await database.inTenantTransaction(tenantId, async (tx) => {
    await tx.nurixExcelStagingPackage.create({ data: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: sourceCompanyId!, templateVersion: 'nurix-excel-package/v3', workbookSha256, sourceFingerprint: manifest.get('source_fingerprint')!, status: 'READY_FOR_RECONCILIATION', ...artifact } });
  });
  const context = { tenantId, actorUserId: userId, isOwner: true };
  const receipt = await service.executeMasterData(context, packageId, { waveSize: 25, reason: 'اختبار استئناف الموجات للبيانات المرجعية' });
  assert.equal(receipt.completed, true); assert.equal(receipt.financialWrites, 0); assert.ok(receipt.waves >= 4);
  assert.deepEqual(receipt.reviewRequired, { accounts: 0, categories: 0, employees: 0 });
  assert.ok(receipt.created.accounts > 0 && receipt.created.categories > 0 && receipt.created.employees > 0);
  const repeated = await service.executeMasterData(context, packageId, { waveSize: 25 });
  assert.equal(repeated.completed, true); assert.equal(repeated.processed, 0);
  const counts = await database.inTenantTransaction(tenantId, async (tx) => ({
    accounts: await tx.financeAccount.count({ where: { tenantId, companyId } }), categories: await tx.financeCategory.count({ where: { tenantId, companyId } }), employees: await tx.hrEmployee.count({ where: { tenantId, companyId } }),
    documents: await tx.financeOutflowDocument.count({ where: { tenantId, companyId } }), journals: await tx.financeJournalEntry.count({ where: { tenantId, companyId } }), suppliers: await tx.financeSupplier.count({ where: { tenantId, companyId } }), vaults: await tx.financeVault.count({ where: { tenantId, companyId } }),
  }));
  assert.equal(counts.accounts, receipt.created.accounts); assert.equal(counts.categories, receipt.created.categories); assert.equal(counts.employees, receipt.created.employees);
  assert.equal(counts.documents, 0); assert.equal(counts.journals, 0); assert.equal(counts.suppliers, 0); assert.equal(counts.vaults, 0);
  await database.onModuleDestroy();
  console.log(`Nurix Excel master-data verification passed: ${receipt.waves} resumable waves, ${counts.accounts} accounts, ${counts.categories} categories, ${counts.employees} employees, and no financial writes.`);
}
void main();
