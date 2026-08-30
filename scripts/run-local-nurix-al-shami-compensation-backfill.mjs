/**
 * Writes only the current, operational compensation agreements for the live
 * Al-Shami employees.  Historical payroll is deliberately a separate wave:
 * Noorix payroll items do not carry an historical basic/overtime split.
 *
 * Usage:
 *   node scripts/run-local-nurix-al-shami-compensation-backfill.mjs \
 *     <package-id> <tenant-id> <company-id> <owner-user-id> DRY_RUN|APPLY_APPROVED_NOORIX_AL_SHAMI_COMPENSATION_V1
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-compensation/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_COMPENSATION_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const EFFECTIVE_FROM = '2026-09-01';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-compensation-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

// The source is read only from the frozen local rehearsal snapshot.  The
// employee profile data was not part of the Excel workbook, hence the direct
// source read is explicit and source-checksummed below.
const sourceSql = `
SELECT COALESCE(json_agg(json_build_object(
  'sourceId', e.id,
  'employeeNumber', e.employee_serial,
  'status', e.status,
  'basicSalary', e.basic_salary::text,
  'housingAllowance', e.housing_allowance::text,
  'transportAllowance', e.transport_allowance::text,
  'otherAllowance', e.other_allowance::text,
  'workHours', e.work_hours,
  'workSchedule', e.work_schedule,
  'customAllowances', COALESCE((
    SELECT json_agg(json_build_object('nameAr', a.name_ar, 'amount', a.amount::text) ORDER BY a.id)
    FROM employee_custom_allowances a
    WHERE a.company_id=e.company_id AND a.employee_id=e.id
  ), '[]'::json)
) ORDER BY e.employee_serial), '[]'::json)::text AS payload
FROM employees e
WHERE e.company_id='${SOURCE_COMPANY_ID}';`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix employee compensation source was returned.');
const sourceEmployees = JSON.parse(raw);

function decimal(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid Noorix compensation amount: ${label}.`);
  return parsed;
}

function workDays(schedule) {
  const match = /^\[NOORIX_WD:(26|30)\]$/.exec(String(schedule ?? '').trim());
  return match ? Number(match[1]) : null;
}

function profileFromSource(row) {
  const basic = decimal(row.basicSalary, `${row.sourceId}.basicSalary`);
  const housing = decimal(row.housingAllowance, `${row.sourceId}.housingAllowance`);
  const transport = decimal(row.transportAllowance, `${row.sourceId}.transportAllowance`);
  const other = decimal(row.otherAllowance, `${row.sourceId}.otherAllowance`);
  let food = 0;
  let extraTransport = 0;
  for (const allowance of row.customAllowances ?? []) {
    const amount = decimal(allowance.amount, `${row.sourceId}.customAllowance`);
    if (allowance.nameAr === 'بدل أكل') food += amount;
    else if (allowance.nameAr === 'بدل مواصلات إضافي') extraTransport += amount;
    else throw new Error(`Unmapped Noorix custom allowance ${allowance.nameAr ?? '(empty)'} for ${row.employeeNumber}.`);
  }
  const hours = Number(row.workHours);
  const days = workDays(row.workSchedule);
  const allowances = food + housing + transport + extraTransport + other;
  let compensationMethod = 'FIXED_MONTHLY';
  let monthlyGross = basic + allowances;
  if (hours > 8) {
    if (!days) throw new Error(`Live Noorix employee ${row.employeeNumber} has overtime hours without an approved work-day schedule.`);
    // This is the exact inverse of Baseer's STANDARD_MONTHLY_V1 inclusive
    // formula.  It preserves Noorix's current base and allowance fields while
    // making the embedded overtime explicit for future payroll only.
    const overtimeHours = (hours - 8) * Math.min(days, 26) + Math.max(days - 26, 0) * hours;
    const coefficient = overtimeHours / 208;
    monthlyGross = basic * (1 + coefficient * 1.5) + allowances * (1 + coefficient);
    compensationMethod = 'INCLUSIVE_OVERTIME';
  } else if (hours !== 8) {
    throw new Error(`Noorix employee ${row.employeeNumber} has unsupported work hours ${row.workHours}.`);
  }
  if (monthlyGross <= allowances) throw new Error(`Noorix employee ${row.employeeNumber} has non-positive basic compensation.`);
  const sourceChecksum = sha({ sourceId: row.sourceId, basic: fixed(basic), food: fixed(food), housing: fixed(housing), transport: fixed(transport + extraTransport), other: fixed(other), hours, days, compensationMethod, monthlyGross: fixed(monthlyGross) });
  return {
    ...row,
    sourceChecksum,
    compensationMethod,
    monthlyGross: fixed(monthlyGross),
    foodAllowance: fixed(food),
    housingAllowance: fixed(housing),
    transportAllowance: fixed(transport + extraTransport),
    otherAllowance: fixed(other),
    scheduledHoursPerDay: hours,
    scheduledWorkDays: days,
  };
}

if (!Array.isArray(sourceEmployees) || sourceEmployees.length !== 20) throw new Error('The frozen Noorix source must contain exactly 20 employees.');
const live = sourceEmployees.filter((row) => ['active', 'on_leave'].includes(row.status));
const historical = sourceEmployees.filter((row) => ['terminated', 'archived'].includes(row.status));
if (live.length !== 15 || historical.length !== 5) throw new Error('The Noorix live/historical employee status boundary changed after review.');
const plan = live.map(profileFromSource);
const planChecksum = sha({ version: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, effectiveFrom: EFFECTIVE_FROM, profiles: plan.map((row) => [row.sourceId, row.sourceChecksum]) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { HrPayrollService } = await import('../apps/api/dist/hr/hr-payroll.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const payroll = app.get(HrPayrollService);
  const target = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
    if (!packageRow) throw new Error('The selected Noorix package is not the approved Al-Shami package.');
    const maps = await tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: plan.map((row) => row.sourceId) }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
    const employeeIdBySource = new Map();
    for (const map of maps) {
      if (!map.targetId || employeeIdBySource.has(map.sourceId)) throw new Error(`Noorix employee map ${map.sourceId} is missing or ambiguous.`);
      employeeIdBySource.set(map.sourceId, map.targetId);
    }
    if (employeeIdBySource.size !== plan.length) throw new Error('Every live Noorix employee must have exactly one Baseer employee map.');
    const employees = await tx.hrEmployee.findMany({ where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] }, status: { in: ['ACTIVE', 'ON_LEAVE'] } }, select: { id: true } });
    if (employees.length !== plan.length) throw new Error('A live Noorix employee map does not point to a live Al-Shami employee.');
    const existing = await tx.hrEmployeeCompensationProfile.findMany({ where: { tenantId, companyId, employeeId: { in: [...employeeIdBySource.values()] }, effectiveFrom: new Date(`${EFFECTIVE_FROM}T00:00:00.000Z`) }, select: { employeeId: true, monthlyGross: true, compensationMethod: true, foodAllowance: true, housingAllowance: true, transportAllowance: true, otherAllowance: true, scheduledHoursPerDay: true, scheduledWorkDays: true } });
    return { employeeIdBySource, existing };
  });
  const dry = { status: 'PARSED_DRY_RUN', version: VERSION, planChecksum, effectiveFrom: EFFECTIVE_FROM, sourceEmployees: sourceEmployees.length, liveProfilesPlanned: plan.length, inclusiveOvertimeProfiles: plan.filter((row) => row.compensationMethod === 'INCLUSIVE_OVERTIME').length, fixedMonthlyProfiles: plan.filter((row) => row.compensationMethod === 'FIXED_MONTHLY').length, historicalEmployeesEvidenceOnly: historical.length, financialWrites: 0 };
  console.log(JSON.stringify(dry, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const context = { tenantId, companyId, actorUserId };
    const receipts = [];
    for (const row of plan) {
      const employeeId = target.employeeIdBySource.get(row.sourceId);
      const existing = target.existing.find((candidate) => candidate.employeeId === employeeId);
      const expected = [row.monthlyGross, row.compensationMethod, row.foodAllowance, row.housingAllowance, row.transportAllowance, row.otherAllowance, row.scheduledHoursPerDay, row.scheduledWorkDays];
      if (existing) {
        const actual = [fixed(existing.monthlyGross), existing.compensationMethod, fixed(existing.foodAllowance), fixed(existing.housingAllowance), fixed(existing.transportAllowance), fixed(existing.otherAllowance), existing.scheduledHoursPerDay, existing.scheduledWorkDays];
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Existing compensation for ${row.employeeNumber} differs from the immutable Noorix snapshot.`);
        receipts.push({ employeeNumber: row.employeeNumber, replayed: true });
        continue;
      }
      const receipt = await payroll.setCompensation(context, {
        employeeId,
        effectiveFrom: new Date(`${EFFECTIVE_FROM}T00:00:00.000Z`),
        monthlyGross: row.monthlyGross,
        compensationMethod: row.compensationMethod,
        foodAllowance: row.foodAllowance,
        housingAllowance: row.housingAllowance,
        transportAllowance: row.transportAllowance,
        otherAllowance: row.otherAllowance,
        scheduledHoursPerDay: row.scheduledHoursPerDay,
        ...(row.scheduledWorkDays ? { scheduledWorkDays: row.scheduledWorkDays } : {}),
        notes: `ترحيل إعداد تعويض حالي من نوركس؛ المصدر=${row.sourceId}; checksum=${row.sourceChecksum.slice(0, 16)}; ساعات/أيام الدوام محفوظة من المصدر. لا يوجد بند إضافي تاريخي مستقل في نوركس.`,
      }, `nurix-al-shami-compensation:${row.sourceId}:${row.sourceChecksum}`);
      receipts.push({ employeeNumber: row.employeeNumber, compensationId: receipt.id, replayed: receipt.replayed });
    }
    await database.inTenantTransaction(tenantId, async (tx) => {
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.compensation_backfill.completed', entityType: 'HrEmployeeCompensationProfile', entityId: packageId, requestId: `nurix-al-shami-compensation:${planChecksum}`, afterJson: { version: VERSION, planChecksum, effectiveFrom: EFFECTIVE_FROM, profiles: receipts.length, inclusiveOvertimeProfiles: plan.filter((row) => row.compensationMethod === 'INCLUSIVE_OVERTIME').length, fixedMonthlyProfiles: plan.filter((row) => row.compensationMethod === 'FIXED_MONTHLY').length, historicalEmployeesEvidenceOnly: historical.length } } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dry, profiles: receipts.length, replayed: receipts.filter((row) => row.replayed).length, created: receipts.filter((row) => !row.replayed).length }, null, 2));
  }
} finally {
  await app.close();
}
