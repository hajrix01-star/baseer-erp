import assert from 'node:assert/strict';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from './api-workspace-dependencies.mjs';

import { AppModule } from '../apps/api/dist/app.module.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { CashPerformanceHistoricalImportService } from '../apps/api/dist/reports/cash-performance-historical-import.service.js';
import { PersonalCashPerformanceReportService } from '../apps/api/dist/reports/personal-cash-performance-report.service.js';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const CONFIRMATION = 'IMPORT_PERSONAL_CASH_PERFORMANCE_HISTORY';
const tenantId = process.env.BASEER_HISTORICAL_IMPORT_TENANT_ID;
const companyId = process.env.BASEER_HISTORICAL_IMPORT_COMPANY_ID;
const startText = process.env.BASEER_HISTORICAL_IMPORT_START;

if (!tenantId || !companyId || !startText || process.env.BASEER_HISTORICAL_IMPORT_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set BASEER_HISTORICAL_IMPORT_TENANT_ID, BASEER_HISTORICAL_IMPORT_COMPANY_ID, BASEER_HISTORICAL_IMPORT_START and BASEER_HISTORICAL_IMPORT_CONFIRM=${CONFIRMATION}.`);
}

let app;
try {
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  await app.init();

  const database = app.get(DatabaseService);
  const context = await database.inTenantTransaction(tenantId, async (transaction) => {
    const company = await transaction.company.findFirst({
      where: { id: companyId, tenantId }, select: { id: true },
    });
    const membership = await transaction.companyMembership.findFirst({
      where: { tenantId, companyId, role: { code: 'BASEER_COMPANY_MANAGER' } }, select: { userId: true },
    });
    if (!company || !membership) throw new Error('The selected company must exist and have a company manager to own the import audit trail.');
    return { tenantId, companyId, actorUserId: membership.userId };
  });

  const importer = app.get(CashPerformanceHistoricalImportService);
  const report = app.get(PersonalCashPerformanceReportService);
  const receipt = await importer.importDailySales(
    context,
    businessDate(startText),
    'استيراد تاريخي مضبوط للبيانات التجريبية: إقفالات مبيعات يومية مثبتة ومطابقة للخزائن قبل بداية تغطية تقرير الأداء النقدي.',
  );
  const result = await report.run(context, {
    from: businessDate(startText), to: businessDate('2026-08-20'), vatInclusive: true,
  });
  assert.equal(result.state, 'READY');
  console.log(JSON.stringify({ import: receipt, report: {
    state: result.state, period: result.selectedPeriod, inflows: result.totals.inflows.raw,
    outflows: result.totals.outflows.raw, netCashResult: result.totals.netCashResult.raw,
    rows: result.rows.map((row) => ({ code: row.code, amount: row.amount.raw, events: row.eventCount })),
  } }, null, 2));
} finally {
  await app?.close();
}

function businessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Business date must be YYYY-MM-DD.');
  return new Date(`${value}T00:00:00.000Z`);
}
