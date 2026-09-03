import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from './api-workspace-dependencies.mjs';
import pg from 'pg';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment('DATABASE_URL') });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const now = new Date();
const checkInAt = new Date(now.valueOf() - 2 * 60 * 60 * 1_000);
const validCheckOutAt = new Date(now.valueOf() - 60 * 60 * 1_000);
// Acceptance evidence is kept safely in the past. These UTC instants are
// Riyadh 20:00 and 04:00, so the policy session crosses local midnight.
const policyWeekStart = mondayAtOrBefore(new Date(now.valueOf() - 21 * 24 * 60 * 60 * 1_000));
const policyEffectiveDate = ymd(policyWeekStart);
const policyOvernightCheckoutDate = ymd(addDays(policyWeekStart, 1));
const policyRestDate = ymd(addDays(policyWeekStart, 6));
const policyOverrideDate = ymd(addDays(policyWeekStart, 7));
const policyCheckInAt = new Date(`${policyEffectiveDate}T17:00:00.000Z`);
const policyCheckOutAt = new Date(`${policyOvernightCheckoutDate}T01:00:00.000Z`);
const fixture = {
  tenantId: randomUUID(), companyId: randomUUID(), ownerUserId: randomUUID(), managerUserId: randomUUID(),
  employeeId: randomUUID(), branchId: randomUUID(), sessionId: randomUUID(), tenantCode: `attendance-http-${suffix}`,
  policyEmployeeId: randomUUID(), policySessionId: randomUUID(),
  businessDate: now.toISOString().slice(0, 10), burstEmployees: Array.from({ length: 12 }, (_, index) => ({ id: randomUUID(), pin: String(1_000 + index) })),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = fixture.tenantCode;
  const [{ AppModule }, { AuthService }, { ApiExceptionFilter }, { AttendanceLocationRetentionSchedulerService }] = await Promise.all([
    import('../apps/api/dist/app.module.js'), import('../apps/api/dist/identity/auth.service.js'), import('../apps/api/dist/common/api-exception.filter.js'), import('../apps/api/dist/attendance/attendance-location-retention-scheduler.service.js'),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: ['error'] });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  const auth = app.get(AuthService);
  const [ownerSession, managerSession] = await Promise.all([
    auth.signIn({ login: `attendance-owner-${suffix}@baseer.test`, password: `Owner-${suffix}`, requestId: randomUUID() }),
    auth.signIn({ login: `attendance-manager-${suffix}@baseer.test`, password: `Manager-${suffix}`, requestId: randomUUID() }),
  ]);
  let server = app.getHttpAdapter().getInstance();
  const ownerHeaders = { authorization: `Bearer ${ownerSession.accessToken}`, 'x-baseer-company-id': fixture.companyId };
  const managerHeaders = { authorization: `Bearer ${managerSession.accessToken}`, 'x-baseer-company-id': fixture.companyId };

  const twelveHourTemplate = await server.inject({ method: 'POST', url: '/v1/attendance/schedule-templates', headers: ownerHeaders, payload: {
    nameAr: 'ورديات 12 ساعة لاختبار القبول', effectiveFrom: policyEffectiveDate,
    periods: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '20:00', endTime: '08:00' })), idempotencyKey: randomUUID(),
  } });
  assert.equal(twelveHourTemplate.statusCode, 201, twelveHourTemplate.body);
  const scheduleSetup = await server.inject({ method: 'POST', url: '/v1/attendance/employees/schedule-setup', headers: ownerHeaders, payload: {
    employeeId: fixture.policyEmployeeId, templateId: twelveHourTemplate.json().template.id, effectiveFrom: policyEffectiveDate,
    weeklyAdjustment: { dayOfWeek: 7, kind: 'FULL_REST', periods: [] }, idempotencyKey: randomUUID(),
  } });
  assert.equal(scheduleSetup.statusCode, 201, scheduleSetup.body);
  const initialEffectiveSchedule = await server.inject({ method: 'GET', url: `/v1/attendance/employees/${fixture.policyEmployeeId}/schedule/effective?date=${policyEffectiveDate}`, headers: ownerHeaders });
  assert.equal(initialEffectiveSchedule.statusCode, 200, initialEffectiveSchedule.body);
  assert.equal(initialEffectiveSchedule.json().source, 'TEMPLATE', 'The first attendance schedule must import the employee-file work-hours baseline.');
  assert.deepEqual(initialEffectiveSchedule.json().periods.map((period) => period.minutes), [720], 'A 12-hour employee-file agreement must seed a 12-hour ordinary schedule.');

  const requestedOverride = await server.inject({ method: 'POST', url: '/v1/attendance/schedule-exceptions', headers: ownerHeaders, payload: {
    employeeId: fixture.policyEmployeeId, businessDate: policyOverrideDate, kind: 'CUSTOM_PERIODS', periods: [{ startTime: '08:00', endTime: '14:00' }], reason: 'اختبار تعديل تشغيلي مؤرخ', idempotencyKey: randomUUID(),
  } });
  assert.equal(requestedOverride.statusCode, 201, requestedOverride.body);
  const approvedOverride = await server.inject({ method: 'POST', url: '/v1/attendance/schedule-exceptions/decide', headers: ownerHeaders, payload: {
    exceptionId: requestedOverride.json().exception.id, decision: 'APPROVE', decisionNote: 'اعتماد اختبار القبول', idempotencyKey: randomUUID(),
  } });
  assert.equal(approvedOverride.statusCode, 201, approvedOverride.body);
  const operationalEffectiveSchedule = await server.inject({ method: 'GET', url: `/v1/attendance/employees/${fixture.policyEmployeeId}/schedule/effective?date=${policyOverrideDate}`, headers: ownerHeaders });
  assert.equal(operationalEffectiveSchedule.statusCode, 200, operationalEffectiveSchedule.body);
  assert.equal(operationalEffectiveSchedule.json().source, 'EXCEPTION', 'A dated attendance adjustment must override the operational schedule.');
  assert.deepEqual(operationalEffectiveSchedule.json().periods.map((period) => period.minutes), [360], 'The dated operational adjustment may shorten the scheduled day.');
  const employeeSchedule = await server.inject({ method: 'GET', url: `/v1/attendance/employees/${fixture.policyEmployeeId}/schedule`, headers: ownerHeaders });
  assert.equal(employeeSchedule.statusCode, 200, employeeSchedule.body);
  assert.equal(employeeSchedule.json().workTermsReference?.workMinutesPerDay, 720, 'A dated attendance adjustment must not rewrite the employee-file 12-hour agreement.');

  const scheduleWorkspace = await server.inject({ method: 'GET', url: `/v1/attendance/schedule-workspace?date=${fixture.businessDate}`, headers: ownerHeaders });
  assert.equal(scheduleWorkspace.statusCode, 200, scheduleWorkspace.body);
  assert.equal(scheduleWorkspace.json().coverage.date, fixture.businessDate, 'Schedule workspace must preserve the selected business date.');
  assert.equal(scheduleWorkspace.json().employeeSchedules.schedules.some((schedule) => schedule.employeeId === fixture.employeeId), true, 'One bounded schedule receipt must include the active employee page.');
  await expectError(
    server.inject({ method: 'GET', url: `/v1/attendance/schedule-workspace?date=${fixture.businessDate}`, headers: managerHeaders }), 403, 'AUTHORIZATION_DENIED',
    'A company manager must not read owner-only attendance schedules.',
  );

  const managerOpen = await server.inject({ method: 'GET', url: '/v1/attendance/sessions/open?pageSize=30', headers: managerHeaders });
  assert.equal(managerOpen.statusCode, 200, managerOpen.body);
  assert.equal(managerOpen.json().sessions.find((session) => session.sessionId === fixture.sessionId)?.employeeId, fixture.employeeId, 'Manager must see only the narrow open-session queue.');

  await expectError(
    server.inject({ method: 'GET', url: '/v1/attendance/company-settings', headers: managerHeaders }), 403, 'AUTHORIZATION_DENIED',
    'A company manager must not read owner-only attendance settings.',
  );

  const futurePayload = { employeeId: fixture.employeeId, businessDate: fixture.businessDate, checkOutAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(), reason: 'Future time must fail', idempotencyKey: randomUUID() };
  await expectError(server.inject({ method: 'POST', url: '/v1/attendance/sessions/close', headers: managerHeaders, payload: futurePayload }), 400, 'VALIDATION_FAILED', 'Manager checkout must reject a future time.');
  const beforeCheckInPayload = { ...futurePayload, checkOutAt: new Date(checkInAt.valueOf() - 60_000).toISOString(), reason: 'Before check-in must fail', idempotencyKey: randomUUID() };
  await expectError(server.inject({ method: 'POST', url: '/v1/attendance/sessions/close', headers: managerHeaders, payload: beforeCheckInPayload }), 400, 'VALIDATION_FAILED', 'Manager checkout must be after check-in.');

  const closePayload = { employeeId: fixture.employeeId, businessDate: fixture.businessDate, checkOutAt: validCheckOutAt.toISOString(), reason: 'Verified manager administrative close', idempotencyKey: randomUUID() };
  const closed = await server.inject({ method: 'POST', url: '/v1/attendance/sessions/close', headers: managerHeaders, payload: closePayload });
  assert.equal(closed.statusCode, 201, closed.body);
  assert.equal(closed.json().replayed, false);
  assert.equal(closed.json().checkOutAt, validCheckOutAt.toISOString());
  const replayedClose = await server.inject({ method: 'POST', url: '/v1/attendance/sessions/close', headers: managerHeaders, payload: closePayload });
  assert.equal(replayedClose.statusCode, 201, replayedClose.body);
  assert.equal(replayedClose.json().replayed, true, 'Administrative close must replay idempotently.');

  const overnightClose = await server.inject({ method: 'POST', url: '/v1/attendance/sessions/close', headers: managerHeaders, payload: {
    employeeId: fixture.policyEmployeeId, businessDate: policyEffectiveDate, checkOutAt: policyCheckOutAt.toISOString(), reason: 'اختبار جلسة تتجاوز منتصف الليل', idempotencyKey: randomUUID(),
  } });
  assert.equal(overnightClose.statusCode, 201, overnightClose.body);
  assert.equal(overnightClose.json().businessDate, policyEffectiveDate, 'A checkout after midnight must retain the check-in business date.');
  const overnightReport = await server.inject({ method: 'GET', url: `/v1/attendance/report?from=${policyEffectiveDate}&to=${policyEffectiveDate}&employeeId=${fixture.policyEmployeeId}`, headers: ownerHeaders });
  assert.equal(overnightReport.statusCode, 200, overnightReport.body);
  assert.equal(overnightReport.json().summary.sessions, 1, 'The cross-midnight session must be reported once on its check-in date.');
  assert.equal(overnightReport.json().summary.workedMinutes, 480, 'The cross-midnight session must retain all eight worked hours on its check-in date.');
  const followingDateReport = await server.inject({ method: 'GET', url: `/v1/attendance/report?from=${policyOvernightCheckoutDate}&to=${policyOvernightCheckoutDate}&employeeId=${fixture.policyEmployeeId}`, headers: ownerHeaders });
  assert.equal(followingDateReport.statusCode, 200, followingDateReport.body);
  assert.equal(followingDateReport.json().summary.sessions, 0, 'The after-midnight checkout must not create a second-day attendance session.');

  const restEffectiveSchedule = await server.inject({ method: 'GET', url: `/v1/attendance/employees/${fixture.policyEmployeeId}/schedule/effective?date=${policyRestDate}`, headers: ownerHeaders });
  assert.equal(restEffectiveSchedule.statusCode, 200, restEffectiveSchedule.body);
  assert.equal(restEffectiveSchedule.json().source, 'WEEKLY_ADJUSTMENT');
  assert.equal(restEffectiveSchedule.json().kind, 'FULL_REST');
  assert.deepEqual(restEffectiveSchedule.json().periods, [], 'The employee weekly full-rest rule must remove planned periods.');
  const restReport = await server.inject({ method: 'GET', url: `/v1/attendance/report?from=${policyRestDate}&to=${policyRestDate}&employeeId=${fixture.policyEmployeeId}`, headers: ownerHeaders });
  assert.equal(restReport.statusCode, 200, restReport.body);
  assert.equal(restReport.json().summary.plannedMinutes, 0, 'A weekly full-rest day must not generate planned minutes.');
  assert.equal(restReport.json().summary.shortageMinutes, 0, 'A weekly full-rest day must not generate a shortage.');

  const initialSettings = await server.inject({ method: 'GET', url: '/v1/attendance/company-settings', headers: ownerHeaders });
  assert.equal(initialSettings.statusCode, 200, initialSettings.body);
  assert.deepEqual(initialSettings.json(), { locationEnabled: false, locationRetentionDays: 14 });
  const enableSettings = { locationEnabled: true, idempotencyKey: randomUUID() };
  const enabled = await server.inject({ method: 'POST', url: '/v1/attendance/company-settings', headers: ownerHeaders, payload: enableSettings });
  assert.equal(enabled.statusCode, 200, enabled.body);
  assert.deepEqual(enabled.json(), { locationEnabled: true, locationRetentionDays: 14 });
  const replayedSettings = await server.inject({ method: 'POST', url: '/v1/attendance/company-settings', headers: ownerHeaders, payload: enableSettings });
  assert.equal(replayedSettings.statusCode, 200, replayedSettings.body);
  assert.deepEqual(replayedSettings.json(), enabled.json(), 'Company settings must replay the original response.');
  const settingsAuditCount = await scalar('SELECT count(*)::int AS count FROM "AuditEvent" WHERE "tenantId" = $1::uuid AND "action" = $2', [fixture.tenantId, 'attendance.company_settings.location_updated']);
  assert.equal(settingsAuditCount, 1, 'Idempotent company-settings replay must not create a second audit action.');
  const disabled = await server.inject({ method: 'POST', url: '/v1/attendance/company-settings', headers: ownerHeaders, payload: { locationEnabled: false, idempotencyKey: randomUUID() } });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().locationEnabled, false);

  const burst = await Promise.all(fixture.burstEmployees.map((employee, index) => server.inject({
    method: 'POST', url: '/v1/attendance/record',
    payload: { tenantId: fixture.tenantId, companyId: fixture.companyId, branchId: fixture.branchId, qrToken: attendanceQrToken(), pin: employee.pin, idempotencyKey: `attendance-burst-${suffix}-${index}` },
  })));
  for (const response of burst) {
    assert.notEqual(response.statusCode, 429, `Twelve valid attendance records in one minute must not be throttled: ${response.body}`);
    assert.equal(response.statusCode, 201, response.body);
  }
  const locationDisabledCount = await scalar('SELECT count(*)::int AS count FROM "AttendanceEvent" WHERE "tenantId" = $1::uuid AND "requestKey" LIKE $2 AND "latitude" IS NULL AND "longitude" IS NULL AND "accuracyMeters" IS NULL', [fixture.tenantId, `attendance-burst-${suffix}-%`]);
  assert.equal(locationDisabledCount, 12, 'Location must not be retained while the company setting is disabled.');

  // A fresh in-memory throttle store isolates this location path from the
  // deliberate 12-operation burst above; the database fixture remains the
  // same isolated tenant.
  await app.close();
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: ['error'] });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  server = app.getHttpAdapter().getInstance();
  const enabledForEvidence = await server.inject({ method: 'POST', url: '/v1/attendance/company-settings', headers: ownerHeaders, payload: { locationEnabled: true, idempotencyKey: randomUUID() } });
  assert.equal(enabledForEvidence.statusCode, 200, enabledForEvidence.body);
  const locationEmployee = fixture.burstEmployees[0];
  const locationRequired = await server.inject({ method: 'POST', url: '/v1/attendance/record', payload: { tenantId: fixture.tenantId, companyId: fixture.companyId, branchId: fixture.branchId, qrToken: attendanceQrToken(), pin: locationEmployee.pin, idempotencyKey: randomUUID() } });
  assert.equal(locationRequired.statusCode, 400, 'Location must be required only after the owner enables it.');
  const locationRequestKey = randomUUID();
  const locationRecorded = await server.inject({ method: 'POST', url: '/v1/attendance/record', payload: { tenantId: fixture.tenantId, companyId: fixture.companyId, branchId: fixture.branchId, qrToken: attendanceQrToken(), pin: locationEmployee.pin, latitude: 24.7136, longitude: 46.6753, accuracyMeters: 5, idempotencyKey: locationRequestKey } });
  assert.equal(locationRecorded.statusCode, 201, locationRecorded.body);
  const locationStoredCount = await scalar('SELECT count(*)::int AS count FROM "AttendanceEvent" WHERE "tenantId" = $1::uuid AND "requestKey" = $2 AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "accuracyMeters" IS NOT NULL', [fixture.tenantId, locationRequestKey]);
  assert.equal(locationStoredCount, 1, 'Enabled location evidence must be stored for the attendance event.');
  const retentionEventId = randomUUID();
  const retentionRequestKey = randomUUID();
  await execute('INSERT INTO "AttendanceEvent" ("id", "tenantId", "companyId", "branchId", "employeeId", "sessionId", "eventType", "businessDate", "occurredAt", "latitude", "longitude", "accuracyMeters", "qrTokenHash", "requestKey") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::"AttendanceEventType", $8::date, CURRENT_TIMESTAMP - INTERVAL \'15 days\', 24.7136, 46.6753, 5, $9, $10)', [retentionEventId, fixture.tenantId, fixture.companyId, fixture.branchId, locationEmployee.id, locationRecorded.json().sessionId, 'CHECK_IN', fixture.businessDate, 'a'.repeat(64), retentionRequestKey]);
  const retention = await app.get(AttendanceLocationRetentionSchedulerService).runScheduledRetention(new Date());
  assert.equal(retention.status, 'COMPLETED', 'The retention scheduler must obtain its durable lock and complete.');
  const locationRedactedCount = await scalar('SELECT count(*)::int AS count FROM "AttendanceEvent" WHERE "tenantId" = $1::uuid AND "id" = $2::uuid AND "requestKey" = $3 AND "latitude" IS NULL AND "longitude" IS NULL AND "accuracyMeters" IS NULL', [fixture.tenantId, retentionEventId, retentionRequestKey]);
  assert.equal(locationRedactedCount, 1, 'Coordinates older than 14 days must be redacted while preserving the event.');
  await expectDatabaseRejection(execute('UPDATE "AttendanceEvent" SET "requestKey" = $3 WHERE "tenantId" = $1::uuid AND "id" = $2::uuid', [fixture.tenantId, retentionEventId, randomUUID()]), 'AttendanceEvent rows are immutable');

  console.log('Attendance HTTP verification passed: employee-file schedule baseline and dated adjustment, cross-midnight business-date ownership, weekly full-rest evaluation, bounded schedule workspace receipt, owner/manager boundaries, open-session queue, chosen administrative checkout, location-off/on retention, settings idempotency, and a 12-record attendance burst.');
} finally {
  if (app) await app.close();
  await pool.end();
}

