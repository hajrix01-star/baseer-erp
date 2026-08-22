import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const context = {
  tenantId: '6ffae759-800e-4653-8543-51013f5ef751',
  companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70',
  actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77',
};
const businessDate = new Date('2026-08-22T00:00:00.000Z');
const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
const marker = 'اختبار تشغيلي فعلي 2026-08-22';
let app;

try {
  const [
    { AppModule }, { DatabaseService }, { PurchaseExpenseService }, { OperationsAssetsWarrantyService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/purchase-expense.service.js'),
    import('../apps/api/dist/operations/operations-assets-warranty.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const documents = app.get(PurchaseExpenseService);
  const assets = app.get(OperationsAssetsWarrantyService);
  const master = await database.inTenantTransaction(context.tenantId, async (tx) => ({
    category: await tx.financeCategory.findFirstOrThrow({ where: { tenantId: context.tenantId, companyId: context.companyId, code: 'P4-3', kind: 'PURCHASE', status: 'ACTIVE', isPosting: true }, select: { id: true } }),
    vault: await tx.financeVault.findFirstOrThrow({ where: { tenantId: context.tenantId, companyId: context.companyId, type: 'CASH', status: 'ACTIVE', isPaymentDestination: true }, select: { id: true } }),
  }));

  const posted = await documents.createBatch({
    context,
    idempotencyKey: randomUUID(),
    request: {
      businessDate,
      items: [{
        kind: 'PURCHASE',
        settlementKind: 'PAID',
        categoryId: master.category.id,
        supplierInvoiceMissingReason: `${marker} فاتورة أصل تجريبي`,
        grossAmount: '100.0000',
        isTaxable: false,
        assetWarrantyFollowUp: true,
        allocations: [{ vaultId: master.vault.id, grossAmount: '100.0000' }],
      }],
    },
  });
  const documentId = posted.documents[0].documentId;
  const journalCountBefore = await database.inTenantTransaction(context.tenantId, (tx) => tx.financeJournalEntry.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }));
  let workspace = await assets.workspace(context);
  assert.ok(workspace.queue.some((item) => item.documentId === documentId));
  await assets.setFollowUp(context, { documentId, enabled: false, idempotencyKey: randomUUID() });
  assert.equal((await assets.workspace(context)).queue.some((item) => item.documentId === documentId), false);
  await assets.setFollowUp(context, { documentId, enabled: true, idempotencyKey: randomUUID() });

  const created = await assets.createAsset(context, {
    sourceDocumentId: documentId,
    nameAr: `${marker} أصل تشغيلي`,
    nameEn: `Live asset ${suffix}`,
    serialNumber: `LIVE-ASSET-${suffix}`,
    location: 'المطبخ التجريبي',
    warrantyProvider: 'مورد الاختبار',
    warrantyStartsAt: '2026-08-22',
    warrantyEndsAt: '2027-08-21',
    lines: [{ description: 'قطعة ضمان اختبارية', serialNumber: `LIVE-COMP-${suffix}`, warrantyEndsAt: '2027-08-21' }],
    idempotencyKey: randomUUID(),
  });
  workspace = await assets.workspace(context);
  const asset = workspace.assets.find((item) => item.id === created.id);
  assert.ok(asset);
  assert.equal(asset.acquisitionAmount, '100.0000');
  assert.equal(asset.lines.length, 1);
  await assets.archiveAsset(context, { assetId: created.id, idempotencyKey: randomUUID() });
  const archived = (await assets.workspace(context)).assets.find((item) => item.id === created.id);
  assert.equal(archived.status, 'ARCHIVED');
  const journalCountAfter = await database.inTenantTransaction(context.tenantId, (tx) => tx.financeJournalEntry.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }));
  assert.equal(journalCountAfter, journalCountBefore);

  console.log(JSON.stringify({
    status: 'passed', marker,
    records: { outflowDocumentId: documentId, assetId: created.id },
    checks: ['paid-purchase-document', 'asset-follow-up-queue', 'asset-warranty-snapshot', 'asset-archive', 'no-additional-financial-posting'],
  }, null, 2));
} finally {
  await app?.close();
}
