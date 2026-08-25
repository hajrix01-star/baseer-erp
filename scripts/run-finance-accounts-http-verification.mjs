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
  alternateCompanyId: randomUUID(),
  readerUserId: randomUUID(),
  deniedUserId: randomUUID(),
  cashAccountId: randomUUID(),
  expenseAccountId: randomUUID(),
  alternateAccountId: randomUUID(),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `finance-accounts-http-${suffix}`;
  const [{ AppModule }, { AuthService }, { BUSINESS_DATE_CLOCK }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/business-date/business-date.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  app.get(BUSINESS_DATE_CLOCK).now = () => new Date("2026-08-20T12:00:00.000Z");
  app.setGlobalPrefix("v1");
  await app.init();

  const auth = app.get(AuthService);
  const reader = await signIn(auth, "reader", `Reader-${suffix}`);
  const denied = await signIn(auth, "denied", `Denied-${suffix}`);
  const server = app.getHttpAdapter().getInstance();
  const url = "/v1/finance/accounts?fromBusinessDate=2026-08-01&toBusinessDate=2026-08-31";
  const readerHeaders = headers(reader.accessToken, fixture.companyId);

  // This makes a missing controller route fail immediately (404), rather than
  // allowing a mocked client response to conceal the deployment defect.
  const unauthenticated = await server.inject({ method: "GET", url });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
  const noCapability = await server.inject({ method: "GET", url, headers: headers(denied.accessToken, fixture.companyId) });
  assert.equal(noCapability.statusCode, 403, noCapability.body);

  const primary = await server.inject({ method: "GET", url, headers: readerHeaders });
  assert.equal(primary.statusCode, 200, primary.body);
  assert.equal(primary.json().companyId, fixture.companyId);
  assert.equal(primary.json().asOfBusinessDate, "2026-08-20", "Future query dates must be capped at the current Riyadh business date.");
  assert.equal(primary.json().fromBusinessDate, "2026-08-01");
  assert.equal(primary.json().toBusinessDate, "2026-08-20");
  assert.deepEqual(primary.json().summary, { accountCount: 2, periodDebit: "25.0000", periodCredit: "4.0000" });
  assert.deepEqual(
    primary.json().accounts.map((account) => [account.id, account.code, account.balanceDebit, account.balanceCredit, account.periodDebit, account.periodCredit]),
    [
      [fixture.cashAccountId, "1000", "80.0000", "0.0000", "10.0000", "0.0000"],
      [fixture.expenseAccountId, "5000", "15.0000", "4.0000", "15.0000", "4.0000"],
    ],
    "The accounts workspace must return the database-backed, as-of and period totals for its selected company only.",
  );

  const search = await server.inject({ method: "GET", url: `${url}&q=5000`, headers: readerHeaders });
  assert.equal(search.statusCode, 200, search.body);
  assert.deepEqual(search.json().accounts.map((account) => account.id), [fixture.expenseAccountId]);

  const alternate = await server.inject({ method: "GET", url, headers: headers(reader.accessToken, fixture.alternateCompanyId) });
  assert.equal(alternate.statusCode, 200, alternate.body);
  assert.equal(alternate.json().companyId, fixture.alternateCompanyId);
  assert.deepEqual(alternate.json().accounts.map((account) => account.id), [fixture.alternateAccountId], "A selected company must never receive another company's accounts.");

  console.log("Finance accounts HTTP verification passed: registered protected route, finance.configuration.read RBAC, authentic database receipt, future-date capping, search, and selected-company isolation.");
} finally {
  if (app) await app.close();
  await pool.end();
}

function headers(accessToken, companyId) {
  return { authorization: `Bearer ${accessToken}`, "x-baseer-company-id": companyId };
}

async function signIn(auth, loginPrefix, password) {
  return auth.signIn({
    tenantCode: `finance-accounts-http-${suffix}`,
    login: `${loginPrefix}-${suffix}@baseer.test`,
    password,
    requestId: randomUUID(),
  });
}

async function seedFixture() {
  const tenantCode = `finance-accounts-http-${suffix}`;
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, tenantCode, "Finance accounts HTTP"]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)', [fixture.companyId, fixture.tenantId, "شركة الحسابات", "Accounts company", fixture.alternateCompanyId, "شركة بديلة", "Alternate accounts company"]);
    await seedUsers(client);
    await client.query('INSERT INTO "FinanceAccount" ("id", "tenantId", "companyId", "code", "nameAr", "nameEn", "type", "isSystem", "status") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::"FinanceAccountType", false, $8::"FinanceAccountStatus"), ($9::uuid, $2::uuid, $3::uuid, $10, $11, $12, $13::"FinanceAccountType", false, $8::"FinanceAccountStatus"), ($14::uuid, $2::uuid, $15::uuid, $16, $17, $18, $7::"FinanceAccountType", false, $8::"FinanceAccountStatus")', [fixture.cashAccountId, fixture.tenantId, fixture.companyId, "1000", "النقدية", "Cash", "ASSET", "ACTIVE", fixture.expenseAccountId, "5000", "مصروف التحقق", "Verification expense", "EXPENSE", fixture.alternateAccountId, fixture.alternateCompanyId, "1000", "نقدية بديلة", "Alternate cash"]);
    await client.query('INSERT INTO "FinanceAccountMonthlyBalance" ("tenantId", "companyId", "accountId", "monthStart", "debitAmount", "creditAmount") VALUES ($1::uuid, $2::uuid, $3::uuid, DATE \'2026-07-01\', 70.0000, 0.0000)', [fixture.tenantId, fixture.companyId, fixture.cashAccountId]);
    await client.query('INSERT INTO "FinanceAccountDailyBalance" ("tenantId", "companyId", "accountId", "businessDate", "debitAmount", "creditAmount") VALUES ($1::uuid, $2::uuid, $3::uuid, DATE \'2026-08-10\', 10.0000, 0.0000), ($1::uuid, $2::uuid, $3::uuid, DATE \'2026-08-21\', 999.0000, 0.0000), ($1::uuid, $2::uuid, $4::uuid, DATE \'2026-08-10\', 15.0000, 4.0000), ($1::uuid, $5::uuid, $6::uuid, DATE \'2026-08-10\', 77.0000, 0.0000)', [fixture.tenantId, fixture.companyId, fixture.cashAccountId, fixture.expenseAccountId, fixture.alternateCompanyId, fixture.alternateAccountId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUsers(client) {
  const readerRoleId = randomUUID();
  const deniedRoleId = randomUUID();
  const people = [
    { id: fixture.readerUserId, login: `reader-${suffix}@baseer.test`, password: `Reader-${suffix}`, roleId: readerRoleId, code: `ACCOUNTS_READER_${suffix}`, permission: "finance.configuration.read" },
    { id: fixture.deniedUserId, login: `denied-${suffix}@baseer.test`, password: `Denied-${suffix}`, roleId: deniedRoleId, code: `ACCOUNTS_DENIED_${suffix}`, permission: null },
  ];
  for (const person of people) {
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [person.id, fixture.tenantId, person.login, "مستخدم حسابات", "Accounts user", await bcrypt.hash(person.password, 12)]);
    await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)', [person.roleId, fixture.tenantId, person.code, "دور الحسابات", "Accounts role"]);
    if (person.permission) await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)', [fixture.tenantId, person.roleId, person.permission]);
    const companyIds = person.id === fixture.readerUserId ? [fixture.companyId, fixture.alternateCompanyId] : [fixture.companyId];
    for (const companyId of companyIds) await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [fixture.tenantId, person.id, companyId, person.roleId]);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