async function seedFixture() {
  const managerRoleId = randomUUID();
  const [ownerPasswordHash, managerPasswordHash] = await Promise.all([bcrypt.hash(`Owner-${suffix}`, 12), bcrypt.hash(`Manager-${suffix}`, 12)]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, 'Attendance HTTP verification']);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6), ($7::uuid, $2::uuid, $8, $9, $10, $11)', [fixture.ownerUserId, fixture.tenantId, `attendance-owner-${suffix}@baseer.test`, 'مالك فحص الحضور', 'Attendance owner', ownerPasswordHash, fixture.managerUserId, `attendance-manager-${suffix}@baseer.test`, 'مدير فحص الحضور', 'Attendance manager', managerPasswordHash]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [fixture.companyId, fixture.tenantId, 'شركة فحص الحضور', 'Attendance verification company']);
    await client.query('INSERT INTO "TenantAdministrationAssignment" ("tenantId", "userId", "isOwner") VALUES ($1::uuid, $2::uuid, true)', [fixture.tenantId, fixture.ownerUserId]);
    await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn", "isSystem") VALUES ($1::uuid, $2::uuid, $3, $4, $5, true)', [managerRoleId, fixture.tenantId, 'BASEER_COMPANY_MANAGER', 'مدير الشركة', 'Company manager']);
    await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [fixture.tenantId, fixture.managerUserId, fixture.companyId, managerRoleId]);
    await client.query('INSERT INTO "AttendanceBranch" ("id", "tenantId", "companyId", "nameAr", "latitude", "longitude", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 24.7136, 46.6753, CURRENT_TIMESTAMP)', [fixture.branchId, fixture.tenantId, fixture.companyId, 'فرع الفحص']);
    await client.query('INSERT INTO "HrEmployee" ("id", "tenantId", "companyId", "employeeNumber", "nameAr", "hireDate", "status", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7, CURRENT_TIMESTAMP)', [fixture.employeeId, fixture.tenantId, fixture.companyId, 'ATT-HTTP-001', 'موظف جلسة مفتوحة', fixture.businessDate, 'ACTIVE']);
    await client.query('INSERT INTO "AttendanceWorkSession" ("id", "tenantId", "companyId", "branchId", "employeeId", "businessDate", "checkInAt", "status", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::date, $7::timestamptz, $8, CURRENT_TIMESTAMP)', [fixture.sessionId, fixture.tenantId, fixture.companyId, fixture.branchId, fixture.employeeId, fixture.businessDate, checkInAt.toISOString(), 'OPEN']);
    await client.query('INSERT INTO "HrEmployee" ("id", "tenantId", "companyId", "employeeNumber", "nameAr", "hireDate", "status", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7, CURRENT_TIMESTAMP)', [fixture.policyEmployeeId, fixture.tenantId, fixture.companyId, 'ATT-POL-001', 'موظف سياسة الحضور', policyEffectiveDate, 'ACTIVE']);
    await client.query('INSERT INTO "HrEmployeeWorkTerms" ("id", "tenantId", "companyId", "employeeId", "effectiveFrom", "workMinutesPerDay", "createdByUserId", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, 720, $6::uuid, CURRENT_TIMESTAMP)', [randomUUID(), fixture.tenantId, fixture.companyId, fixture.policyEmployeeId, policyEffectiveDate, fixture.ownerUserId]);
    await client.query('INSERT INTO "AttendanceWorkSession" ("id", "tenantId", "companyId", "branchId", "employeeId", "businessDate", "checkInAt", "status", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::date, $7::timestamptz, $8, CURRENT_TIMESTAMP)', [fixture.policySessionId, fixture.tenantId, fixture.companyId, fixture.branchId, fixture.policyEmployeeId, policyEffectiveDate, policyCheckInAt.toISOString(), 'OPEN']);
    for (let index = 0; index < fixture.burstEmployees.length; index += 1) {
      const employee = fixture.burstEmployees[index];
      const pinHash = await bcrypt.hash(employee.pin, 12);
      await client.query('INSERT INTO "HrEmployee" ("id", "tenantId", "companyId", "employeeNumber", "nameAr", "hireDate", "status", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7, CURRENT_TIMESTAMP)', [employee.id, fixture.tenantId, fixture.companyId, `ATT-BURST-${String(index + 1).padStart(2, '0')}`, `موظف ذروة ${index + 1}`, fixture.businessDate, 'ACTIVE']);
      await client.query('INSERT INTO "AttendanceEmployeeCredential" ("id", "tenantId", "companyId", "employeeId", "pinHash", "pinLookupHash", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, CURRENT_TIMESTAMP)', [randomUUID(), fixture.tenantId, fixture.companyId, employee.id, pinHash, pinLookup(employee.pin)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function attendanceQrToken() {
  const body = Buffer.from(JSON.stringify({ companyId: fixture.companyId, branchId: fixture.branchId, expiresAt: Math.floor(Date.now() / 1_000) + 300, nonce: randomUUID() })).toString('base64url');
  return `${body}.${createHmac('sha256', requiredEnvironment('ATTENDANCE_QR_SECRET')).update(body).digest('base64url')}`;
}

function pinLookup(pin) { return createHmac('sha256', requiredEnvironment('ATTENDANCE_PIN_PEPPER')).update(`${fixture.companyId}:${pin}`).digest('hex'); }
async function scalar(query, values) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    const result = await client.query(query, values);
    await client.query('COMMIT');
    return result.rows[0]?.count;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function execute(query, values) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query(query, values);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function expectError(responsePromise, expectedStatus, expectedCode, message) {
  const response = await responsePromise;
  assert.equal(response.statusCode, expectedStatus, `${message} ${response.body}`);
  assert.equal(response.json().error?.code, expectedCode, `${message} ${response.body}`);
}
async function expectDatabaseRejection(promise, expectedMessage) {
  try {
    await promise;
    assert.fail(`Expected database rejection containing: ${expectedMessage}`);
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), new RegExp(expectedMessage));
  }
}
function addDays(value, days) { const result = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); result.setUTCDate(result.getUTCDate() + days); return result; }
function mondayAtOrBefore(value) { const result = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7)); return result; }
function ymd(value) { return value.toISOString().slice(0, 10); }
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
