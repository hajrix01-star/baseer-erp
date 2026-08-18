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
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, kind: 'EXPENSE', status: 'ACTIVE', isPosting: true },
      select: { id: true },
    });
    const vault = await transaction.financeVault.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, type: 'CASH', isPaymentDestination: true, status: 'ACTIVE' },
      select: { id: true },
    });
    const bankVault = await transaction.financeVault.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, type: "BANK", status: "ACTIVE" },
      select: { id: true },
    });
    const supplier = await transaction.financeSupplier.create({
      data: { id: randomUUID(), tenantId: fixture.tenantId, companyId: fixture.companyId, categoryId: category.id, nameAr: `مورد ${suffix}`, nameEn: `Supplier ${suffix}` },
      select: { id: true },
    });
    return { categoryId: category.id, vaultId: vault.id, bankVaultId: bankVault.id, supplierId: supplier.id };
  });

  const due = await services.dues.createDue({
    context,
    idempotencyKey: randomUUID(),
    request: { supplierId: master.supplierId, categoryId: master.categoryId, sourceDocumentNumber: `DUE-${suffix}`, businessDate: date('2026-08-15'), amount: '100.0000' },
  });
  assert.equal(due.remainingAmount, '100.0000');  const cashBasisPosting = await database.inTenantTransaction(fixture.tenantId, async (transaction) => {
    const [pending, category] = await Promise.all([
      transaction.financeAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, systemKey: 'CASH_BASIS_PENDING_OUTFLOWS' }, select: { id: true } }),
      transaction.financeCategory.findFirstOrThrow({ where: { id: master.categoryId }, select: { accountId: true } }),
    ]);
    const lines = await transaction.financeJournalLine.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, journalEntryId: due.journalEntryId }, select: { accountId: true, debitAmount: true, creditAmount: true } });
    return { pending, category, lines };
  });
  assert.equal(cashBasisPosting.lines.some((line) => line.accountId === cashBasisPosting.pending.id && line.debitAmount.equals('100.0000')), true, 'A credit due must debit pending outflows, not P&L.');
  assert.equal(cashBasisPosting.lines.some((line) => line.accountId === cashBasisPosting.category.accountId && line.debitAmount.gt(0)), false, 'An unpaid due must not debit its P&L category.');
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
  assert.equal(payment.remainingAmount, '60.0000');  const paymentRecognition = await database.inTenantTransaction(fixture.tenantId, async (transaction) => {
    const paymentRow = await transaction.financeSupplierDuePayment.findFirstOrThrow({ where: { id: payment.paymentId }, select: { recognizedNetAmount: true } });
    const lines = await transaction.financeJournalLine.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, journalEntryId: payment.journalEntryId }, select: { accountId: true, debitAmount: true, creditAmount: true } });
    return { paymentRow, lines };
  });
  assert.equal(paymentRecognition.paymentRow.recognizedNetAmount.toFixed(4), '40.0000', 'A partial cash payment must recognise the matching net expense.');
  assert.equal(paymentRecognition.lines.some((line) => line.accountId === cashBasisPosting.category.accountId && line.debitAmount.equals('40.0000')), true, 'The payment journal must debit P&L only for the paid proportion.');
  assert.equal(paymentRecognition.lines.some((line) => line.accountId === cashBasisPosting.pending.id && line.creditAmount.equals('40.0000')), true, 'The payment journal must release the pending-outflow balance.');

  const projectionBeforeReverse = await database.inTenantTransaction(fixture.tenantId, (transaction) =>
    services.dues.listPostedCashPaymentProjectionInTransaction(transaction, { tenantId: fixture.tenantId, companyId: fixture.companyId }),
  );
  assert.equal(projectionBeforeReverse.length, 1, 'Only the paid amount must appear in cash projection.');
  assert.equal(projectionBeforeReverse[0].amount, '40.0000');
  assert.equal(projectionBeforeReverse[0].recognizedNetAmount, '40.0000');

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

  const recurring = await services.recurring.createProfile(context, {
    nameAr: `كهرباء ${suffix}`,
    categoryId: master.categoryId,
    supplierId: master.supplierId,
    expectedAmount: '115.0000',
    intervalMonths: 1,
    nextReminderDate: date('2026-08-20'),
    defaultVaultId: master.vaultId,
    allowAmountOverride: true,
  }, randomUUID());
  const recurringPayment = await services.documents.createRecurringPayment({
    context,
    idempotencyKey: randomUUID(),
    request: {
      profileId: recurring.id,
      businessDate: date('2026-08-20'),
      coverageYear: 2026,
      coverageStartMonth: 8,
      grossAmount: '115.0000',
      isTaxable: false,
      vaultId: master.vaultId,
      supplierInvoiceMissingReason: 'Finance gate test receipt unavailable',
    },
  });
  assert.equal(recurringPayment.coverageMonths, 1);
  await assert.rejects(
    () => services.documents.createRecurringPayment({
      context,
      idempotencyKey: randomUUID(),
      request: {
        profileId: recurring.id,
        businessDate: date('2026-08-20'),
        coverageYear: 2026,
        coverageStartMonth: 8,
        grossAmount: '115.0000',
        isTaxable: false,
        vaultId: master.vaultId,
        supplierInvoiceMissingReason: 'Duplicate coverage must fail',
      },
    }),
    'A recurring coverage slot must not be paid twice.',
  );

  const recurringBatchProfile = await services.recurring.createProfile(context, {
    nameAr: 'اتصالات ' + suffix,
    categoryId: master.categoryId,
    supplierId: master.supplierId,
    expectedAmount: '85.0000',
    intervalMonths: 1,
    nextReminderDate: date('2026-08-20'),
    defaultVaultId: master.vaultId,
    allowAmountOverride: true,
  }, randomUUID());
  const recurringBatchKey = randomUUID();
  const recurringBatch = await services.documents.createRecurringPaymentBatch({
    context,
    idempotencyKey: recurringBatchKey,
    request: {
      businessDate: date('2026-08-20'),
      items: [
        { profileId: recurring.id, coverageYear: 2026, coverageStartMonth: 9, grossAmount: '115.0000', isTaxable: false, vaultId: master.vaultId, supplierInvoiceMissingReason: 'Finance gate recurring batch electricity' },
        { profileId: recurringBatchProfile.id, coverageYear: 2026, coverageStartMonth: 8, grossAmount: '85.0000', isTaxable: false, vaultId: master.vaultId, supplierInvoiceMissingReason: 'Finance gate recurring batch telecom' },
      ],
    },
  });
  assert.equal(recurringBatch.documentCount, 2, 'A recurring batch must persist every valid row.');
  const recurringBatchReplay = await services.documents.createRecurringPaymentBatch({
    context,
    idempotencyKey: recurringBatchKey,
    request: {
      businessDate: date('2026-08-20'),
      items: [
        { profileId: recurring.id, coverageYear: 2026, coverageStartMonth: 9, grossAmount: '115.0000', isTaxable: false, vaultId: master.vaultId, supplierInvoiceMissingReason: 'Finance gate recurring batch electricity' },
        { profileId: recurringBatchProfile.id, coverageYear: 2026, coverageStartMonth: 8, grossAmount: '85.0000', isTaxable: false, vaultId: master.vaultId, supplierInvoiceMissingReason: 'Finance gate recurring batch telecom' },
      ],
    },
  });
  assert.equal(recurringBatchReplay.batchId, recurringBatch.batchId, 'A recurring batch must replay idempotently.');
  await assert.rejects(
    () => services.documents.createRecurringPaymentBatch({
      context,
      idempotencyKey: randomUUID(),
      request: {
        businessDate: date('2026-08-20'),
        items: [
          { profileId: recurringBatchProfile.id, coverageYear: 2026, coverageStartMonth: 9, grossAmount: '85.0000', isTaxable: false, vaultId: master.vaultId, supplierInvoiceMissingReason: 'First duplicate candidate' },
          { profileId: recurringBatchProfile.id, coverageYear: 2026, coverageStartMonth: 9, grossAmount: '85.0000', isTaxable: false, vaultId: master.vaultId, supplierInvoiceMissingReason: 'Second duplicate candidate' },
        ],
      },
    }),
    'A duplicate recurring-coverage row must roll back its entire batch.',
  );
  const rollbackProof = await services.documents.createRecurringPayment({
    context,
    idempotencyKey: randomUUID(),
    request: { profileId: recurringBatchProfile.id, businessDate: date('2026-08-20'), coverageYear: 2026, coverageStartMonth: 9, grossAmount: '85.0000', isTaxable: false, vaultId: master.vaultId, supplierInvoiceMissingReason: 'Rollback coverage proof' },
  });
  assert.equal(rollbackProof.coverageMonths, 1, 'A failed recurring batch must not reserve coverage slots.');
  const payableBatch = await services.documents.createBatch({
    context,
    idempotencyKey: randomUUID(),
    request: {
      businessDate: date('2026-08-20'),
      items: [{
        kind: 'EXPENSE', settlementKind: 'PAYABLE', categoryId: master.categoryId,
        supplierId: master.supplierId, supplierInvoiceMissingReason: 'Finance gate payable',
        grossAmount: '50.0000', isTaxable: false, allocations: [],
      }],
    },
  });
  assert.equal(payableBatch.documentCount, 1);
  assert.ok(payableBatch.documents[0].supplierDueId, 'A payable batch item must create a supplier due without a vault allocation.');

  const transferKey = randomUUID();
  const transfer = await services.treasury.transfer(context, { fromVaultId: master.vaultId, toVaultId: master.bankVaultId, amount: "25.0000", businessDate: date("2026-08-20"), idempotencyKey: transferKey });
  assert.equal(transfer.amount, "25.0000");
  const transferReplay = await services.treasury.transfer(context, { fromVaultId: master.vaultId, toVaultId: master.bankVaultId, amount: "25.0000", businessDate: date("2026-08-20"), idempotencyKey: transferKey });
  assert.equal(transferReplay.journalEntryId, transfer.journalEntryId, "A vault transfer must replay idempotently.");
  await assert.rejects(() => services.treasury.transfer(context, { fromVaultId: master.vaultId, toVaultId: master.vaultId, amount: "1.0000", businessDate: date("2026-08-20"), idempotencyKey: randomUUID() }), "A transfer must require distinct vaults.");
  await assert.rejects(() => services.treasury.transfer(context, { fromVaultId: master.vaultId, toVaultId: master.bankVaultId, amount: "1.0000", businessDate: date("2099-01-01"), idempotencyKey: randomUUID() }), "A future vault transfer must be rejected.");
  const treasury = await services.treasury.workspace(context, { includeArchived: false });
  assert.ok(treasury.vaults.some((vault) => vault.id === master.bankVaultId && vault.inflow === "25.0000"), "Treasury read model must derive the destination inflow from the journal.");
  assert.ok(treasury.groups.some((group) => group.key === "COLLECTION_CHANNELS"), "Treasury workspace must return server-owned vault groups.");
  const activity = await services.treasury.activity(context, master.bankVaultId, { to: date("2026-08-20"), pageSize: 1 });
  assert.equal(activity.items.length, 1, "Vault activity must be paginated by the server.");
  assert.equal(activity.items[0].journalEntryId, transfer.journalEntryId, "Vault activity must expose the transfer entry for its vault.");
  assert.equal(activity.summary.inflow, "25.0000", "Vault activity totals must be derived from the server ledger.");
  await verifySealedBalancedJournals();
  await verifySealedLineCannotChange(due.journalEntryId);

  console.log('Finance Gate B database verification passed: journal seal/balance/immutability, company isolation, supplier dues, inclusive loans, recurring coverage and atomic recurring batches, payable batches and idempotent ledger-derived vault transfers.');
} finally {
  if (database) await database.onModuleDestroy();
  await pool.end();
}

