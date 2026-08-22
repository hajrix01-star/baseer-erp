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
const employeeId = '519f67e9-811e-4736-8d4f-c4fe21d27b74';
const businessDate = new Date('2026-08-22T00:00:00.000Z');
const marker = 'اختبار تشغيلي فعلي 2026-08-22';
let app;

try {
  const [{ AppModule }, { DatabaseService }, { HrAdvanceService }, { HrAdministrativeDeductionService }] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/hr/hr-advance.service.js'),
    import('../apps/api/dist/hr/hr-administrative-deduction.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const advances = app.get(HrAdvanceService);
  const deductions = app.get(HrAdministrativeDeductionService);
  const cashVault = await database.inTenantTransaction(context.tenantId, (tx) => tx.financeVault.findFirstOrThrow({
    where: { tenantId: context.tenantId, companyId: context.companyId, type: 'CASH', status: 'ACTIVE', isPaymentDestination: true },
    select: { id: true },
  }));

  const issued = await advances.issue(context, {
    employeeId,
    businessDate,
    amount: '90.0000',
    allocations: [{ vaultId: cashVault.id, amount: '90.0000', paymentMethod: 'CASH' }],
    notes: `${marker} سلفة اختبار`,
  }, randomUUID());
  const firstSettlement = await advances.settleDirectly(context, {
    advanceId: issued.id,
    businessDate,
    amount: '40.0000',
    allocations: [{ vaultId: cashVault.id, amount: '40.0000', paymentMethod: 'CASH' }],
    notes: `${marker} تسوية سلفة جزئية`,
  }, randomUUID());
  assert.equal(firstSettlement.remainingAmount, '50.0000');
  const finalSettlement = await advances.settleDirectly(context, {
    advanceId: issued.id,
    businessDate,
    amount: '50.0000',
    allocations: [{ vaultId: cashVault.id, amount: '50.0000', paymentMethod: 'CASH' }],
    notes: `${marker} إقفال سلفة`,
  }, randomUUID());
  assert.equal(finalSettlement.remainingAmount, '0.0000');
  const advanceDetail = await advances.detail(context, issued.id, { settlementPageSize: 10, deferralPageSize: 10 });
  assert.equal(advanceDetail.advance.status, 'SETTLED');
  assert.equal(advanceDetail.settlements.length, 2);

  const deduction = await deductions.create(context, {
    employeeId,
    businessDate,
    amount: '15.0000',
    description: `${marker} خصم إداري منتظر للمسير`,
  }, randomUUID());
  const deductionDetail = await deductions.detail(context, deduction.id, { actionPageSize: 20 });
  assert.equal(deductionDetail.deduction.status, 'OPEN');

  const journals = await database.inTenantTransaction(context.tenantId, async (tx) => tx.financeJournalEntry.findMany({
    where: { tenantId: context.tenantId, companyId: context.companyId, id: { in: [issued.journalEntryId, firstSettlement.journalEntryId, finalSettlement.journalEntryId] } },
    include: { lines: { select: { debitAmount: true, creditAmount: true } } },
  }));
  assert.equal(journals.length, 3);
  for (const journal of journals) {
    const debit = journal.lines.reduce((total, line) => total + Number(line.debitAmount), 0).toFixed(4);
    const credit = journal.lines.reduce((total, line) => total + Number(line.creditAmount), 0).toFixed(4);
    assert.equal(debit, credit);
  }

  console.log(JSON.stringify({
    status: 'passed', marker,
    records: { advanceId: issued.id, advanceJournalEntryId: issued.journalEntryId, firstSettlementId: firstSettlement.id, finalSettlementId: finalSettlement.id, administrativeDeductionId: deduction.id },
    checks: ['advance-issue', 'partial-direct-settlement', 'full-direct-settlement', 'advance-balance-zero', 'administrative-deduction-open', 'balanced-journals'],
  }, null, 2));
} finally {
  await app?.close();
}
