import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const target = {
  tenantId: '6ffae759-800e-4653-8543-51013f5ef751',
  companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70',
  actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77',
};
const testDate = date('2026-08-22');
const marker = `اختبار تشغيلي فعلي ${testDate.toISOString().slice(0, 10)}`;
const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
let app;

try {
  const [
    { AppModule },
    { DatabaseService },
    { FinancePeriodLifecycleService },
    { DailySalesService },
    { FinanceMasterDataService },
    { SupplierDuesService },
    { TreasuryService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-period-lifecycle.service.js'),
    import('../apps/api/dist/finance/daily-sales.service.js'),
    import('../apps/api/dist/finance/finance-master-data.service.js'),
    import('../apps/api/dist/finance/supplier-dues.service.js'),
    import('../apps/api/dist/finance/treasury.service.js'),
  ]);

  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const periods = app.get(FinancePeriodLifecycleService);
  const sales = app.get(DailySalesService);
  const masterData = app.get(FinanceMasterDataService);
  const dues = app.get(SupplierDuesService);
  const treasury = app.get(TreasuryService);

  const periodId = await ensureOpenPeriod(database, periods);
  const master = await database.inTenantTransaction(target.tenantId, async (tx) => {
    const cash = await tx.financeVault.findFirstOrThrow({
      where: { tenantId: target.tenantId, companyId: target.companyId, type: 'CASH', status: 'ACTIVE', isPaymentDestination: true },
      select: { id: true, nameAr: true },
    });
    const bank = await tx.financeVault.findFirstOrThrow({
      where: { tenantId: target.tenantId, companyId: target.companyId, type: 'BANK', status: 'ACTIVE', isPaymentDestination: true },
      select: { id: true, nameAr: true },
    });
    const category = await tx.financeCategory.findFirstOrThrow({
      where: { tenantId: target.tenantId, companyId: target.companyId, code: 'E5-2', kind: 'EXPENSE', isPosting: true, status: 'ACTIVE' },
      select: { id: true, nameAr: true },
    });
    return { cash, bank, category };
  });

  const closing = await sales.create({
    context: target,
    idempotencyKey: randomUUID(),
    request: {
      businessDate: testDate,
      scope: 'ALL',
      customerCount: 8,
      allocations: [
        { vaultId: master.cash.id, grossAmount: '600.0000' },
        { vaultId: master.bank.id, grossAmount: '400.0000' },
      ],
      cashHandoverAmount: '600.0000',
      notes: `${marker} — إقفال مبيعات لتمويل سيناريو الاختبار`,
    },
  });
  assert.equal(closing.grossAmount, '1000.0000');

  const supplier = await masterData.createSupplier(target, {
    nameAr: `${marker} مورد قطع الغيار ${suffix}`,
    nameEn: `Live operational test supplier ${suffix}`,
    isTaxRegistered: false,
    supplierType: 'EXPENSE',
    categoryId: master.category.id,
  }, randomUUID());

  const due = await dues.createDue({
    context: target,
    idempotencyKey: randomUUID(),
    request: {
      supplierId: supplier.id,
      categoryId: master.category.id,
      sourceDocumentNumber: `LIVE-DUE-${suffix}`,
      businessDate: testDate,
      amount: '180.0000',
    },
  });
  assert.equal(due.remainingAmount, '180.0000');

  const payment = await dues.recordPayment({
    context: target,
    idempotencyKey: randomUUID(),
    request: { dueId: due.dueId, vaultId: master.cash.id, businessDate: testDate, amount: '80.0000' },
  });
  assert.equal(payment.remainingAmount, '100.0000');

  const transfer = await treasury.transfer(target, {
    fromVaultId: master.cash.id,
    toVaultId: master.bank.id,
    amount: '120.0000',
    businessDate: testDate,
    idempotencyKey: randomUUID(),
  });
  assert.equal(transfer.amount, '120.0000');

  const workspace = await treasury.workspace(target, { includeArchived: false, to: testDate });
  const cash = workspace.vaults.find((vault) => vault.id === master.cash.id);
  const bank = workspace.vaults.find((vault) => vault.id === master.bank.id);
  assert.ok(cash && bank, 'Both treasury vaults must remain visible after live operations.');

  const journalProof = await database.inTenantTransaction(target.tenantId, async (tx) => {
    const journals = await tx.financeJournalEntry.findMany({
      where: { tenantId: target.tenantId, companyId: target.companyId, id: { in: [closing.journalEntryId, due.journalEntryId, payment.journalEntryId, transfer.journalEntryId] } },
      select: { id: true, status: true, description: true, businessDate: true, lines: { select: { debitAmount: true, creditAmount: true } } },
      orderBy: { id: 'asc' },
    });
    return journals.map((journal) => ({
      ...journal,
      debit: journal.lines.reduce((total, line) => total + Number(line.debitAmount), 0).toFixed(4),
      credit: journal.lines.reduce((total, line) => total + Number(line.creditAmount), 0).toFixed(4),
    }));
  });
  assert.equal(journalProof.length, 4);
  for (const journal of journalProof) assert.equal(journal.debit, journal.credit, `Journal ${journal.id} must balance.`);

  console.log(JSON.stringify({
    status: 'passed',
    marker,
    periodId,
    master: { cashVault: master.cash, bankVault: master.bank, category: master.category },
    records: {
      salesClosing: { id: closing.closingId, documentNumber: closing.documentNumber, journalEntryId: closing.journalEntryId, grossAmount: closing.grossAmount },
      supplier: { id: supplier.id },
      supplierDue: { id: due.dueId, journalEntryId: due.journalEntryId, remainingAmount: due.remainingAmount },
      duePayment: { id: payment.paymentId, journalEntryId: payment.journalEntryId, remainingAmount: payment.remainingAmount },
      treasuryTransfer: { journalEntryId: transfer.journalEntryId, amount: transfer.amount },
    },
    balances: { cash: cash.balanceAsOf, bank: bank.balanceAsOf },
    journals: journalProof.map(({ lines, ...journal }) => journal),
  }, null, 2));
} finally {
  await app?.close();
}

async function ensureOpenPeriod(database, periods) {
  const existing = await database.inTenantTransaction(target.tenantId, (tx) => tx.financeFiscalPeriod.findFirst({
    where: { tenantId: target.tenantId, companyId: target.companyId, status: 'OPEN', startDate: { lte: testDate }, endDate: { gte: testDate } },
    select: { id: true },
  }));
  if (existing) return existing.id;
  return periods.createOpenPeriod(target, {
    nameAr: `${marker} — فترة مالية`,
    nameEn: `Live operational test period ${testDate.toISOString().slice(0, 10)}`,
    startDate: testDate,
    endDate: date('2026-12-31'),
  });
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}
