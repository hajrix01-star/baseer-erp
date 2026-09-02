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
  tenantId: randomUUID(), foreignTenantId: randomUUID(),
  companyId: randomUUID(), alternateCompanyId: randomUUID(), foreignCompanyId: randomUUID(),
  readerUserId: randomUUID(), deniedUserId: randomUUID(),
  primarySummaryId: randomUUID(), foreignSummaryId: randomUUID(),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `command-http-${suffix}`;
  const [{ AppModule }, { AuthService }, { DatabaseService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/database/database.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix("v1");
  await app.init();

  const auth = app.get(AuthService);
  const reader = await auth.signIn({ tenantCode: `command-http-${suffix}`, login: `reader-${suffix}@baseer.test`, password: `Reader-${suffix}`, requestId: randomUUID() });
  const denied = await auth.signIn({ tenantCode: `command-http-${suffix}`, login: `denied-${suffix}@baseer.test`, password: `Denied-${suffix}`, requestId: randomUUID() });
  const server = app.getHttpAdapter().getInstance();
  const url = "/v1/finance/operational-calendar?fromBusinessDate=2026-08-01&toBusinessDate=2026-08-01";
  const primaryHeaders = headers(reader.accessToken, fixture.companyId);

  const unauthenticated = await server.inject({ method: "GET", url });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
  const noCapability = await server.inject({ method: "GET", url, headers: headers(denied.accessToken, fixture.companyId) });
  assert.equal(noCapability.statusCode, 403, noCapability.body);

  const primary = await server.inject({ method: "GET", url, headers: primaryHeaders });
  assert.equal(primary.statusCode, 200, primary.body);
  assert.equal(primary.json().companyId, fixture.companyId);
  assert.deepEqual(primary.json().days.map((day) => [day.operationalStatus, day.dataStatus, day.salesGrossAmount]), [["OPEN", "RECORDED", "125.0000"]]);

  const alternate = await server.inject({ method: "GET", url, headers: headers(reader.accessToken, fixture.alternateCompanyId) });
  assert.equal(alternate.statusCode, 200, alternate.body);
  assert.equal(alternate.json().companyId, fixture.alternateCompanyId);
  assert.deepEqual(alternate.json().days.map((day) => [day.operationalStatus, day.dataStatus, day.salesGrossAmount]), [["CLOSED", "CLOSED", null]], "A company selection must never return the first company's calendar; a closed day without a recorded projection remains unknown rather than invented zero sales.");

  const unknownCompany = await server.inject({ method: "GET", url, headers: headers(reader.accessToken, randomUUID()) });
  assert.equal(unknownCompany.statusCode, 403, unknownCompany.body);
  const crossTenant = await server.inject({ method: "GET", url, headers: headers(reader.accessToken, fixture.foreignCompanyId) });
  assert.equal(crossTenant.statusCode, 403, crossTenant.body);

  const database = app.get(DatabaseService);
  const foreignRows = await database.inTenantTransaction(fixture.foreignTenantId, (transaction) => transaction.financeDailyFinancialSummary.count({ where: { id: fixture.primarySummaryId } }));
  assert.equal(foreignRows, 0, "Tenant RLS must hide a known Command Center summary from another tenant.");

  await revokeLatestSession(fixture.readerUserId);
  const revoked = await server.inject({ method: "GET", url, headers: primaryHeaders });
  assert.equal(revoked.statusCode, 401, revoked.body);

  console.log("Command Center HTTP verification passed: 401/403, finance.daily_sales.read capability, company and tenant isolation, server-owned calendar summaries, revoked sessions, and tenant RLS.");
} finally {
  if (app) await app.close();
  await pool.end();
}

function headers(accessToken, companyId) {
  return { authorization: `Bearer ${accessToken}`, "x-baseer-company-id": companyId };
}

async function seedFixture() {
  const tenantCode = `command-http-${suffix}`;
  const foreignTenantCode = `command-foreign-${suffix}`;
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)', [fixture.tenantId, tenantCode, "Command HTTP", fixture.foreignTenantId, foreignTenantCode, "Foreign command HTTP"]);
  await seedTenant({ tenantId: fixture.tenantId, tenantCode, companyIds: [fixture.companyId, fixture.alternateCompanyId], includeUsers: true });
  await seedTenant({ tenantId: fixture.foreignTenantId, tenantCode: foreignTenantCode, companyIds: [fixture.foreignCompanyId], includeUsers: false });
}

