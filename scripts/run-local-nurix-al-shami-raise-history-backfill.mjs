/**
 * Imports only Noorix salary-raise history as effective-dated Baseer
 * compensation profiles.  It does not create a promotion: Noorix movements
 * do not include a reliable job-title change.
 *
 * Historical profile terms other than the total salary are copied from the
 * next already-approved Baseer profile for the same employee. Noorix's raise
 * rows contain only previous/new total salary, so this is explicit lineage,
 * not a reconstruction of an unsupported historical allowance split.
 *
 * Usage:
 *   node scripts/run-local-nurix-al-shami-raise-history-backfill.mjs \
 *     <package-id> <tenant-id> <company-id> <owner-user-id> \
 *     DRY_RUN|APPLY_APPROVED_NOORIX_AL_SHAMI_RAISE_HISTORY_V1
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-raise-history/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_RAISE_HISTORY_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);
const day = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
const ymd = (value) => value.toISOString().slice(0, 10);
const previousDay = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - 1));

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-raise-history-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const sourceSql = `
SELECT COALESCE(json_agg(json_build_object(
  'sourceId', m.id,
  'employeeSourceId', m.employee_id,
  'movementType', m.movement_type,
  'amount', m.amount::text,
  'previousValue', m.previous_value,
  'newValue', m.new_value,
  'effectiveDate', m.effective_date::date,
  'notes', m.notes,
  'createdAt', m.created_at
) ORDER BY m.effective_date, m.id), '[]'::json)::text AS payload
FROM employee_movements m
WHERE m.company_id='${SOURCE_COMPANY_ID}' AND m.movement_type='raise';`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix employee-movement source was returned.');
const sourceRows = JSON.parse(raw);

function amount(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive Noorix raise amount for ${label}.`);
  return parsed;
}

function salary(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid Noorix salary value for ${label}.`);
  return parsed;
}

if (!Array.isArray(sourceRows) || sourceRows.length !== 7) throw new Error('The frozen Noorix source must contain exactly seven raise movements.');
const sourceIds = new Set();
const profileStarts = new Set();
const plan = sourceRows.map((row) => {
  if (!row?.sourceId || !row.employeeSourceId || row.movementType !== 'raise' || sourceIds.has(row.sourceId)) throw new Error('Noorix raise source IDs must be unique and complete.');
  sourceIds.add(row.sourceId);
  const effectiveFrom = day(row.effectiveDate);
  if (ymd(effectiveFrom).slice(8, 10) !== '01') throw new Error(`Raise ${row.sourceId} is not effective on the first day of a month.`);
  const previous = salary(row.previousValue, `${row.sourceId}.previousValue`);
  const next = salary(row.newValue, `${row.sourceId}.newValue`);
  const delta = amount(row.amount, `${row.sourceId}.amount`);
  if (Math.abs((next - previous) - delta) > 0.0001) throw new Error(`Raise ${row.sourceId} does not reconcile previous/new salary with its amount.`);
  const employeeDateKey = `${row.employeeSourceId}:${ymd(effectiveFrom)}`;
  if (profileStarts.has(employeeDateKey)) throw new Error(`Noorix has multiple raises for the same employee and effective month: ${employeeDateKey}.`);
  profileStarts.add(employeeDateKey);
  const sourceChecksum = sha({ sourceId: row.sourceId, employeeSourceId: row.employeeSourceId, movementType: row.movementType, amount: fixed(delta), previousValue: fixed(previous), newValue: fixed(next), effectiveDate: ymd(effectiveFrom), notes: row.notes ?? null, createdAt: row.createdAt });
  return { ...row, effectiveFrom, previous: fixed(previous), next: fixed(next), delta: fixed(delta), notes: row.notes ?? null, sourceChecksum };
});
const planChecksum = sha({ version: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, rows: plan.map((row) => [row.sourceId, row.sourceChecksum]) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

try {
  const database = app.get(DatabaseService);
  const prepared = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({
      where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' },
      select: { id: true },
    });
    if (!packageRow) throw new Error('The selected package is not the approved Al-Shami Noorix package.');

    const employeeMaps = await tx.nurixExcelMasterDataItem.findMany({
      where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: plan.map((row) => row.employeeSourceId) }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } },
      select: { sourceId: true, targetId: true },
    });
    const employeeIdBySource = new Map();
    for (const map of employeeMaps) {
      if (!map.targetId || employeeIdBySource.has(map.sourceId)) throw new Error(`Noorix employee map ${map.sourceId} is missing or ambiguous.`);
      employeeIdBySource.set(map.sourceId, map.targetId);
    }
    if (employeeIdBySource.size !== plan.length) throw new Error('Every raise must map to exactly one completed Baseer employee.');

    const employees = await tx.hrEmployee.findMany({
      where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] }, status: { in: ['ACTIVE', 'ON_LEAVE'] } },
      select: { id: true, employeeNumber: true },
    });
    if (employees.length !== plan.length) throw new Error('A raise maps to an employee not available for compensation history.');
    const employeeNumberById = new Map(employees.map((employee) => [employee.id, employee.employeeNumber]));

    const profiles = await tx.hrEmployeeCompensationProfile.findMany({
      where: { tenantId, companyId, employeeId: { in: [...employeeIdBySource.values()] } },
      orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }],
    });
    const profilesByEmployee = new Map();
    for (const profile of profiles) {
      const bucket = profilesByEmployee.get(profile.employeeId) ?? [];
      bucket.push(profile);
      profilesByEmployee.set(profile.employeeId, bucket);
    }

    return plan.map((row) => {
      const employeeId = employeeIdBySource.get(row.employeeSourceId);
      const employeeProfiles = profilesByEmployee.get(employeeId) ?? [];
      const exact = employeeProfiles.find((profile) => ymd(profile.effectiveFrom) === ymd(row.effectiveFrom));
      const successor = employeeProfiles.find((profile) => profile.effectiveFrom > row.effectiveFrom);
      if (exact) {
        const expectedNotes = row.notes || null;
        if (fixed(exact.monthlyGross) !== row.next || exact.notes !== expectedNotes) throw new Error(`Existing historical profile for raise ${row.sourceId} differs from Noorix source values.`);
        return { ...row, employeeId, employeeNumber: employeeNumberById.get(employeeId), replay: true, profileId: exact.id, effectiveTo: exact.effectiveTo };
      }
      if (!successor) throw new Error(`Raise ${row.sourceId} has no later approved Baseer compensation profile to bound its historical period.`);
      const effectiveTo = previousDay(successor.effectiveFrom);
      if (effectiveTo < row.effectiveFrom) throw new Error(`Raise ${row.sourceId} would create an empty historical compensation period.`);
      return { ...row, employeeId, employeeNumber: employeeNumberById.get(employeeId), replay: false, template: successor, effectiveTo };
    });
  });

  const dry = {
    status: 'PARSED_DRY_RUN', version: VERSION, planChecksum, sourceRaises: plan.length,
    historicalProfilesPlanned: prepared.filter((row) => !row.replay).length,
    alreadyApplied: prepared.filter((row) => row.replay).length,
    notesPreserved: plan.filter((row) => Boolean(row.notes)).length,
    financialWrites: 0,
  };
  console.log(JSON.stringify(dry, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const receipts = [];
    for (const row of prepared) await database.inTenantTransaction(tenantId, async (tx) => {
      if (row.replay) {
        if (row.notes) await tx.noorixSourceAnnotation.upsert({
          where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'EmployeeMovement', sourceId: row.sourceId, field: 'notes' } },
          create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'EmployeeMovement', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeCompensationProfile', targetId: row.profileId, field: 'notes', exactText: row.notes },
          update: { sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeCompensationProfile', targetId: row.profileId, exactText: row.notes },
        });
        receipts.push({ sourceId: row.sourceId, employeeNumber: row.employeeNumber, profileId: row.profileId, replayed: true });
        return;
      }
      const conflict = await tx.hrEmployeeCompensationProfile.findFirst({ where: { tenantId, companyId, employeeId: row.employeeId, effectiveFrom: row.effectiveFrom }, select: { id: true } });
      if (conflict) throw new Error(`Concurrent compensation history write detected for ${row.sourceId}.`);
      const profileId = randomUUID();
      await tx.hrEmployeeCompensationProfile.create({ data: {
        id: profileId, tenantId, companyId, employeeId: row.employeeId,
        policyVersionId: row.template.policyVersionId,
        effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo,
        monthlyGross: row.next,
        compensationMethod: row.template.compensationMethod,
        foodAllowance: row.template.foodAllowance,
        housingAllowance: row.template.housingAllowance,
        transportAllowance: row.template.transportAllowance,
        otherAllowance: row.template.otherAllowance,
        scheduledHoursPerDay: row.template.scheduledHoursPerDay,
        scheduledWorkDays: row.template.scheduledWorkDays,
        notes: row.notes,
        createdByUserId: actorUserId,
      } });
      if (row.notes) await tx.noorixSourceAnnotation.upsert({
        where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'EmployeeMovement', sourceId: row.sourceId, field: 'notes' } },
        create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'EmployeeMovement', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeCompensationProfile', targetId: profileId, field: 'notes', exactText: row.notes },
        update: { sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeCompensationProfile', targetId: profileId, exactText: row.notes },
      });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.raise_history_backfill.applied', entityType: 'HrEmployeeCompensationProfile', entityId: profileId, requestId: `nurix-al-shami-raise:${row.sourceId}:${row.sourceChecksum}`, afterJson: { version: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, employeeSourceId: row.employeeSourceId, effectiveFrom: ymd(row.effectiveFrom), effectiveTo: ymd(row.effectiveTo), previousSalary: row.previous, newSalary: row.next, raiseAmount: row.delta, notesPreserved: Boolean(row.notes), termsCopiedFromProfileId: row.template.id } } });
      receipts.push({ sourceId: row.sourceId, employeeNumber: row.employeeNumber, profileId, replayed: false });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dry, created: receipts.filter((receipt) => !receipt.replayed).length, replayed: receipts.filter((receipt) => receipt.replayed).length, receipts }, null, 2));
  }
} finally {
  await app.close();
}
