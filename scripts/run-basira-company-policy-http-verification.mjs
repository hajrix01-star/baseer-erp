import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "./api-workspace-dependencies.mjs";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment("DATABASE_URL") });
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = {
  tenantId: randomUUID(), companyId: randomUUID(), foreignCompanyId: randomUUID(),
  managerId: randomUUID(), readerId: randomUUID(), providerId: randomUUID(),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `basira-policy-${suffix}`;
  const [{ AppModule }, { AuthService }, { DatabaseService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/database/database.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix("v1");
  await app.init();
  const auth = app.get(AuthService);
  const [manager, reader] = await Promise.all([
    auth.signIn({ tenantCode: `basira-policy-${suffix}`, login: `manager-${suffix}@baseer.test`, password: `Manager-${suffix}`, requestId: randomUUID() }),
    auth.signIn({ tenantCode: `basira-policy-${suffix}`, login: `reader-${suffix}@baseer.test`, password: `Reader-${suffix}`, requestId: randomUUID() }),
  ]);
  const server = app.getHttpAdapter().getInstance();
  const managerHeaders = { authorization: `Bearer ${manager.accessToken}`, "x-baseer-company-id": fixture.companyId };
  const readerHeaders = { authorization: `Bearer ${reader.accessToken}`, "x-baseer-company-id": fixture.companyId };
  const policyRequest = {
    expectedVersion: 0, mode: "ENABLED", monthlyBudgetUsdCents: "1250",
    providerConfigurationIds: [fixture.providerId], pilotSkills: [], autoEnrollStable: false,
    changeReason: "HTTP verification company policy", idempotencyKey: randomUUID(),
  };

  const unauthenticated = await server.inject({ method: "GET", url: "/v1/administration/ai/company-policy" });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
  const readable = await server.inject({ method: "GET", url: "/v1/administration/ai/company-policy", headers: readerHeaders });
  assert.equal(readable.statusCode, 200, readable.body);
  assert.deepEqual(readable.json(), { companyId: fixture.companyId, policyId: null, version: 0, mode: "DISABLED", monthlyBudgetUsdCents: null, billingTimeZone: "Asia/Riyadh", providerConfigurationIds: [], pilotSkills: [], autoEnrollStable: false, canManage: false, updatedAt: null });
  const readerWrite = await server.inject({ method: "PUT", url: "/v1/administration/ai/company-policy", headers: readerHeaders, payload: policyRequest });
  assert.equal(readerWrite.statusCode, 403, readerWrite.body);
  const foreign = await server.inject({ method: "GET", url: "/v1/administration/ai/company-policy", headers: { ...managerHeaders, "x-baseer-company-id": fixture.foreignCompanyId } });
  assert.equal(foreign.statusCode, 403, foreign.body);

  const enabled = await server.inject({ method: "PUT", url: "/v1/administration/ai/company-policy", headers: managerHeaders, payload: policyRequest });
  assert.equal(enabled.statusCode, 200, enabled.body);
  assert.match(enabled.json().policyId, /^[0-9a-f-]{36}$/i);
  assert.equal(enabled.json().version, 1);
  assert.equal(enabled.json().mode, "ENABLED");
  assert.equal(enabled.json().monthlyBudgetUsdCents, "1250");
  assert.deepEqual(enabled.json().providerConfigurationIds, [fixture.providerId]);
  assert.equal(enabled.json().canManage, true);
  const replay = await server.inject({ method: "PUT", url: "/v1/administration/ai/company-policy", headers: managerHeaders, payload: policyRequest });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().version, 1, "An idempotent replay must not create another policy revision.");
  const stale = await server.inject({ method: "PUT", url: "/v1/administration/ai/company-policy", headers: managerHeaders, payload: { ...policyRequest, idempotencyKey: randomUUID(), changeReason: "Stale policy update" } });
  assert.equal(stale.statusCode, 409, stale.body);

  const database = app.get(DatabaseService);
  const persisted = await database.inTenantTransaction(fixture.tenantId, async (transaction) => ({
    revisions: await transaction.aiCompanyPolicyRevision.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
    allowlists: await transaction.aiCompanyPolicyProviderAllowlist.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, providerConfigurationId: fixture.providerId } }),
    audits: await transaction.auditEvent.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, action: "platform.ai.company_policy_changed" } }),
  }));
  assert.deepEqual(persisted, { revisions: 1, allowlists: 1, audits: 1 });
  console.log("Basira company-policy HTTP verification passed: authentication, read/manage RBAC, company isolation, version conflict, idempotency, revision and audit persistence.");
} finally {
  if (app) await app.close();
  await pool.end();
}

async function seedFixture() {
  const tenantCode = `basira-policy-${suffix}`;
  const managerRoleId = randomUUID();
  const readerRoleId = randomUUID();
  const [managerHash, readerHash] = await Promise.all([bcrypt.hash(`Manager-${suffix}`, 12), bcrypt.hash(`Reader-${suffix}`, 12)]);
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, tenantCode, "Basira policy HTTP verification"]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)', [fixture.companyId, fixture.tenantId, "شركة سياسة بصيرة", "Basira policy company", fixture.foreignCompanyId, "شركة أجنبية", "Foreign company"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6), ($7::uuid, $2::uuid, $8, $9, $10, $11)', [fixture.managerId, fixture.tenantId, `manager-${suffix}@baseer.test`, "مدير السياسة", "Policy manager", managerHash, fixture.readerId, `reader-${suffix}@baseer.test`, "قارئ السياسة", "Policy reader", readerHash]);
    await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5), ($6::uuid, $2::uuid, $7, $8, $9)', [managerRoleId, fixture.tenantId, `POLICY_MANAGER_${suffix}`, "مدير بصيرة", "Basira manager", readerRoleId, `POLICY_READER_${suffix}`, "قارئ بصيرة", "Basira reader"]);
    await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $2::uuid, $4), ($1::uuid, $5::uuid, $3)', [fixture.tenantId, managerRoleId, "platform.ai.policy.read", "platform.ai.policy.manage", readerRoleId]);
    await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid), ($1::uuid, $5::uuid, $3::uuid, $6::uuid)', [fixture.tenantId, fixture.managerId, fixture.companyId, managerRoleId, fixture.readerId, readerRoleId]);
    await client.query('INSERT INTO "AiProviderConfiguration" ("id", "tenantId", "provider", "model", "status", "isDefault", "dailyRequestLimit", "dailyCostLimit", "encryptedCredential", "credentialIv", "credentialTag") VALUES ($1::uuid, $2::uuid, $3, $4, $5, true, 10, 1.00, $6, $7, $8)', [fixture.providerId, fixture.tenantId, "OPENAI_COMPATIBLE", "gpt-5-mini", "ACTIVE", "verification-only", "iv", "tag"]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
