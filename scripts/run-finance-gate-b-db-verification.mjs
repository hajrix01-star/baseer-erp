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
  tenantCode: `finance-gate-${suffix}`,
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
  const setup = await services.setup.initialize(context, {
    fiscalPeriodNameAr: 'الفترة التجريبية',
    fiscalPeriodNameEn: 'Finance gate period',
    fiscalPeriodStartDate: date('2026-01-01'),
    fiscalPeriodEndDate: date('2026-12-31'),
    selectedVaults: ['CASH', 'BANK'],
  });
  assert.ok(setup.periodId);

  const master = await database.inTenantTransaction(fixture.tenantId, async (transaction) => {
    const category = await transaction.financeCategory.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, kind: 'EXPENSE', status: 'ACTIVE' },
      select: { id: true },
    });
    const vault = await transaction.financeVault.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, isPaymentDestination: true, status: 'ACTIVE' },
      select: { id: true },
    });
    const supplier = await transaction.financeSupplier.create({
      data: { id: randomUUID(), tenantId: fixture.tenantId, companyId: fixture.companyId, categoryId: category.id, nameAr: `مورد ${suffix}`, nameEn: `Supplier ${suffix}` },
      select: { id: true },
    });
    return { categoryId: category.id, vaultId: vault.id, supplierId: supplier.id };
  });

  const due = await services.dues.createDue({
    context,
    idempotencyKey: randomUUID(),
    request: { supplierId: master.supplierId, categoryId: master.categoryId, sourceDocumentNumber: `DUE-${suffix}`, businessDate: date('2026-08-15'), amount: '100.0000' },
  });
  assert.equal(due.remainingAmount, '100.0000');
  await assert.rejects(
    () => services.dues.createDue({
      context,
      idempotencyKey: randomUUID(),
      request: { supplierId: master.supplierId, categoryId: master.categoryId, sourceDocumentNumber: `FUTURE-${suffix}`, businessDate: date('2099-01-01'), amount: '1.0000' },
    }),
    'A future purchase business date must be rejected.',
  );

  const payment = await services.dues.recordPayment({
    context,
    idempotencyKey: randomUUID(),
    request: { dueId: due.dueId, vaultId: master.vaultId, businessDate: date('2026-08-16'), amount: '40.0000' },
  });
  assert.equal(payment.remainingAmount, '60.0000');

  const projectionBeforeReverse = await database.inTenantTransaction(fixture.tenantId, (transaction) =>
    services.dues.listPostedCashPaymentProjectionInTransaction(transaction, { tenantId: fixture.tenantId, companyId: fixture.companyId }),
  );
  assert.equal(projectionBeforeReverse.length, 1, 'Only the paid amount must appear in cash projection.');
  assert.equal(projectionBeforeReverse[0].amount, '40.0000');

  await assert.rejects(
    () => services.dues.recordPayment({ context: otherContext, idempotencyKey: randomUUID(), request: { dueId: due.dueId, vaultId: master.vaultId, businessDate: date('2026-08-16'), amount: '1.0000' } }),
    'Cross-company payment must be rejected.',
  );

  const reversedDuePayment = await services.dues.reversePayment({
    context,
    idempotencyKey: randomUUID(),
    request: { paymentId: payment.paymentId, businessDate: date('2026-08-17'), reason: 'Finance gate reversal' },
  });
  assert.equal(reversedDuePayment.remainingAmount, '100.0000');
  const projectionAfterReverse = await database.inTenantTransaction(fixture.tenantId, (transaction) =>
    services.dues.listPostedCashPaymentProjectionInTransaction(transaction, { tenantId: fixture.tenantId, companyId: fixture.companyId }),
  );
  assert.equal(projectionAfterReverse.length, 0, 'A reversed payment must leave cash projection.');

  const loan = await services.loans.createOpeningLoan({
    context,
    idempotencyKey: randomUUID(),
    request: { sourceDocumentNumber: `LOAN-${suffix}`, originalAmount: '1000.0000', openingOutstandingAmount: '600.0000', installmentAmount: '200.0000', termMonths: 3, firstInstallmentDueDate: date('2026-09-01'), openingBusinessDate: date('2026-08-15') },
  });
  assert.equal(loan.openingOutstandingAmount, '600.0000');
  const loanPayment = await services.repayments.recordRepayment({
    context,
    idempotencyKey: randomUUID(),
    request: { loanId: loan.loanId, vaultId: master.vaultId, businessDate: date('2026-08-18'), amount: '200.0000' },
  });
  assert.equal(loanPayment.remainingAmount, '400.0000');
  const reversedLoanPayment = await services.repayments.reverseRepayment({
    context,
    idempotencyKey: randomUUID(),
    request: { paymentId: loanPayment.paymentId, businessDate: date('2026-08-19'), reason: 'Finance gate reversal' },
  });
  assert.equal(reversedLoanPayment.remainingAmount, '600.0000');

  await verifySealedBalancedJournals();
  await verifySealedLineCannotChange(due.journalEntryId);

  console.log('Finance Gate B database verification passed: journal seal/balance/immutability, company isolation, supplier-due partial payment/reversal/cash projection, and inclusive-loan repayment/reversal.');
} finally {
  if (database) await database.onModuleDestroy();
  await pool.end();
}

