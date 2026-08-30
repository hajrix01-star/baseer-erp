import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const APPROVAL = 'APPLY_APPROVED_NOORIX_ACTIVE_EMPLOYEE_COMPENSATION_V1';
const EFFECTIVE_FROM = new Date('2026-09-01T00:00:00.000Z');
const sourceEmployees = [
  ['cmngelcom001tdz97e8aoiwgs', '2393.8600'], ['cmngelcoy001xdz97zpd4prai', '1595.9100'],
  ['cmngelcp40021dz97vst5qdf3', '715.5900'], ['cmngelcpf0029dz97ye57j5iu', '858.7100'],
  ['cmngelcpl002ddz97wrtqjlq2', '1861.8900'], ['cmngelcpq002hdz97grl0s89i', '811.0100'],
  ['cmngelcpv002ldz97fwaf546l', '715.5900'], ['cmngelcq1002pdz97y6eew9rn', '763.3000'],
  ['cmngelcqc002xdz97p50gmmak', '5000.0000'], ['cmnpym4xm0009igwy82hh9kq6', '3000.0000'],
  ['cmovc020c01du11ch0kf7jzu3', '1800.0000'], ['cmrqvzgav00hxnjp01jwurlzm', '2650.0000'],
].map(([sourceId, monthlyGross]) => ({ sourceId, monthlyGross }));

const [packageId, tenantId, companyId, actorUserId, approval] = process.argv.slice(2);
if (!packageId || !tenantId || !companyId || !actorUserId || approval !== APPROVAL
  || ![packageId, tenantId, companyId, actorUserId].every((value) => /^[0-9a-f-]{36}$/i.test(value))) {
  throw new Error(`Usage: node scripts/run-local-nurix-active-employee-compensation-import.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> ${APPROVAL}`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test')
  throw new Error('Refusing the compensation import outside the canonical local Baseer test database.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { HrPayrollService } = await import('../apps/api/dist/hr/hr-payroll.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const context = { tenantId, companyId, actorUserId };
  const database = app.get(DatabaseService);
  const sourceIds = sourceEmployees.map((employee) => employee.sourceId);
  const maps = await database.inTenantTransaction(tenantId, (tx) => tx.nurixExcelMasterDataItem.findMany({
    where: { entity: 'EMPLOYEE', sourceId: { in: sourceIds }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } },
    select: { sourceId: true, targetId: true },
  }));
  const targetBySource = new Map(maps.map((map) => [map.sourceId, map.targetId]));
  if (targetBySource.size !== sourceEmployees.length || [...targetBySource.values()].some((id) => !id))
    throw new Error('Every approved active Noorix employee must have exactly one completed Baseer employee mapping before compensation is written.');

  const payroll = app.get(HrPayrollService);
  const receipts = [];
  for (const source of sourceEmployees) {
    const employeeId = targetBySource.get(source.sourceId);
    const key = createHash('sha256').update(`nurix-employee-compensation-v1:${packageId}:${source.sourceId}`).digest('hex');
    receipts.push(await payroll.setCompensation(context, {
      employeeId,
      effectiveFrom: EFFECTIVE_FROM,
      monthlyGross: source.monthlyGross,
      compensationMethod: 'FIXED_MONTHLY',
      foodAllowance: '0.0000', housingAllowance: '0.0000', transportAllowance: '0.0000', otherAllowance: '0.0000',
      notes: `ترحيل راتب أساسي حالي من نوركس؛ معرف المصدر ${source.sourceId}. يسري من 2026-09-01 ولا يعيد إنشاء مسير تاريخي.`,
    }, key));
  }
  console.log(JSON.stringify({ status: 'COMPLETED', effectiveFrom: '2026-09-01', employees: receipts.length, monthlyGrossTotal: sourceEmployees.reduce((sum, row) => sum + Number(row.monthlyGross), 0).toFixed(4), replayed: receipts.filter((receipt) => receipt.replayed).length }));
} finally {
  await app.close();
}
