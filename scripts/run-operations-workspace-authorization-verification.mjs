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
  tenantId: randomUUID(),
  companyId: randomUUID(),
  catalogOnlyUserId: randomUUID(),
  fullWorkspaceUserId: randomUUID(),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `operations-workspace-auth-${suffix}`;
  const [{ AppModule }, { AuthService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  app.setGlobalPrefix("v1");
  await app.init();

  const auth = app.get(AuthService);
  const [catalogOnly, fullWorkspace] = await Promise.all([
    signIn(auth, "catalog-only", `CatalogOnly-${suffix}`),
    signIn(auth, "full-workspace", `FullWorkspace-${suffix}`),
  ]);
  const server = app.getHttpAdapter().getInstance();
  const catalogOnlyHeaders = headers(catalogOnly.accessToken);
  const fullWorkspaceHeaders = headers(fullWorkspace.accessToken);
  const workspaceUrl = "/v1/operations/execution-workspace";
  const summaryUrl = "/v1/operations/execution-workspace/summary";

  const unauthenticated = await server.inject({ method: "GET", url: workspaceUrl });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

  for (const url of [workspaceUrl, summaryUrl]) {
    const catalogOnlyResponse = await server.inject({ method: "GET", url, headers: catalogOnlyHeaders });
    assert.equal(
      catalogOnlyResponse.statusCode,
      403,
      `A role with only operations.catalog.read must not receive ${url}: ${catalogOnlyResponse.body}`,
    );
  }

  const workspace = await server.inject({ method: "GET", url: workspaceUrl, headers: fullWorkspaceHeaders });
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.deepEqual(workspace.json(), { recipes: [], inventory: [], requests: [], custody: { representativeName: null, balance: "0", events: [] } });

  const summary = await server.inject({ method: "GET", url: summaryUrl, headers: fullWorkspaceHeaders });
  assert.equal(summary.statusCode, 200, summary.body);
  const summaryReceipt = summary.json();
  assert.equal(summaryReceipt.inventoryMaterialCount, 0);
  assert.equal(summaryReceipt.openRequestCount, 0);
  assert.deepEqual(summaryReceipt.custody, { representativeName: null, balance: "0" });
  assert.match(summaryReceipt.asOf, /^\d{4}-\d{2}-\d{2}T/, "The summary must be an authentic service receipt, not a mocked response.");

  console.log("Operations execution workspace authorization verification passed: catalog-only access is denied from both aggregate routes, while the complete read-capability set receives authentic empty-company receipts.");
} finally {
  if (app) await app.close();
  await pool.end();
}

function headers(accessToken) {
  return { authorization: `Bearer ${accessToken}`, "x-baseer-company-id": fixture.companyId };
}

async function signIn(auth, loginPrefix, password) {
  return auth.signIn({
    tenantCode: `operations-workspace-auth-${suffix}`,
    login: `${loginPrefix}-${suffix}@baseer.test`,
    password,
    requestId: randomUUID(),
  });
}

async function seedFixture() {
  const tenantCode = `operations-workspace-auth-${suffix}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, tenantCode, "Operations workspace authorization"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [fixture.companyId, fixture.tenantId, "شركة التشغيل", "Operations company"]);
    await seedUsers(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUsers(client) {
  const catalogOnlyRoleId = randomUUID();
  const fullWorkspaceRoleId = randomUUID();
  const people = [
    {
      id: fixture.catalogOnlyUserId,
      login: `catalog-only-${suffix}@baseer.test`,
      password: `CatalogOnly-${suffix}`,
      roleId: catalogOnlyRoleId,
      roleCode: `OPERATIONS_CATALOG_ONLY_${suffix}`,
      capabilities: ["operations.catalog.read"],
    },
    {
      id: fixture.fullWorkspaceUserId,
      login: `full-workspace-${suffix}@baseer.test`,
      password: `FullWorkspace-${suffix}`,
      roleId: fullWorkspaceRoleId,
      roleCode: `OPERATIONS_WORKSPACE_FULL_${suffix}`,
      capabilities: ["operations.catalog.read", "operations.recipe.read", "operations.inventory.read", "operations.purchase_request.read", "operations.custody.read"],
    },
  ];

  for (const person of people) {
    await client.query(
      'INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)',
      [person.id, fixture.tenantId, person.login, "مستخدم التشغيل", "Operations user", await bcrypt.hash(person.password, 12)],
    );
    await client.query(
      'INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)',
      [person.roleId, fixture.tenantId, person.roleCode, "دور التشغيل", "Operations role"],
    );
    await client.query(
      'INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)',
      [fixture.tenantId, person.id, fixture.companyId, person.roleId],
    );
    for (const capability of person.capabilities) {
      await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)', [fixture.tenantId, person.roleId, capability]);
    }
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
