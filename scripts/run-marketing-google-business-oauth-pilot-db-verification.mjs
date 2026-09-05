import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test", override: true, quiet: true });
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "5433" || databaseUrl.pathname !== "/baseer_erp_test") {
  throw new Error("Refusing OAuth pilot database verification outside the canonical local Baseer test database.");
}

const fixture = { tenantId: randomUUID(), otherTenantId: randomUUID(), companyId: randomUUID(), otherCompanyId: randomUUID(), userId: randomUUID(), roleId: randomUUID(), connectionId: randomUUID(), otherConnectionId: randomUUID(), stateId: randomUUID() };
const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
const client = await pool.connect();
const state = (id, companyId, connectionId, stateHash) => [id, fixture.tenantId, companyId, connectionId, fixture.userId, stateHash, "ciphertext", "AAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAA=="];

async function expectFailure(operation, code, constraint) {
  await client.query("SAVEPOINT expected_failure");
  try { await operation(); assert.fail("The constrained OAuth state write must fail."); }
  catch (error) { assert.equal(error.code, code); if (constraint) assert.ok(error.constraint?.startsWith(constraint), `Expected ${constraint}, got ${error.constraint}`); }
  finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); }
}

try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
  await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)', [fixture.tenantId, `mkt-oauth-${fixture.tenantId.slice(0, 8)}`, "OAuth verification", fixture.otherTenantId, `mkt-oauth-${fixture.otherTenantId.slice(0, 8)}`, "Other OAuth verification"]);
  await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [fixture.userId, fixture.tenantId, `oauth-${fixture.userId.slice(0, 8)}@baseer.test`, "مستخدم تحقق", "OAuth verification user", "verification-only"]);
  await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)', [fixture.roleId, fixture.tenantId, `MKT_OAUTH_${fixture.roleId.slice(0, 8)}`, "دور تحقق", "OAuth verification role"]);
  await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)', [fixture.companyId, fixture.tenantId, "شركة تحقق", "Verification company", fixture.otherCompanyId, "شركة أخرى", "Other company"]);
  await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [fixture.tenantId, fixture.userId, fixture.companyId, fixture.roleId]);
  await client.query('INSERT INTO "MarketingProviderConnection" ("id", "tenantId", "companyId", "provider") VALUES ($1::uuid, $2::uuid, $3::uuid, \'GOOGLE_BUSINESS\'), ($4::uuid, $2::uuid, $5::uuid, \'GOOGLE_BUSINESS\')', [fixture.connectionId, fixture.tenantId, fixture.companyId, fixture.otherConnectionId, fixture.otherCompanyId]);
  await client.query('INSERT INTO "MarketingGoogleBusinessOAuthState" ("id", "tenantId", "companyId", "connectionId", "provider", "initiatedByUserId", "stateHash", "verifierEncrypted", "verifierIv", "verifierTag", "expiresAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, \'GOOGLE_BUSINESS\', $5::uuid, $6, $7, $8, $9, CURRENT_TIMESTAMP + interval \'10 minutes\')', state(fixture.stateId, fixture.companyId, fixture.connectionId, "a".repeat(64)));
  await expectFailure(() => client.query('INSERT INTO "MarketingGoogleBusinessOAuthState" ("id", "tenantId", "companyId", "connectionId", "provider", "initiatedByUserId", "stateHash", "verifierEncrypted", "verifierIv", "verifierTag", "expiresAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, \'GOOGLE_BUSINESS\', $5::uuid, $6, $7, $8, $9, CURRENT_TIMESTAMP + interval \'10 minutes\')', state(randomUUID(), fixture.companyId, fixture.connectionId, "b".repeat(64))), "23505", "MarketingGoogleBusinessOAuthState_one_active_attempt");
  await expectFailure(() => client.query('INSERT INTO "MarketingGoogleBusinessOAuthState" ("id", "tenantId", "companyId", "connectionId", "provider", "initiatedByUserId", "stateHash", "verifierEncrypted", "verifierIv", "verifierTag", "expiresAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, \'GOOGLE_BUSINESS\', $5::uuid, $6, $7, $8, $9, CURRENT_TIMESTAMP + interval \'10 minutes\')', state(randomUUID(), fixture.otherCompanyId, fixture.otherConnectionId, "c".repeat(64))), "23503", "MarketingGoogleBusinessOAuthState_membership");
  await client.query("COMMIT");

  await client.query("BEGIN");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.otherTenantId]);
  const hidden = await client.query('SELECT "id" FROM "MarketingGoogleBusinessOAuthState" WHERE "id" = $1::uuid', [fixture.stateId]);
  assert.equal(hidden.rowCount, 0, "Tenant RLS must hide OAuth state from another tenant.");
  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true, verified: ["migration_applied", "single_active_state", "company_membership_fk", "tenant_rls_isolation"] }));
} finally {
  try {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("BEGIN"); await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('DELETE FROM "MarketingGoogleBusinessOAuthState" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "MarketingProviderConnection" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "CompanyMembership" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "Role" WHERE "tenantId" = $1::uuid', [fixture.tenantId]); await client.query('DELETE FROM "Company" WHERE "tenantId" = $1::uuid', [fixture.tenantId]);
    await client.query('DELETE FROM "User" WHERE "tenantId" = $1::uuid', [fixture.tenantId]); await client.query('DELETE FROM "Tenant" WHERE "id" IN ($1::uuid, $2::uuid)', [fixture.tenantId, fixture.otherTenantId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); await pool.end(); }
}
