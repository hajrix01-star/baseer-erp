import assert from 'node:assert/strict';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const context = {
  tenantId: '6ffae759-800e-4653-8543-51013f5ef751',
  companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70',
  actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77',
};
const day = new Date('2026-08-22T00:00:00.000Z');
let app;

try {
  const [{ AppModule }, { LedgerTrialBalanceReportService }, { PersonalCashPerformanceReportService }, { InvoiceRegisterService }, { TreasuryService }, { DatabaseService }] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/reports/ledger-trial-balance-report.service.js'),
    import('../apps/api/dist/reports/personal-cash-performance-report.service.js'),
    import('../apps/api/dist/finance/invoice-register.service.js'),
    import('../apps/api/dist/finance/treasury.service.js'),
    import('../apps/api/dist/database/database.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const trialBalance = app.get(LedgerTrialBalanceReportService);
  const cashPerformance = app.get(PersonalCashPerformanceReportService);
  const register = app.get(InvoiceRegisterService);
  const treasury = app.get(TreasuryService);
  const database = app.get(DatabaseService);

  const trial = await trialBalance.run(context, { from: day, to: day, includeZeroRows: false });
  assert.equal(trial.state, 'READY');
  assert.equal(trial.totals.periodDebit.raw, trial.totals.periodCredit.raw);
  assert.ok(trial.rows.length > 0);

  const cash = await cashPerformance.run(context, { from: day, to: day, vatInclusive: true });
  assert.ok(cash.state === 'READY' || cash.state === 'NO_DATA');
  const invoiceRegister = await register.workspace(context, {
    from: day, to: day, businessMonths: [], kinds: [], operationFamilies: [], operationClasses: [], supplierIds: [], categoryIds: [], statuses: [], pageSize: 100,
  });
  assert.ok(invoiceRegister.records.length >= 1);
  const treasuryWorkspace = await treasury.workspace(context, { includeArchived: false, to: day });
  const cashVault = treasuryWorkspace.vaults.find((vault) => vault.type === 'CASH');
  const bankVault = treasuryWorkspace.vaults.find((vault) => vault.type === 'BANK');
  assert.ok(cashVault && bankVault);

  const databaseProof = await database.inTenantTransaction(context.tenantId, async (tx) => {
    const [journalCount, unbalanced] = await Promise.all([
      tx.financeJournalEntry.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: 'POSTED', isSealed: true } }),
      tx.$queryRaw`SELECT count(*)::int AS count FROM (SELECT e."id" FROM "FinanceJournalEntry" e JOIN "FinanceJournalLine" l ON l."journalEntryId" = e."id" WHERE e."tenantId" = ${context.tenantId}::uuid AND e."companyId" = ${context.companyId}::uuid AND e."status" = 'POSTED' GROUP BY e."id" HAVING coalesce(sum(l."debitAmount"), 0) <> coalesce(sum(l."creditAmount"), 0)) mismatch`,
    ]);
    return { journalCount, unbalanced: Number(unbalanced[0]?.count ?? 0) };
  });
  assert.equal(databaseProof.unbalanced, 0);

  console.log(JSON.stringify({
    status: 'passed',
    reports: {
      trialBalance: { state: trial.state, reportRunId: trial.reportRunId, rows: trial.rows.length, periodDebit: trial.totals.periodDebit.raw, periodCredit: trial.totals.periodCredit.raw },
      cashPerformance: { state: cash.state, reportRunId: cash.reportRunId ?? null },
      invoiceRegister: { records: invoiceRegister.records.length, summary: invoiceRegister.summary },
      treasury: { cashBalance: cashVault.balanceAsOf, bankBalance: bankVault.balanceAsOf },
    },
    ledger: databaseProof,
  }, null, 2));
} finally {
  await app?.close();
}
