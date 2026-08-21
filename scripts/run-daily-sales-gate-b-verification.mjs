import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment('DATABASE_URL') });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const fixture = {
  tenantId: randomUUID(),
  tenantCode: `daily-sales-${suffix}`,
  userId: randomUUID(),
  companyId: randomUUID(),
  otherCompanyId: randomUUID(),
};
const context = { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.userId };
const otherContext = { tenantId: fixture.tenantId, companyId: fixture.otherCompanyId, actorUserId: fixture.userId };
let database;

try {
  await seedFixture();
  const services = await loadServices();
  await services.setup.initialize(context, {
    fiscalPeriodNameAr: 'فترة إقفال المبيعات',
    fiscalPeriodNameEn: 'Daily sales period',
    fiscalPeriodStartDate: date('2026-01-01'),
    fiscalPeriodEndDate: date('2026-12-31'),
    selectedVaults: ['CASH', 'HUNGERSTATION'],
  });
  const master = await database.inTenantTransaction(fixture.tenantId, async (transaction) => {
    await transaction.companyFinanceProfile.update({
      where: { companyId: fixture.companyId },
      data: { vatAccountingEnabled: true, vatRateBasisPoints: 1500 },
    });
    const vaults = await transaction.financeVault.findMany({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, isSalesChannel: true, status: 'ACTIVE' },
      select: { id: true, type: true },
      orderBy: { type: 'asc' },
    });
    const cash = vaults.find((vault) => vault.type === 'CASH');
    const electronic = vaults.find((vault) => vault.type === 'APP');
    assert.ok(cash && electronic, 'Expected selected Cash and HungerStation sales channels.');
    return { cashVaultId: cash.id, electronicVaultId: electronic.id };
  });

  const createKey = randomUUID();
  const first = await services.dailySales.create({
    context,
    idempotencyKey: createKey,
    request: {
      businessDate: date('2026-08-15'),
      scope: 'ALL',
      customerCount: 4,
      allocations: [
        { vaultId: master.cashVaultId, grossAmount: '100.0000' },
        { vaultId: master.electronicVaultId, grossAmount: '15.0000' },
      ],
      cashHandoverAmount: '80.0000',
      cashHandoverVaultId: master.cashVaultId,
      notes: 'Synthetic daily closing',
    },
  });
  assert.equal(first.grossAmount, '115.0000');
  assert.equal(first.netAmount, '100.0000');
  assert.equal(first.vatAmount, '15.0000');
  assert.equal(first.documentNumber, 'DS-20260815-0001');
  assert.equal(first.status, 'POSTED');

  const replay = await services.dailySales.create({
    context,
    idempotencyKey: createKey,
    request: {
      businessDate: date('2026-08-15'),
      scope: 'ALL',
      customerCount: 4,
      allocations: [
        { vaultId: master.cashVaultId, grossAmount: '100.0000' },
        { vaultId: master.electronicVaultId, grossAmount: '15.0000' },
      ],
      cashHandoverAmount: '80.0000',
      cashHandoverVaultId: master.cashVaultId,
      notes: 'Synthetic daily closing',
    },
  });
  assert.equal(replay.closingId, first.closingId, 'Idempotent create must replay the same closing.');

  const beforeCorrection = await summary('2026-08-15');
  assert.equal(beforeCorrection.salesGrossAmount.toFixed(4), '115.0000');
  assert.equal(beforeCorrection.salesNetAmount.toFixed(4), '100.0000');
  assert.equal(beforeCorrection.salesVatAmount.toFixed(4), '15.0000');
  assert.equal(beforeCorrection.dataStatus, 'RECORDED');

  const corrected = await services.dailySales.correct({
    context,
    idempotencyKey: randomUUID(),
    request: {
      closingId: first.closingId,
      businessDate: date('2026-08-15'),
      customerCount: 5,
      allocations: [{ vaultId: master.cashVaultId, grossAmount: '230.0000' }],
      cashHandoverAmount: '130.0000',
      cashHandoverVaultId: master.cashVaultId,
      notes: 'Corrected closing',
    },
  });
  assert.equal(corrected.documentNumber, first.documentNumber, 'Correction must preserve document number.');
  assert.equal(corrected.postingVersion, 2);
  assert.equal(corrected.netAmount, '200.0000');
  assert.equal(corrected.vatAmount, '30.0000');

  const afterCorrection = await summary('2026-08-15');
  assert.equal(afterCorrection.salesGrossAmount.toFixed(4), '230.0000');
  assert.equal(afterCorrection.customerCount, 5);

  await assert.rejects(
    () => services.calendar.setDay({
      context,
      idempotencyKey: randomUUID(),
      request: { businessDate: date('2026-08-15'), status: 'CLOSED', note: 'Must fail while closing exists' },
    }),
    'An active sales day cannot be changed to CLOSED.',
  );
  await services.calendar.setDay({
    context,
    idempotencyKey: randomUUID(),
    request: { businessDate: date('2026-08-16'), status: 'CLOSED', source: 'HOLIDAY', note: 'Synthetic holiday' },
  });
  const calendar = await services.calendar.listCalendar(context, { fromBusinessDate: date('2026-08-15'), toBusinessDate: date('2026-08-17') });
  assert.deepEqual(calendar.map((day) => day.dataStatus), ['RECORDED', 'CLOSED', 'PENDING']);

  const concurrent = await Promise.allSettled([
    services.dailySales.create({
      context,
      idempotencyKey: randomUUID(),
      request: {
        businessDate: date('2026-08-18'), scope: 'MORNING', customerCount: 1,
        allocations: [{ vaultId: master.cashVaultId, grossAmount: '10.0000' }],
      },
    }),
    services.dailySales.create({
      context,
      idempotencyKey: randomUUID(),
      request: {
        businessDate: date('2026-08-18'), scope: 'MORNING', customerCount: 1,
        allocations: [{ vaultId: master.cashVaultId, grossAmount: '10.0000' }],
      },
    }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1, 'Only one concurrent date/scope closing may post.');
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1, 'The duplicate concurrent closing must be rejected.');
  await assert.rejects(
    () => services.dailySales.create({
      context,
      idempotencyKey: randomUUID(),
      request: {
        businessDate: date('2026-08-18'), scope: 'ALL', customerCount: 1,
        allocations: [{ vaultId: master.cashVaultId, grossAmount: '10.0000' }],
      },
    }),
    'Whole-day closing must not be combined with a shift closing.',
  );
  await assert.rejects(
    () => services.dailySales.create({
      context: otherContext,
      idempotencyKey: randomUUID(),
      request: {
        businessDate: date('2026-08-15'), scope: 'ALL', customerCount: 0,
        allocations: [{ vaultId: master.cashVaultId, grossAmount: '1.0000' }],
      },
    }),
    'A foreign-company vault must not create sales closing.',
  );
  await assert.rejects(
    () => services.dailySales.create({
      context,
      idempotencyKey: randomUUID(),
      request: {
        businessDate: date('2026-08-26'), scope: 'ALL', customerCount: 0,
        allocations: [{ vaultId: master.cashVaultId, grossAmount: '1.0000' }],
      },
    }),
    'Future daily closing must be rejected.',
  );

  const reversed = await services.dailySales.reverse({
    context,
    idempotencyKey: randomUUID(),
    request: { closingId: corrected.closingId, businessDate: date('2026-08-17'), reason: 'Synthetic reversal' },
  });
  assert.equal(reversed.status, 'REVERSED');
  const afterReverse = await summary('2026-08-15');
  assert.equal(afterReverse.salesGrossAmount.toFixed(4), '0.0000');
  assert.equal(afterReverse.dataStatus, 'PENDING');
  await verifySealedJournals(first.closingId);
  console.log('Daily Sales Gate B database verification passed: VAT split, vault channels, idempotency replay, correction/reversal, calendar semantics, company isolation, and server summary rebuild.');
} finally {
  if (database) await database.onModuleDestroy();
  await pool.end();
}

