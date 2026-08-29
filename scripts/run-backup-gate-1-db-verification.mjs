import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: 'apps/api/.env.baseer-test', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the local backup verification database.');

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await verifyMigrationAndRls();
  await verifyTenantIsolationAndAuditImmutability();
  console.log('Backup Gate 1 database verification passed: migration, FORCE RLS, cross-tenant isolation, durable job idempotency, worker lease columns and append-only audit trigger are active.');
} finally {
  await client.end();
}

async function verifyMigrationAndRls() {
  const migration = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name IN ('20260826090000_backup_gate_1_foundation', '20260827090000_backup_worker_fencing') AND finished_at IS NOT NULL`);
  assert.equal(migration.rowCount, 2, 'Backup migrations must be applied to the local test database.');
  const rls = await client.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('public."BackupPolicy"'::regclass, 'public."BackupJob"'::regclass, 'public."BackupArtifact"'::regclass, 'public."BackupAuditEvent"'::regclass)`);
  assert.equal(rls.rowCount, 4, 'Every backup table must exist.');
  assert.equal(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity), true, 'Every backup table must FORCE tenant RLS.');
  const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'BackupJob' AND column_name IN ('workerLeaseOwnerId', 'workerLeaseFence', 'workerLeaseExpiresAt', 'workerHeartbeatAt')`);
  assert.equal(columns.rowCount, 4, 'Backup jobs must persist worker lease, fence and heartbeat state.');
}

async function verifyTenantIsolationAndAuditImmutability() {
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const companyA = randomUUID(); const companyB = randomUUID();
  const userA = randomUUID(); const userB = randomUUID();
  const jobA = randomUUID(); const jobB = randomUUID(); const auditA = randomUUID();
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)', [tenantA, `backup-a-${tenantA.slice(0, 8)}`, 'Backup verification A', tenantB, `backup-b-${tenantB.slice(0, 8)}`, 'Backup verification B']);
    await seedTenant(tenantA, companyA, userA, jobA, auditA, 'a');
    await seedTenant(tenantB, companyB, userB, jobB, randomUUID(), 'b');

    await setTenant(tenantA);
    const own = await client.query('SELECT count(*)::int AS count FROM "BackupJob" WHERE "id" = $1::uuid', [jobA]);
    assert.equal(own.rows[0].count, 1, 'Tenant must read its own backup job.');
    const foreign = await client.query('SELECT count(*)::int AS count FROM "BackupJob" WHERE "id" = $1::uuid', [jobB]);
    assert.equal(foreign.rows[0].count, 0, 'Tenant RLS must hide a foreign backup job.');
    await expectDatabaseError(
      () => client.query('INSERT INTO "BackupJob" ("id", "tenantId", "companyId", "requestedByUserId", "kind", "idempotencyKey", "requestHash", "correlationId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"BackupJobKind", $6, $7, $8::uuid)', [randomUUID(), tenantA, companyA, userA, 'COMPANY_ARCHIVE_EXPORT', 'duplicate-key', 'a'.repeat(64), randomUUID()]),
      '23505',
      'A reused company/requester idempotency key must be rejected.',
    );
    await expectDatabaseError(
      () => client.query('UPDATE "BackupAuditEvent" SET "action" = $2 WHERE "id" = $1::uuid', [auditA, 'tampered']),
      'P0001',
      'Backup audit events must be append-only.',
    );
    await verifyLeaseFencing(tenantA, companyA, jobA);
    await client.query("SELECT set_config('app.tenant_id', '', true)");
    const unscoped = await client.query('SELECT count(*)::int AS count FROM "BackupJob"');
    assert.equal(unscoped.rows[0].count, 0, 'Unscoped backup-job reads must be denied by RLS.');
  } finally {
    await client.query('ROLLBACK');
  }
}

async function seedTenant(tenantId, companyId, userId, jobId, auditId, suffix) {
  await setTenant(tenantId);
  await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [userId, tenantId, `backup-${suffix}-${userId.slice(0, 8)}`, 'مدقق النسخ', 'Backup auditor', 'verification-only']);
  await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [companyId, tenantId, 'شركة اختبار النسخ', 'Backup verification company']);
  await client.query('INSERT INTO "BackupJob" ("id", "tenantId", "companyId", "requestedByUserId", "kind", "idempotencyKey", "requestHash", "correlationId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"BackupJobKind", $6, $7, $8::uuid)', [jobId, tenantId, companyId, userId, 'COMPANY_ARCHIVE_EXPORT', 'duplicate-key', 'a'.repeat(64), randomUUID()]);
  await client.query('INSERT INTO "BackupAuditEvent" ("id", "tenantId", "companyId", "jobId", "actorUserId", "action", "correlationId", "eventHash") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::uuid, $8)', [auditId, tenantId, companyId, jobId, userId, 'verification.created', randomUUID(), `${suffix}`.repeat(64)]);
}

async function setTenant(tenantId) { await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]); }

async function verifyLeaseFencing(tenantId, companyId, jobId) {
  const workerA = randomUUID(); const workerB = randomUUID();
  await client.query('UPDATE "BackupJob" SET "workerLeaseOwnerId" = $2::uuid, "workerLeaseFence" = 1, "workerLeaseExpiresAt" = NOW() - INTERVAL \'1 second\' WHERE "id" = $1::uuid', [jobId, workerA]);
  const claimB = await client.query('UPDATE "BackupJob" SET "workerLeaseOwnerId" = $2::uuid, "workerLeaseFence" = "workerLeaseFence" + 1, "workerLeaseExpiresAt" = NOW() + INTERVAL \'2 minutes\', "workerHeartbeatAt" = NOW() WHERE "id" = $1::uuid AND "tenantId" = $3::uuid AND "companyId" = $4::uuid AND "workerLeaseOwnerId" = $5::uuid AND "workerLeaseFence" = 1 AND "workerLeaseExpiresAt" <= NOW()', [jobId, workerB, tenantId, companyId, workerA]);
  assert.equal(claimB.rowCount, 1, 'A new worker must claim an expired lease and advance its fence.');
  const staleA = await client.query('UPDATE "BackupJob" SET "workerHeartbeatAt" = NOW() WHERE "id" = $1::uuid AND "workerLeaseOwnerId" = $2::uuid AND "workerLeaseFence" = 1 AND "workerLeaseExpiresAt" > NOW()', [jobId, workerA]);
  assert.equal(staleA.rowCount, 0, 'A stale worker must be fenced from renewing or mutating the claimed job.');
}

async function expectDatabaseError(action, code, message) {
  await client.query('SAVEPOINT backup_verification_expected_error');
  try {
    await action();
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT backup_verification_expected_error');
    assert.equal(error?.code, code, message);
    return;
  }
  throw new Error(message);
}