async function loadServices() {
  const [{ DatabaseService }, { FinanceFoundationService }, { FinancePeriodService }, { JournalPostingService }, { FinanceVaultService }, { IdempotencyService }, { CompanyFinanceSetupService }, { SupplierDuesService }, { InclusiveLoanService }, { InclusiveLoanRepaymentService }, { BusinessDateService }] = await Promise.all([
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-foundation.service.js'),
    import('../apps/api/dist/finance/finance-period.service.js'),
    import('../apps/api/dist/finance/journal/journal-posting.service.js'),
    import('../apps/api/dist/finance/finance-vault.service.js'),
    import('../apps/api/dist/core-controls/idempotency.service.js'),
    import('../apps/api/dist/finance/company-finance-setup.service.js'),
    import('../apps/api/dist/finance/supplier-dues.service.js'),
    import('../apps/api/dist/finance/inclusive-loan.service.js'),
    import('../apps/api/dist/finance/inclusive-loan-repayment.service.js'),
    import('../apps/api/dist/business-date/business-date.service.js'),
  ]);
  database = new DatabaseService();
  const periods = new FinancePeriodService(database);
  const journals = new JournalPostingService(periods);
  const idempotency = new IdempotencyService(database);
  const foundation = new FinanceFoundationService(database);
  const businessDates = new BusinessDateService(
    database,
    {},
    { now: () => new Date('2026-08-20T12:00:00.000Z') },
  );
  return {
    setup: new CompanyFinanceSetupService(database, foundation, periods),
    dues: new SupplierDuesService(database, idempotency, journals, new FinanceVaultService(), businessDates),
    loans: new InclusiveLoanService(database, idempotency, journals, businessDates),
    repayments: new InclusiveLoanRepaymentService(database, idempotency, journals, businessDates),
  };
}

async function seedFixture() {
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, `Finance Gate ${suffix}`]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, 'Finance Gate AR', 'Finance Gate', $4), ($5::uuid, $2::uuid, $6, 'Finance Gate Other AR', 'Finance Gate Other', $4)`,
      [fixture.userId, fixture.tenantId, `finance-gate-${suffix}@baseer.test`, await bcrypt.hash(`Gate-${suffix}`, 12), randomUUID(), `finance-gate-other-${suffix}@baseer.test`],
    );
    await client.query(
      `INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, 'شركة بوابة مالية', 'Finance Gate Company'), ($3::uuid, $2::uuid, 'شركة أخرى', 'Other Company')`,
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

async function verifySealedBalancedJournals() {
  const result = await database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.financeJournalEntry.findMany({
    where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  }));
  assert.ok(result.length >= 5, 'Expected journals for due/payment/reversals and loan flows.');
  for (const entry of result) {
    assert.equal(entry.isSealed, true, 'Every posted finance journal must be sealed.');
    assert.ok(entry.lines.length >= 2, 'Every finance journal must have at least two lines.');
    const debit = entry.lines.reduce((total, line) => total + Number(line.debitAmount), 0);
    const credit = entry.lines.reduce((total, line) => total + Number(line.creditAmount), 0);
    assert.equal(debit, credit, 'Every finance journal must balance.');
  }
}

async function verifySealedLineCannotChange(journalEntryId) {
  await assert.rejects(
    () => database.inTenantTransaction(fixture.tenantId, async (transaction) => {
      const line = await transaction.financeJournalLine.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, journalEntryId }, select: { id: true } });
      await transaction.financeJournalLine.update({ where: { id: line.id }, data: { description: 'must fail' } });
    }),
    'A sealed journal line must be immutable.',
  );
}

function date(value) { return new Date(`${value}T00:00:00.000Z`); }
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