async function loadServices() {
  const [
    { DatabaseService },
    { FinanceFoundationService },
    { FinancePeriodService },
    { JournalPostingService },
    { FinanceVaultService },
    { IdempotencyService },
    { DocumentSerialService },
    { CompanyFinanceSetupService },
    { BusinessDateService },
    { DailySalesProjectionService },
    { DailySalesPostingService },
    { OperationalCalendarService },
    { DailySalesService },
    { DailySalesCommandSupportService },
    { DailySalesWriteService },
    { FinanceCashPerformanceEventService },
  ] = await Promise.all([
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-foundation.service.js'),
    import('../apps/api/dist/finance/finance-period.service.js'),
    import('../apps/api/dist/finance/journal/journal-posting.service.js'),
    import('../apps/api/dist/finance/finance-vault.service.js'),
    import('../apps/api/dist/core-controls/idempotency.service.js'),
    import('../apps/api/dist/core-controls/document-serial.service.js'),
    import('../apps/api/dist/finance/company-finance-setup.service.js'),
    import('../apps/api/dist/business-date/business-date.service.js'),
    import('../apps/api/dist/finance/daily-sales-projection.service.js'),
    import('../apps/api/dist/finance/daily-sales-posting.service.js'),
    import('../apps/api/dist/finance/operational-calendar.service.js'),
    import('../apps/api/dist/finance/daily-sales.service.js'),
    import('../apps/api/dist/finance/daily-sales-command-support.service.js'),
    import('../apps/api/dist/finance/daily-sales-write.service.js'),
    import('../apps/api/dist/finance/finance-cash-performance-event.service.js'),
  ]);
  database = new DatabaseService();
  const periods = new FinancePeriodService();
  const journals = new JournalPostingService(periods);
  const idempotency = new IdempotencyService(database);
  const foundation = new FinanceFoundationService(database);
  const vaults = new FinanceVaultService();
  const businessDates = new BusinessDateService(database, {}, { now: () => new Date('2026-08-25T12:00:00.000Z') });
  const projections = new DailySalesProjectionService();
  const posting = new DailySalesPostingService(journals, periods, vaults, businessDates);
  const support = new DailySalesCommandSupportService(idempotency);
  const cashEvents = new FinanceCashPerformanceEventService();
  const writes = new DailySalesWriteService(new DocumentSerialService(database), journals, projections, posting, support, cashEvents);
  return {
    setup: new CompanyFinanceSetupService(database, foundation, periods),
    calendar: new OperationalCalendarService(database, idempotency, projections),
    dailySales: new DailySalesService(database, posting, support, writes),
  };
}