async function loadServices() {
  const [{ DatabaseService }, { FinanceFoundationService }, { FinancePeriodService }, { JournalPostingService }, { FinanceVaultService }, { IdempotencyService }, { DocumentSerialService }, { CompanyFinanceSetupService }, { SupplierDuesService }, { InclusiveLoanService }, { InclusiveLoanRepaymentService }, { RecurringExpenseService }, { PurchaseExpenseService }, { BusinessDateService }] = await Promise.all([
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-foundation.service.js'),
    import('../apps/api/dist/finance/finance-period.service.js'),
    import('../apps/api/dist/finance/journal/journal-posting.service.js'),
    import('../apps/api/dist/finance/finance-vault.service.js'),
    import('../apps/api/dist/core-controls/idempotency.service.js'),
    import('../apps/api/dist/core-controls/document-serial.service.js'),
    import('../apps/api/dist/finance/company-finance-setup.service.js'),
    import('../apps/api/dist/finance/supplier-dues.service.js'),
    import('../apps/api/dist/finance/inclusive-loan.service.js'),
    import('../apps/api/dist/finance/inclusive-loan-repayment.service.js'),
    import('../apps/api/dist/finance/recurring-expense.service.js'),
    import('../apps/api/dist/finance/purchase-expense.service.js'),
    import('../apps/api/dist/business-date/business-date.service.js'),
  ]);
  const { TreasuryService } = await import('../apps/api/dist/finance/treasury.service.js');
  database = new DatabaseService();
  const periods = new FinancePeriodService(database);
  const journals = new JournalPostingService(periods);
  const idempotency = new IdempotencyService(database);
  const serials = new DocumentSerialService();
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
    recurring: new RecurringExpenseService(database, idempotency),
    documents: new PurchaseExpenseService(database, idempotency, serials, journals, new FinanceVaultService(), businessDates),
    treasury: new TreasuryService(database, idempotency, journals, new FinanceVaultService(), businessDates),
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