async function seedTenant({ tenantId, tenantCode, companyIds, includeUsers }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    for (const [index, companyId] of companyIds.entries()) {
      await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [companyId, tenantId, `شركة قيادة ${index}`, `Command company ${index}`]);
      const closed = companyId === fixture.alternateCompanyId;
      const summaryId = companyId === fixture.companyId ? fixture.primarySummaryId : companyId === fixture.foreignCompanyId ? fixture.foreignSummaryId : randomUUID();
      await client.query('INSERT INTO "FinanceDailyFinancialSummary" ("id", "tenantId", "companyId", "businessDate", "salesGrossAmount", "salesNetAmount", "salesVatAmount", "salesClosingCount", "customerCount", "operationalDayStatus", "dataStatus", "sourceChecksum") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::decimal, $6::decimal, $7::decimal, $8, $9, $10::"FinanceOperationalDayStatus", $11::"FinanceDailySalesDataStatus", $12)', [summaryId, tenantId, companyId, "2026-08-01", closed ? "0.0000" : "125.0000", closed ? "0.0000" : "100.0000", closed ? "0.0000" : "25.0000", closed ? 0 : 1, closed ? 0 : 2, closed ? "CLOSED" : "OPEN", closed ? "CLOSED" : "RECORDED", `${closed ? "b" : "a"}`.repeat(64)]);
      if (closed) await client.query('INSERT INTO "FinanceOperationalDay" ("id", "tenantId", "companyId", "businessDate", "status", "source", "note", "createdByUserId", "updatedByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::"FinanceOperationalDayStatus", $6::"FinanceOperationalDaySource", $7, $8::uuid, $8::uuid)', [randomUUID(), tenantId, companyId, "2026-08-01", "CLOSED", "MANUAL", "Command Center verifier", includeUsers ? fixture.readerUserId : randomUUID()]);
    }
    if (includeUsers) await seedUsers(client, tenantId, tenantCode, companyIds);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUsers(client, tenantId, tenantCode, companyIds) {
  const readerRoleId = randomUUID();
  const deniedRoleId = randomUUID();
  const people = [
    { id: fixture.readerUserId, login: `reader-${suffix}@baseer.test`, password: `Reader-${suffix}`, roleId: readerRoleId, code: `COMMAND_READER_${suffix}`, permission: "finance.daily_sales.read" },
    { id: fixture.deniedUserId, login: `denied-${suffix}@baseer.test`, password: `Denied-${suffix}`, roleId: deniedRoleId, code: `COMMAND_DENIED_${suffix}`, permission: null },
  ];
  for (const person of people) {
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [person.id, tenantId, person.login, "مستخدم مركز القيادة", "Command user", await bcrypt.hash(person.password, 12)]);
    await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)', [person.roleId, tenantId, person.code, "دور مركز القيادة", "Command role"]);
    if (person.permission) await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)', [tenantId, person.roleId, person.permission]);
    for (const companyId of companyIds) await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [tenantId, person.id, companyId, person.roleId]);
  }
  void tenantCode;
}

async function revokeLatestSession(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    const result = await client.query('UPDATE "AppSession" SET "status" = $3::"SessionStatus", "revokedAt" = now() WHERE "id" = (SELECT "id" FROM "AppSession" WHERE "tenantId" = $1::uuid AND "userId" = $2::uuid ORDER BY "createdAt" DESC LIMIT 1) RETURNING "id"', [fixture.tenantId, userId, "REVOKED"]);
    assert.equal(result.rowCount, 1, "Verifier must revoke the reader session.");
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