async function seedFixture() {
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, `Daily sales ${suffix}`]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, 'مستخدم الإقفال', 'Daily sales user', $4)`,
      [fixture.userId, fixture.tenantId, `daily-sales-${suffix}@baseer.test`, await bcrypt.hash(`Gate-${suffix}`, 12)],
    );
    await client.query(
      `INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, 'شركة إقفال مبيعات', 'Daily sales company'), ($3::uuid, $2::uuid, 'شركة أخرى', 'Other company')`,
      [fixture.companyId, fixture.tenantId, fixture.otherCompanyId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function summary(day) {
  return database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.financeDailyFinancialSummary.findFirstOrThrow({
    where: { tenantId: fixture.tenantId, companyId: fixture.companyId, businessDate: date(day) },
  }));
}

async function verifySealedJournals(closingId) {
  const entries = await database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.financeJournalEntry.findMany({
    where: { tenantId: fixture.tenantId, companyId: fixture.companyId, sourceReference: { startsWith: closingId } },
    include: { lines: true },
  }));
  assert.equal(entries.length, 2, 'Correction must retain original and replacement journal entries.');
  for (const entry of entries) {
    assert.equal(entry.isSealed, true, 'Daily sales journals must be sealed.');
    const debit = entry.lines.reduce((total, line) => total + Number(line.debitAmount), 0);
    const credit = entry.lines.reduce((total, line) => total + Number(line.creditAmount), 0);
    assert.equal(debit, credit, 'Daily sales journal must balance.');
  }
}

function date(value) { return new Date(`${value}T00:00:00.000Z`); }
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
