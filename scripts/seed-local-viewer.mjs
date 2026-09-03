import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "./api-workspace-dependencies.mjs";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const password = process.env.BASEER_LOCAL_VIEWER_PASSWORD ?? process.env.BASEER_TEST_BOOTSTRAP_PASSWORD;
if (!password || password.length < 12)
  throw new Error(
    "BASEER_LOCAL_VIEWER_PASSWORD must contain at least 12 characters.",
  );
const { Pool } = pg;
const pool = new Pool({
  connectionString: requiredEnvironment("DATABASE_URL"),
});
const tenantCode = "baseer-viewer";
const login = "owner@hajrix.com";
let app;

try {
  const fixture = await seedIdentity();
  const [{ AppModule }, { CompanyFinanceSetupService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/finance/company-finance-setup.service.js"),
  ]);
  app = await NestFactory.create(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  await app.init();
  const setup = app.get(CompanyFinanceSetupService);
  await setup.initialize(
    {
      tenantId: fixture.tenantId,
      companyId: fixture.companyId,
      actorUserId: fixture.userId,
    },
    {
      fiscalPeriodNameAr: "الفترة التجريبية 2026",
      fiscalPeriodNameEn: "Local viewer period 2026",
      fiscalPeriodStartDate: new Date("2026-01-01T00:00:00.000Z"),
      fiscalPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
      selectedVaults: ["CASH", "BANK", "HUNGERSTATION", "JAHEZ", "KEETA"],
    },
  );
  console.log(
    JSON.stringify({
      tenantCode,
      login,
      companyName: "شركة بصير المحلية",
      database: "isolated Docker test database",
    }),
  );
} finally {
  if (app) await app.close();
  await pool.end();
}

async function seedIdentity() {
  const tenantId = await upsertTenant();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    const userId = await upsertUser(client, tenantId);
    const companyId = await upsertCompany(client, tenantId);
    const roleId = await upsertRole(client, tenantId);
    await client.query(
      'INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid) ON CONFLICT ("userId", "companyId") DO UPDATE SET "roleId" = EXCLUDED."roleId"',
      [tenantId, userId, companyId, roleId],
    );
    await client.query('INSERT INTO "TenantAdministrationAssignment" ("tenantId", "userId", "isOwner") VALUES ($1::uuid, $2::uuid, TRUE) ON CONFLICT ("tenantId", "userId") DO UPDATE SET "isOwner" = TRUE', [tenantId, userId]);
    await client.query("COMMIT");
    return { tenantId, userId, companyId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertTenant() {
  const result = await pool.query(
    'INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3) ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id"',
    [randomUUID(), tenantCode, "Baseer local viewer"],
  );
  return result.rows[0].id;
}

async function upsertUser(client, tenantId) {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await client.query(
    'SELECT "id" FROM "User" WHERE "tenantId" = $1::uuid AND "loginNormalized" = $2',
    [tenantId, login],
  );
  if (existing.rowCount) {
    await client.query(
      'UPDATE "User" SET "passwordHash" = $3, "status" = $4 WHERE "id" = $1::uuid AND "tenantId" = $2::uuid',
      [existing.rows[0].id, tenantId, passwordHash, "ACTIVE"],
    );
    return existing.rows[0].id;
  }
  const id = randomUUID();
  await client.query(
    'INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)',
    [
      id,
      tenantId,
      login,
      "مالك العرض المحلي",
      "Local viewer owner",
      passwordHash,
    ],
  );
  return id;
}

async function upsertCompany(client, tenantId) {
  const existing = await client.query(
    'SELECT "id" FROM "Company" WHERE "tenantId" = $1::uuid AND "nameEn" = $2',
    [tenantId, "Baseer local viewer company"],
  );
  if (existing.rowCount) return existing.rows[0].id;
  const id = randomUUID();
  await client.query(
    'INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)',
    [id, tenantId, "شركة بصير المحلية", "Baseer local viewer company"],
  );
  return id;
}

async function upsertRole(client, tenantId) {
  const code = "LOCAL_VIEWER";
  const existing = await client.query(
    'SELECT "id" FROM "Role" WHERE "tenantId" = $1::uuid AND "code" = $2',
    [tenantId, code],
  );
  const roleId = existing.rowCount ? existing.rows[0].id : randomUUID();
  if (!existing.rowCount)
    await client.query(
      'INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)',
      [roleId, tenantId, code, "مراجع المبيعات المحلي", "Local sales viewer"],
    );
  for (const permissionCode of [
    "finance.daily_sales.read",
    "finance.daily_sales.history.read_all",
    "finance.daily_sales.write",
  ]) {
    await client.query(
      'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING',
      [tenantId, roleId, permissionCode],
    );
  }
  return roleId;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
