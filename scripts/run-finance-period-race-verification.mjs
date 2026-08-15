import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment('DATABASE_URL') });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const fixture = { tenantId: randomUUID(), userId: randomUUID(), companyId: randomUUID() };
const context = { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.userId };
let database;

try {
  await seedFixture();
  const services = await loadServices();
  const setup = await services.setup.initialize(context, {
    fiscalPeriodNameAr: 'فترة اختبار التزامن',
    fiscalPeriodNameEn: 'Period race verification',
    fiscalPeriodStartDate: date('2026-01-01'),
    fiscalPeriodEndDate: date('2026-12-31'),
    selectedVaults: ['CASH'],
  });
  const accounts = await database.inTenantTransaction(fixture.tenantId, async (transaction) => {
    const expense = await transaction.financeCategory.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, kind: 'EXPENSE', status: 'ACTIVE' }, select: { accountId: true } });
    const cash = await transaction.financeVault.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, isPaymentDestination: true, status: 'ACTIVE' }, select: { accountId: true } });
    return { debitAccountId: expense.accountId, creditAccountId: cash.accountId };
  });

  const postRelease = deferred();
  const postHasPeriodLock = deferred();
  const postPromise = database.inTenantTransaction(fixture.tenantId, async (transaction) => {
    const receipt = await services.journals.postInTransaction(transaction, journalInput(accounts, 'post-before-close'));
    postHasPeriodLock.resolve();
    await postRelease.promise;
    return receipt;
  });
  await postHasPeriodLock.promise;

  let closeSettled = false;
  const closePromise = services.lifecycle.close(context, { periodId: setup.periodId, reason: 'Period race verification' }).then(() => { closeSettled = true; });
  await sleep(100);
  assert.equal(closeSettled, false, 'Period close must wait while a journal posting holds its shared period lock.');

  postRelease.resolve();
  await postPromise;
  await closePromise;

  const period = await database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.financeFiscalPeriod.findFirstOrThrow({ where: { id: setup.periodId, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true } }));
  assert.equal(period.status, 'CLOSED');
  await assert.rejects(
    () => database.inTenantTransaction(fixture.tenantId, (transaction) => services.journals.postInTransaction(transaction, journalInput(accounts, 'post-after-close'))),
    'A journal post after close must be refused.',
  );
  console.log('Finance period race verification passed: close waits for an active post, then closed periods refuse new posts.');
} finally {
  if (database) await database.onModuleDestroy();
  await pool.end();
}

async function loadServices() {
  const [{ DatabaseService }, { FinanceFoundationService }, { FinancePeriodService }, { FinancePeriodLifecycleService }, { JournalPostingService }, { CompanyFinanceSetupService }] = await Promise.all([
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-foundation.service.js'),
    import('../apps/api/dist/finance/finance-period.service.js'),
    import('../apps/api/dist/finance/finance-period-lifecycle.service.js'),
    import('../apps/api/dist/finance/journal/journal-posting.service.js'),
    import('../apps/api/dist/finance/company-finance-setup.service.js'),
  ]);
  database = new DatabaseService();
  const periods = new FinancePeriodService(database);
  const journals = new JournalPostingService(periods);
  return { journals, lifecycle: new FinancePeriodLifecycleService(database, periods), setup: new CompanyFinanceSetupService(database, new FinanceFoundationService(database), periods) };
}

async function seedFixture() {
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, `period-race-${suffix}`, `Period race ${suffix}`]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query(`INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, 'Period Race', 'Period Race', $4)`, [fixture.userId, fixture.tenantId, `period-race-${suffix}@baseer.test`, await bcrypt.hash(`Gate-${suffix}`, 12)]);
    await client.query(`INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, 'شركة اختبار الفترة', 'Period Race Company')`, [fixture.companyId, fixture.tenantId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

function journalInput(accounts, sourceReference) {
  return { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.userId, requestId: randomUUID(), sourceType: 'finance_period_race', sourceReference, businessDate: date('2026-08-20'), lines: [{ accountId: accounts.debitAccountId, debitAmount: '1.0000' }, { accountId: accounts.creditAccountId, creditAmount: '1.0000' }] };
}
function deferred() { let resolve; const promise = new Promise((nextResolve) => { resolve = nextResolve; }); return { promise, resolve }; }
function date(value) { return new Date(`${value}T00:00:00.000Z`); }
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
