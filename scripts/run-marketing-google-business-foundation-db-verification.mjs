import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test", override: true, quiet: true });
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "5433" || databaseUrl.pathname !== "/baseer_erp_test") {
  throw new Error("Refusing Marketing foundation database verification outside the canonical local Baseer test database.");
}

const fixture = {
  tenantId: randomUUID(),
  otherTenantId: randomUUID(),
  companyId: randomUUID(),
  otherCompanyId: randomUUID(),
  userId: randomUUID(),
  roleId: randomUUID(),
  connectionId: randomUUID(),
  otherConnectionId: randomUUID(),
  mappingId: randomUUID(),
  syncRunId: randomUUID(),
};
const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
const client = await pool.connect();

async function expectConstraintFailure(operation, label, constraintPrefix) {
  await client.query("SAVEPOINT expected_constraint_failure");
  try {
    await operation();
    assert.fail(`${label} must be rejected.`);
  } catch (error) {
    assert.equal(error.code, "23503", `${label} must fail through a foreign key.`);
    assert.ok(error.constraint?.startsWith(constraintPrefix), `${label} must fail through its intended foreign key.`);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_constraint_failure");
  }
}

try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
  await client.query(
    'INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)',
    [fixture.tenantId, `mkt-gbp-${fixture.tenantId.slice(0, 8)}`, "Marketing GBP verification", fixture.otherTenantId, `mkt-gbp-${fixture.otherTenantId.slice(0, 8)}`, "Other tenant verification"],
  );
  await client.query(
    'INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)',
    [fixture.userId, fixture.tenantId, `mkt-gbp-${fixture.userId.slice(0, 8)}@baseer.test`, "مستخدم تحقق Google Business", "Google Business verification user", "verification-only"],
  );
  await client.query(
    'INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)',
    [fixture.roleId, fixture.tenantId, `MKT_GBP_${fixture.roleId.slice(0, 8)}`, "دور تحقق التسويق", "Marketing verification role"],
  );
  await client.query(
    'INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)',
    [fixture.companyId, fixture.tenantId, "شركة تحقق Google Business", "Google Business verification company", fixture.otherCompanyId, "شركة عزل أخرى", "Other isolation company"],
  );
  await client.query(
    'INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)',
    [fixture.tenantId, fixture.userId, fixture.companyId, fixture.roleId],
  );
  await client.query(
    'INSERT INTO "MarketingProviderConnection" ("id", "tenantId", "companyId", "provider") VALUES ($1::uuid, $2::uuid, $3::uuid, \'GOOGLE_BUSINESS\'), ($4::uuid, $2::uuid, $5::uuid, \'GOOGLE_BUSINESS\')',
    [fixture.connectionId, fixture.tenantId, fixture.companyId, fixture.otherConnectionId, fixture.otherCompanyId],
  );
  await client.query(
    'INSERT INTO "MarketingGoogleBusinessLocationMapping" ("id", "tenantId", "companyId", "connectionId", "googleAccountResourceName", "googleLocationResourceName", "selectedAt", "selectedByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, CURRENT_TIMESTAMP, $7::uuid)',
    [fixture.mappingId, fixture.tenantId, fixture.companyId, fixture.connectionId, "accounts/verification", "locations/verification", fixture.userId],
  );
  await client.query(
    'INSERT INTO "MarketingProviderSyncRun" ("id", "tenantId", "companyId", "locationMappingId", "provider", "correlationId", "adapterVersion") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, \'GOOGLE_BUSINESS\', $5::uuid, $6)',
    [fixture.syncRunId, fixture.tenantId, fixture.companyId, fixture.mappingId, randomUUID(), "verification"],
  );

  await expectConstraintFailure(
    () => client.query(
      'INSERT INTO "MarketingProviderSyncRun" ("id", "tenantId", "companyId", "locationMappingId", "provider", "correlationId", "adapterVersion") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, \'GOOGLE_ADS\', $5::uuid, $6)',
      [randomUUID(), fixture.tenantId, fixture.companyId, fixture.mappingId, randomUUID(), "verification"],
    ),
    "A Google Ads sync receipt on a GBP mapping",
    "MarketingProviderSyncRun_mapping_fk",
  );
  await expectConstraintFailure(
    () => client.query(
      'INSERT INTO "MarketingGoogleBusinessLocationMapping" ("id", "tenantId", "companyId", "connectionId", "googleAccountResourceName", "googleLocationResourceName", "selectedAt", "selectedByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, CURRENT_TIMESTAMP, $7::uuid)',
      [randomUUID(), fixture.tenantId, fixture.otherCompanyId, fixture.otherConnectionId, "accounts/invalid", "locations/invalid", fixture.userId],
    ),
    "A location selection by a user outside the company membership",
    "MarketingGoogleBusinessLocationMapping_selected_by_membership",
  );
  await client.query("COMMIT");

  await client.query("BEGIN");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.otherTenantId]);
  const hidden = await client.query('SELECT "id" FROM "MarketingGoogleBusinessLocationMapping" WHERE "id" = $1::uuid', [fixture.mappingId]);
  assert.equal(hidden.rowCount, 0, "Tenant RLS must hide a GBP mapping from another tenant.");
  await client.query("COMMIT");

  console.log(JSON.stringify({ ok: true, verified: ["migration_applied", "google_business_mapping", "provider_scoped_sync_fk", "company_membership_selection_fk", "tenant_rls_isolation"] }));
} finally {
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('DELETE FROM "MarketingProviderSyncRun" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "MarketingGoogleBusinessLocationMapping" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "MarketingProviderConnection" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "CompanyMembership" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "Role" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "Company" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "User" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "Tenant" WHERE "id" IN ($1::uuid, $2::uuid)', [fixture.tenantId, fixture.otherTenantId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
