/**
 * Reconciles the future-dated compensation profiles created by the Noorix
 * master-data import with the final, explicit Noorix salary-raise evidence.
 *
 * The master import derived a few fractional riyal values from work terms
 * (for example 1700.0152).  Those rows were not independent Noorix salary
 * changes and must not appear as new raises in an employee file.  This writer
 * changes only the affected profile's monthly total and technical UI note; it
 * never writes payroll, journals, advances, or historical raise profiles.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const VERSION = 'nurix-al-shami-compensation-rounding-repair/v1';
const APPLY_TOKEN = 'APPLY_APPROVED_NOORIX_AL_SHAMI_COMPENSATION_ROUNDING_REPAIR_V1';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);
const date = (value, label) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error(`Invalid source date: ${label}.`);
  return new Date(`${value}T00:00:00.000Z`);
};

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPLY_TOKEN].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-compensation-rounding-repair.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPLY_TOKEN}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This repair only permits the canonical local Baseer test database.');

const sourceSql = `
SELECT COALESCE(json_agg(json_build_object(
  'sourceId', m.id,
  'employeeSourceId', m.employee_id,
  'effectiveDate', m.effective_date::date,
  'previousSalary', m.previous_value,
  'newSalary', m.new_value,
  'amount', m.amount
) ORDER BY m.effective_date, m.id), '[]'::json)::text
FROM employee_movements m
WHERE m.company_id='${SOURCE_COMPANY_ID}' AND m.movement_type='raise';`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
const sourceRaises = JSON.parse(raw || '[]').map((row) => ({
  sourceId: row.sourceId,
  employeeSourceId: row.employeeSourceId,
  effectiveDate: String(row.effectiveDate),
  previousSalary: fixed(row.previousSalary),
  newSalary: fixed(row.newSalary),
  amount: fixed(row.amount),
}));
if (sourceRaises.length !== 7 || new Set(sourceRaises.map((row) => row.sourceId)).size !== 7 || sourceRaises.some((row) => !row.sourceId || !row.employeeSourceId || Number(row.newSalary) <= 0 || Math.abs((Number(row.newSalary) - Number(row.previousSalary)) - Number(row.amount)) > 0.0001)) {
  throw new Error('The frozen Noorix raise evidence is incomplete or does not reconcile.');
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
    const sourceEmployeeIds = sourceRaises.map((row) => row.employeeSourceId);
    const employeeMaps = await tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: sourceEmployeeIds }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
    const targetEmployeeBySource = new Map(employeeMaps.map((row) => [row.sourceId, row.targetId]));
    if (targetEmployeeBySource.size !== sourceRaises.length || [...targetEmployeeBySource.values()].some((value) => !value)) throw new Error('Every Noorix raise must have exactly one completed Baseer employee map.');
    const profiles = await tx.hrEmployeeCompensationProfile.findMany({ where: { tenantId, companyId, employeeId: { in: [...targetEmployeeBySource.values()] } }, orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }] });
    const payrollAfterFutureProfiles = await tx.hrPayrollRun.count({ where: { tenantId, companyId, businessDate: { gte: new Date('2026-09-01T00:00:00.000Z') } } });
    if (payrollAfterFutureProfiles > 0) throw new Error('A later payroll exists; compensation history must not be reconciled automatically.');
    return sourceRaises.map((source) => {
      date(source.effectiveDate, `${source.sourceId}.effectiveDate`);
      const employeeId = targetEmployeeBySource.get(source.employeeSourceId);
      const employeeProfiles = profiles.filter((profile) => profile.employeeId === employeeId);
      const historical = employeeProfiles.find((profile) => profile.effectiveFrom.toISOString().slice(0, 10) === source.effectiveDate);
      if (!historical || fixed(historical.monthlyGross) !== source.newSalary) throw new Error(`The historical Baseer raise for ${source.sourceId} does not exactly match Noorix.`);
      const technicalRows = employeeProfiles.filter((profile) => profile.effectiveFrom > historical.effectiveFrom && profile.effectiveTo === null && (
        (profile.notes?.includes(`المصدر=${source.employeeSourceId}`) && profile.notes.includes('لا يوجد بند إضافي تاريخي مستقل في نوركس'))
        || (profile.effectiveFrom.toISOString().slice(0, 10) === '2026-09-01' && fixed(profile.monthlyGross) === source.newSalary && profile.notes === null)
      ));
      if (technicalRows.length !== 1) throw new Error(`Expected exactly one later technical compensation profile for ${source.sourceId}.`);
      const technical = technicalRows[0];
      return { source, employeeId, historicalProfileId: historical.id, profileId: technical.id, effectiveFrom: technical.effectiveFrom.toISOString().slice(0, 10), beforeMonthlyGross: fixed(technical.monthlyGross), afterMonthlyGross: source.newSalary, beforeNotes: technical.notes, replay: fixed(technical.monthlyGross) === source.newSalary && technical.notes === null };
    });
  });

  const dry = {
    status: 'DRY_RUN_OK',
    transformVersion: VERSION,
    sourceRaises: sourceRaises.length,
    profilesToReconcile: prepared.filter((row) => !row.replay).length,
    alreadyReconciled: prepared.filter((row) => row.replay).length,
    financialWrites: 0,
    payrollWrites: 0,
    planChecksum,
    changes: prepared.map((row) => ({ employeeSourceId: row.source.employeeSourceId, sourceRaiseId: row.source.sourceId, effectiveFrom: row.effectiveFrom, beforeMonthlyGross: row.beforeMonthlyGross, afterMonthlyGross: row.afterMonthlyGross, clearsTechnicalNote: !row.replay })),
  };
  console.log(JSON.stringify(dry, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const receipts = [];
    for (const row of prepared) await database.inTenantTransaction(tenantId, async (tx) => {
      const profile = await tx.hrEmployeeCompensationProfile.findFirst({ where: { id: row.profileId, tenantId, companyId, employeeId: row.employeeId } });
      if (!profile) throw new Error(`Compensation profile ${row.profileId} disappeared before repair.`);
      if (fixed(profile.monthlyGross) === row.afterMonthlyGross && profile.notes === null) { receipts.push({ profileId: row.profileId, replayed: true }); return; }
      if (fixed(profile.monthlyGross) !== row.beforeMonthlyGross || profile.notes !== row.beforeNotes) throw new Error(`Compensation profile ${row.profileId} changed after the dry-run.`);
      await tx.hrEmployeeCompensationProfile.update({ where: { id: profile.id }, data: { monthlyGross: row.afterMonthlyGross, notes: null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.compensation_rounding_reconciled', entityType: 'HrEmployeeCompensationProfile', entityId: profile.id, requestId: `nr-comp-reconcile:${row.source.sourceId}`, beforeJson: { monthlyGross: row.beforeMonthlyGross, notes: row.beforeNotes }, afterJson: { transformVersion: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, sourceRaiseId: row.source.sourceId, sourceEmployeeId: row.source.employeeSourceId, sourceRaiseEffectiveDate: row.source.effectiveDate, sourceSalary: row.afterMonthlyGross, monthlyGross: row.afterMonthlyGross, notes: null, historicalRaiseProfileId: row.historicalProfileId, financialWrites: 0, payrollWrites: 0 } } });
      receipts.push({ profileId: profile.id, replayed: false });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dry, reconciled: receipts.filter((row) => !row.replayed).length, replayed: receipts.filter((row) => row.replayed).length }, null, 2));
  }
} finally {
  await app.close();
}
