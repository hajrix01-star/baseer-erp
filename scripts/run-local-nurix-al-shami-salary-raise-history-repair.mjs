/**
 * Completes the non-financial employee-file history for explicit Noorix raises.
 * Every Noorix raise carries a previous salary and an effective date.  Where
 * Baseer has only the post-raise profile, create the preceding profile from the
 * documented join date through the day before the raise.  Payroll and journals
 * are deliberately outside this writer.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const VERSION = 'nurix-al-shami-salary-raise-history-repair/v1';
const APPLY_TOKEN = 'APPLY_APPROVED_NOORIX_AL_SHAMI_SALARY_RAISE_HISTORY_REPAIR_V1';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);
const day = (value, label) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error(`Invalid source date: ${label}.`);
  return new Date(`${value}T00:00:00.000Z`);
};
const ymd = (value) => value.toISOString().slice(0, 10);
const previousDay = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - 1));

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPLY_TOKEN].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-salary-raise-history-repair.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPLY_TOKEN}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This repair only permits the canonical local Baseer test database.');

const sourceSql = `
SELECT COALESCE(json_agg(json_build_object(
  'sourceId', m.id,
  'employeeSourceId', m.employee_id,
  'joinDate', e.join_date::date,
  'effectiveDate', m.effective_date::date,
  'previousSalary', m.previous_value,
  'newSalary', m.new_value,
  'amount', m.amount
) ORDER BY e.employee_serial, m.effective_date), '[]'::json)::text
FROM employee_movements m
JOIN employees e ON e.id=m.employee_id AND e.company_id=m.company_id
WHERE m.company_id='${SOURCE_COMPANY_ID}' AND m.movement_type='raise';`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
const sourceRaises = JSON.parse(raw || '[]').map((row) => ({ sourceId: row.sourceId, employeeSourceId: row.employeeSourceId, joinDate: String(row.joinDate), effectiveDate: String(row.effectiveDate), previousSalary: fixed(row.previousSalary), newSalary: fixed(row.newSalary), amount: fixed(row.amount) }));
if (sourceRaises.length !== 7 || new Set(sourceRaises.map((row) => row.sourceId)).size !== 7 || sourceRaises.some((row) => Number(row.previousSalary) <= 0 || Number(row.newSalary) <= 0 || day(row.joinDate, 'joinDate') >= day(row.effectiveDate, 'effectiveDate') || Math.abs((Number(row.newSalary) - Number(row.previousSalary)) - Number(row.amount)) > 0.0001)) {
  throw new Error('The Noorix salary-raise history is incomplete or does not reconcile.');
}
const planChecksum = sha({ version: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, sourceRaises });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

try {
  const database = app.get(DatabaseService);
  const prepared = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID }, select: { id: true } });
    if (!packageRow) throw new Error('The selected package is not scoped to the approved Al-Shami Noorix source.');
    const maps = await tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: sourceRaises.map((row) => row.employeeSourceId) }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
    const employeeBySource = new Map(maps.map((row) => [row.sourceId, row.targetId]));
    if (employeeBySource.size !== sourceRaises.length || [...employeeBySource.values()].some((value) => !value)) throw new Error('Every Noorix raise must have exactly one Baseer employee map.');
    const profiles = await tx.hrEmployeeCompensationProfile.findMany({ where: { tenantId, companyId, employeeId: { in: [...employeeBySource.values()] } }, orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }] });
    const laterPayroll = await tx.hrPayrollRun.count({ where: { tenantId, companyId, businessDate: { gte: new Date('2026-09-01T00:00:00.000Z') } } });
    if (laterPayroll > 0) throw new Error('A later payroll exists; historical compensation cannot be added automatically.');
    return sourceRaises.map((source) => {
      const employeeId = employeeBySource.get(source.employeeSourceId);
      const employeeProfiles = profiles.filter((profile) => profile.employeeId === employeeId);
      const raiseProfile = employeeProfiles.find((profile) => ymd(profile.effectiveFrom) === source.effectiveDate);
      if (!raiseProfile || fixed(raiseProfile.monthlyGross) !== source.newSalary) throw new Error(`The imported raise ${source.sourceId} is not an exact match.`);
      const start = day(source.joinDate, `${source.sourceId}.joinDate`);
      const end = previousDay(day(source.effectiveDate, `${source.sourceId}.effectiveDate`));
      const exact = employeeProfiles.find((profile) => ymd(profile.effectiveFrom) === source.joinDate);
      if (exact && (fixed(exact.monthlyGross) !== source.previousSalary || ymd(exact.effectiveTo ?? new Date('1900-01-01T00:00:00.000Z')) !== ymd(end))) throw new Error(`Existing pre-raise profile for ${source.sourceId} differs from Noorix evidence.`);
      if (employeeProfiles.some((profile) => profile.effectiveFrom < raiseProfile.effectiveFrom && !exact)) throw new Error(`Unexpected earlier compensation history exists for ${source.sourceId}; manual review is required.`);
      return { source, employeeId, raiseProfile, start, end, replay: Boolean(exact) };
    });
  });
  const dry = { status: 'DRY_RUN_OK', transformVersion: VERSION, sourceRaises: sourceRaises.length, predecessorProfilesPlanned: prepared.filter((row) => !row.replay).length, alreadyApplied: prepared.filter((row) => row.replay).length, financialWrites: 0, payrollWrites: 0, planChecksum };
  console.log(JSON.stringify(dry, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const receipts = [];
    for (const row of prepared) await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.hrEmployeeCompensationProfile.findFirst({ where: { tenantId, companyId, employeeId: row.employeeId, effectiveFrom: row.start } });
      if (existing) { if (fixed(existing.monthlyGross) !== row.source.previousSalary || ymd(existing.effectiveTo ?? new Date('1900-01-01T00:00:00.000Z')) !== ymd(row.end)) throw new Error(`Predecessor profile changed for ${row.source.sourceId}.`); receipts.push({ sourceId: row.source.sourceId, replayed: true }); return; }
      const profileId = randomUUID();
      await tx.hrEmployeeCompensationProfile.create({ data: { id: profileId, tenantId, companyId, employeeId: row.employeeId, policyVersionId: row.raiseProfile.policyVersionId, effectiveFrom: row.start, effectiveTo: row.end, monthlyGross: row.source.previousSalary, compensationMethod: row.raiseProfile.compensationMethod, foodAllowance: row.raiseProfile.foodAllowance, housingAllowance: row.raiseProfile.housingAllowance, transportAllowance: row.raiseProfile.transportAllowance, otherAllowance: row.raiseProfile.otherAllowance, scheduledHoursPerDay: row.raiseProfile.scheduledHoursPerDay, scheduledWorkDays: row.raiseProfile.scheduledWorkDays, notes: null, createdByUserId: actorUserId } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.raise_predecessor_profile.created', entityType: 'HrEmployeeCompensationProfile', entityId: profileId, requestId: `nr-raise-before:${row.source.sourceId}`, afterJson: { transformVersion: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, sourceRaiseId: row.source.sourceId, sourceEmployeeId: row.source.employeeSourceId, effectiveFrom: ymd(row.start), effectiveTo: ymd(row.end), sourcePreviousSalary: row.source.previousSalary, sourceRaisedSalary: row.source.newSalary, financialWrites: 0, payrollWrites: 0 } } });
      receipts.push({ sourceId: row.source.sourceId, replayed: false });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dry, created: receipts.filter((row) => !row.replayed).length, replayed: receipts.filter((row) => row.replayed).length }, null, 2));
  }
} finally {
  await app.close();
}
