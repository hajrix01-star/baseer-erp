import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment("DATABASE_URL") });
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = {
  tenantId: randomUUID(),
  companyId: randomUUID(),
  foreignCompanyId: randomUUID(),
  authorizedUserId: randomUUID(),
  limitedUserId: randomUUID(),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `ai-http-${suffix}`;
  const [{ AppModule }, { AuthService }, { DatabaseService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/database/database.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix("v1");
  await app.init();

  const auth = app.get(AuthService);
  const authorized = await auth.signIn({
    tenantCode: `ai-http-${suffix}`,
    login: `ai-http-${suffix}@baseer.test`,
    password: `Gate-${suffix}`,
    requestId: randomUUID(),
  });
  const limited = await auth.signIn({
    tenantCode: `ai-http-${suffix}`,
    login: `ai-limited-${suffix}@baseer.test`,
    password: `Limited-${suffix}`,
    requestId: randomUUID(),
  });
  const server = app.getHttpAdapter().getInstance();
  const payload = {
    moduleKey: "marketing",
    skillKey: "marketing.performance_analyst",
    idempotencyKey: randomUUID(),
  };
  const headers = {
    authorization: `Bearer ${authorized.accessToken}`,
    "x-baseer-company-id": fixture.companyId,
  };

  const unauthenticated = await server.inject({ method: "POST", url: "/v1/administration/ai/runtime/preflight", payload });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

  const denied = await server.inject({
    method: "POST", url: "/v1/administration/ai/runtime/preflight", payload,
    headers: { authorization: `Bearer ${limited.accessToken}`, "x-baseer-company-id": fixture.companyId },
  });
  assert.equal(denied.statusCode, 403, denied.body);

  const foreign = await server.inject({
    method: "POST", url: "/v1/administration/ai/runtime/preflight", payload,
    headers: { ...headers, "x-baseer-company-id": fixture.foreignCompanyId },
  });
  assert.equal(foreign.statusCode, 403, foreign.body);

  const first = await server.inject({ method: "POST", url: "/v1/administration/ai/runtime/preflight", headers, payload });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().outcome, "BLOCKED", "Gate B must never call a provider.");
  assert.equal(first.json().safeReasonCode, "AI_SKILL_NOT_ACTIVATED");
  assert.equal(first.json().policyVersion, 1);
  assert.deepEqual(first.json().requiredCapabilities, ["platform.ai.use"]);

  const replay = await server.inject({ method: "POST", url: "/v1/administration/ai/runtime/preflight", headers, payload });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().receiptId, first.json().receiptId, "The identical request must replay its receipt.");
  assert.equal(replay.json().replayed, true);

  const mismatch = await server.inject({
    method: "POST", url: "/v1/administration/ai/runtime/preflight", headers,
    payload: { ...payload, skillKey: "marketing.google_review_reply_automation" },
  });
  assert.equal(mismatch.statusCode, 409, mismatch.body);

  for (let index = 0; index < 29; index += 1) {
    const result = await server.inject({
      method: "POST", url: "/v1/administration/ai/runtime/preflight", headers,
      payload: { ...payload, idempotencyKey: randomUUID() },
    });
    assert.equal(result.statusCode, 200, result.body);
  }
  const rateLimited = await server.inject({
    method: "POST", url: "/v1/administration/ai/runtime/preflight", headers,
    payload: { ...payload, idempotencyKey: randomUUID() },
  });
  assert.equal(rateLimited.statusCode, 429, rateLimited.body);

  const database = app.get(DatabaseService);
  const persisted = await database.inTenantTransaction(fixture.tenantId, async (transaction) => ({
    receipts: await transaction.aiExecutionReceipt.findMany({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      select: { skillKey: true, skillVersion: true, policyVersion: true, systemIdentityId: true },
    }),
    audits: await transaction.auditEvent.count({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, action: "platform.ai.runtime_preflight_blocked" },
    }),
  }));
  assert.equal(persisted.receipts.length, 30, "Only newly accepted requests create receipts.");
  assert.equal(persisted.audits, 30, "Each receipt must have an auditable transaction event.");
  assert.ok(persisted.receipts.every((receipt) => receipt.skillKey && receipt.skillVersion === 1 && receipt.policyVersion === 1));
  assert.ok(persisted.receipts.every((receipt) => receipt.systemIdentityId === null), "No configured system identity should be fabricated.");

  console.log("AI Gate B HTTP verification passed: authentication, RBAC, company isolation, replay/mismatch handling, rate limit, atomic receipt/audit persistence and provider-offline boundary.");
} finally {
  if (app) await app.close();
  await pool.end();
}

async function seedFixture() {
  const tenantCode = `ai-http-${suffix}`;
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, tenantCode, `AI HTTP ${suffix}`]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    const authorizedRoleId = randomUUID();
    const limitedRoleId = randomUUID();
    await client.query(
      'INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)',
      [fixture.companyId, fixture.tenantId, "شركة الذكاء", "AI company", fixture.foreignCompanyId, "شركة أخرى", "Other company"],
    );
    await client.query(
      'INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6), ($7::uuid, $2::uuid, $8, $9, $10, $11)',
      [
        fixture.authorizedUserId, fixture.tenantId, `${tenantCode}@baseer.test`, "مستخدم بصيرة", "AI user", await bcrypt.hash(`Gate-${suffix}`, 12),
        fixture.limitedUserId, `ai-limited-${suffix}@baseer.test`, "مستخدم محدود", "Limited user", await bcrypt.hash(`Limited-${suffix}`, 12),
      ],
    );
    await client.query(
      'INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5), ($6::uuid, $2::uuid, $7, $8, $9)',
      [authorizedRoleId, fixture.tenantId, `AI_AUTH_${suffix}`, "دور بصيرة", "AI role", limitedRoleId, `AI_LIMITED_${suffix}`, "دور محدود", "Limited role"],
    );
    await client.query(
      'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $2::uuid, $4)',
      [fixture.tenantId, authorizedRoleId, "platform.ai.use", "marketing.insights.read"],
    );
    await client.query(
      'INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid), ($1::uuid, $5::uuid, $3::uuid, $6::uuid)',
      [fixture.tenantId, fixture.authorizedUserId, fixture.companyId, authorizedRoleId, fixture.limitedUserId, limitedRoleId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
