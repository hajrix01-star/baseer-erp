import assert from 'node:assert/strict';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const TARGETS = Object.freeze([
  { code: 'ARZ', companyId: '7e64301f-c87e-4d98-9881-35328ace117b', expectedCoverage: 'COMPLETE' },
  { code: 'AL_SHAMI', companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70', expectedCoverage: 'APPROVED_HISTORICAL_EXCEPTION' },
]);
const request = { from: date('2026-07-01'), to: date('2026-08-31'), vatInclusive: false };

let app;
try {
  const [{ AppModule }, { DatabaseService }, { AccrualProfitLossReportService }, { Prisma }] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/reports/accrual-profit-loss-report.service.js'),
    import('../apps/api/dist/generated/prisma/client.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const reports = app.get(AccrualProfitLossReportService);
  const receipts = [];

  for (const target of TARGETS) {
    const identity = await database.inTenantTransaction(TENANT_ID, (transaction) => transaction.company.findUnique({
      where: { id: target.companyId },
      select: { nameAr: true, memberships: { where: { role: { code: 'BASEER_COMPANY_MANAGER' } }, take: 1, select: { userId: true } } },
    }));
    assert(identity?.memberships[0]);
    const context = { tenantId: TENANT_ID, companyId: target.companyId, actorUserId: identity.memberships[0].userId };
    const [report, grossReport] = await Promise.all([reports.run(context, request), reports.run(context, { ...request, vatInclusive: true })]);
    assert.equal(report.state, 'READY', `${target.code} P&L must be ready.`);
    assert.equal(grossReport.state, 'READY', `${target.code} VAT-inclusive P&L must be ready.`);
    assert.equal(report.dataCoverage.state, target.expectedCoverage);
    assert.equal(report.vatPresentation.state, 'COMPLETE');
    assert.equal(grossReport.vatPresentation.state, 'COMPLETE');
    const direct = await database.inTenantTransaction(TENANT_ID, async (transaction) => {
      const revision = (await transaction.financeLedgerRevision.findUnique({ where: { tenantId_companyId: { tenantId: TENANT_ID, companyId: target.companyId } }, select: { currentRevision: true } }))?.currentRevision ?? 0n;
      return { revision: revision.toString() };
    });
    const sum = (rows, field) => rows.reduce((total, row) => total.plus(row[field].raw), new Prisma.Decimal(0)).toFixed(4);
    assert.equal(sum(report.salesByVault.rows, 'netAmount'), report.salesByVault.netTotal.raw);
    assert.equal(sum(grossReport.salesByVault.rows, 'grossAmount'), grossReport.salesByVault.grossTotal.raw);
    assert.equal(report.rows.find((row) => row.code === 'REV-001')?.amount.raw, report.salesByVault.netTotal.raw);
    assert.equal(grossReport.rows.find((row) => row.code === 'REV-001')?.amount.raw, grossReport.salesByVault.grossTotal.raw);
    const reusableRuns = await database.inTenantTransaction(TENANT_ID, (transaction) => transaction.reportRun.findMany({
      where: {
        tenantId: TENANT_ID,
        companyId: target.companyId,
        reportCode: 'accrual_profit_loss',
        definitionVersion: 'accrual_profit_loss_v1',
        status: 'READY',
        expiresAt: { gt: new Date() },
        ledgerRevision: BigInt(direct.revision),
        accountMappingVersionId: report.mappingVersion.id,
        accountMappingChecksum: report.mappingVersion.checksum,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }));
    const reusableRun = reusableRuns.find((candidate) =>
      candidate.canonicalOptionsJson?.from === '2026-07-01'
      && candidate.canonicalOptionsJson?.to === '2026-08-31'
      && candidate.canonicalOptionsJson?.vatInclusive === false
      && canonicalJson(candidate.sourceCoverageJson) === canonicalJson(report.dataCoverage));
    const official = reusableRun
      ? {
          reportRunId: reusableRun.id,
          ledgerRevision: reusableRun.ledgerRevision.toString(),
          checksum: reusableRun.checksum,
          expiresAt: reusableRun.expiresAt,
        }
      : await reports.issueOfficialRun(context, request);
    const stored = await database.inTenantTransaction(TENANT_ID, (transaction) => transaction.reportRun.findUnique({ where: { id: official.reportRunId } }));
    assert(stored?.accountMappingVersionId);
    assert.match(stored.accountMappingChecksum ?? '', /^[a-f0-9]{64}$/);
    assert.equal(stored.ledgerRevision.toString(), direct.revision);
    assert.equal(canonicalJson(stored.sourceCoverageJson), canonicalJson(report.dataCoverage));
    const snapshot = await reports.snapshotForDocument(context, official.reportRunId, 'ar');
    assert(snapshot.rows.length > 1);
    const hasCoverageWarning = snapshot.rows.some((row) => row.section === 'تنبيه التغطية');
    assert.equal(hasCoverageWarning, report.dataCoverage.warningAr !== null);
    receipts.push({
      code: target.code,
      company: identity.nameAr,
      coverage: stored.sourceCoverageJson,
      mappingVersion: report.mappingVersion,
      ledgerRevision: direct.revision,
      totals: report.totals,
      vatInclusiveTotals: grossReport.totals,
      salesByVault: report.salesByVault,
      rowCount: report.rows.length,
      officialReportRunId: official.reportRunId,
      officialChecksum: official.checksum,
      officialRunAction: reusableRun ? 'REUSED' : 'CREATED',
    });
  }
  console.log(JSON.stringify({ status: 'passed', period: { from: '2026-07-01', to: '2026-08-31' }, receipts }, null, 2));
} finally {
  await app?.close();
}

function date(value) { return new Date(`${value}T00:00:00.000Z`); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
