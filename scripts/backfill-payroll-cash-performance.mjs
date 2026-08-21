import assert from 'node:assert/strict';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from '../apps/api/dist/app.module.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { CashPerformanceHistoricalImportService } from '../apps/api/dist/reports/cash-performance-historical-import.service.js';
import { PersonalCashPerformanceReportService } from '../apps/api/dist/reports/personal-cash-performance-report.service.js';

dotenv.config({ path: 'apps/api/.env.baseer-test' });
const CONFIRMATION = 'BACKFILL_PAYROLL_CASH_PERFORMANCE';
const tenantId = process.env.BASEER_HISTORICAL_IMPORT_TENANT_ID;
const companyId = process.env.BASEER_HISTORICAL_IMPORT_COMPANY_ID;

if (!tenantId || !companyId || process.env.BASEER_PAYROLL_BACKFILL_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set BASEER_HISTORICAL_IMPORT_TENANT_ID, BASEER_HISTORICAL_IMPORT_COMPANY_ID and BASEER_PAYROLL_BACKFILL_CONFIRM=${CONFIRMATION}.`);
}

let app;
try {
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  await app.init();
  const database = app.get(DatabaseService);
  const context = await database.inTenantTransaction(tenantId, async (transaction) => {
    const membership = await transaction.companyMembership.findFirst({ where: { tenantId, companyId, role: { code: 'BASEER_COMPANY_MANAGER' } }, select: { userId: true } });
    if (!membership) throw new Error('A company manager is required to own the backfill audit trail.');
    return { tenantId, companyId, actorUserId: membership.userId };
  });
  const receipt = await app.get(CashPerformanceHistoricalImportService).backfillPayrollPayments(context, 'معالجة بيانات تجريبية: ربط دفعة الرواتب المثبتة بتقرير العمليات المحصّلة والمدفوعة فعلياً.');
  const result = await app.get(PersonalCashPerformanceReportService).run(context, { from: date('2026-08-01'), to: date('2026-08-20'), vatInclusive: true });
  assert.equal(result.state, 'READY');
  console.log(JSON.stringify({ backfill: receipt, report: { netCashResult: result.totals.netCashResult.raw, payroll: result.rows.find((row) => row.code === 'expenses:PAYROLL')?.amount.raw ?? null } }, null, 2));
} finally { await app?.close(); }

function date(value) { return new Date(`${value}T00:00:00.000Z`); }
