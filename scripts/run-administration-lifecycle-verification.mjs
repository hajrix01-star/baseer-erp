import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "./api-workspace-dependencies.mjs";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment("DATABASE_URL") });
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = { tenantId: randomUUID(), ownerId: randomUUID(), userId: randomUUID(), companyId: randomUUID(), roleId: randomUUID(), systemRoleId: randomUUID(), foreignTenantId: randomUUID(), foreignUserId: randomUUID() };
const logoStorageRoot = await mkdtemp(join(tmpdir(), "baseer-administration-logo-"));
let app;

try {
  process.env.BASEER_COMPANY_LOGO_STORAGE_ROOT = logoStorageRoot;
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `admin-http-${suffix}`;
  const [{ AppModule }, { AuthService }, { CompanyContextService }, { CompanyAccessService }, { DatabaseService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/company-context/company-context.service.js"),
    import("../apps/api/dist/company-context/company-access.service.js"),
    import("../apps/api/dist/database/database.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix("v1");
  await app.init();
  const auth = app.get(AuthService);
  const companyContext = app.get(CompanyContextService);
  const companyAccess = app.get(CompanyAccessService);
  const database = app.get(DatabaseService);
  const owner = await auth.signIn({ tenantCode: `admin-http-${suffix}`, login: `owner-${suffix}`, password: `Owner-${suffix}`, requestId: randomUUID() });
  const target = await auth.signIn({ tenantCode: `admin-http-${suffix}`, login: `user-${suffix}`, password: `User-${suffix}`, requestId: randomUUID() });
  const server = app.getHttpAdapter().getInstance();
  const headers = { authorization: `Bearer ${owner.accessToken}` };
  await database.inTenantTransaction(fixture.tenantId, (tx) => tx.rolePermission.createMany({ data: [{ tenantId: fixture.tenantId, roleId: fixture.roleId, permissionCode: "finance.daily_sales.create" }, { tenantId: fixture.tenantId, roleId: fixture.roleId, permissionCode: "legacy.retired.permission" }] }));
  const legacyCashierRead = await companyContext.authorize({ accessToken: target.accessToken, companyId: fixture.companyId, requiredCapabilities: ["finance.daily_sales.read"] });
  assert.deepEqual(legacyCashierRead.capabilities, ["finance.daily_sales.read"]);
  await assert.rejects(() => companyContext.authorize({ accessToken: target.accessToken, companyId: fixture.companyId, requiredCapabilities: ["finance.vaults.read"] }));
  const legacyCashierCompanies = await companyAccess.listAvailableCompanies(target.accessToken);
  assert.ok(legacyCashierCompanies[0]?.permissionCodes.includes("finance.daily_sales.read"));
  assert.ok(!legacyCashierCompanies[0]?.permissionCodes.includes("finance.vaults.read"));
  const missingCredentials = await server.inject({ method: "GET", url: "/v1/administration/overview" });
  assert.equal(missingCredentials.statusCode, 401, missingCredentials.body);
  const nonAdministrator = await server.inject({ method: "GET", url: "/v1/administration/overview", headers: { authorization: `Bearer ${target.accessToken}` } });
  assert.equal(nonAdministrator.statusCode, 403, nonAdministrator.body);
  const usernameLogin = await server.inject({ method: "POST", url: "/v1/auth/sign-in", headers: { "x-baseer-tenant-code": `admin-http-${suffix}` }, payload: { login: `owner-${suffix}`, password: `Owner-${suffix}` } });
  assert.equal(usernameLogin.statusCode, 200, usernameLogin.body);
  const emailLogin = await server.inject({ method: "POST", url: "/v1/auth/sign-in", headers: { "x-baseer-tenant-code": `admin-http-${suffix}` }, payload: { login: `owner-${suffix}@admin-http-${suffix}.baseer.local`, password: `Owner-${suffix}` } });
  assert.equal(emailLogin.statusCode, 200, emailLogin.body);

  const overview = await server.inject({ method: "GET", url: "/v1/administration/overview", headers });
  assert.equal(overview.statusCode, 200, overview.body);

  const createRole = await server.inject({ method: "POST", url: "/v1/administration/roles", headers, payload: { nameAr: "كاشير اختبار", nameEn: "Test cashier", permissionCodes: ["finance.daily_sales.create"] } });
  assert.equal(createRole.statusCode, 201, createRole.body);
  const createdRoleBody = JSON.parse(createRole.body);
  const createdRole = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.role.findFirstOrThrow({ where: { id: createdRoleBody.id }, include: { grants: { orderBy: { permissionCode: "asc" } } } }));
  assert.match(createdRole.code, /^CUSTOM_TEST_CASHIER_[A-F0-9]{8}$/);
  assert.deepEqual(createdRole.grants.map((grant) => grant.permissionCode), ["finance.daily_sales.create", "finance.daily_sales.read"]);

  const logoPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const uploadedLogo = await server.inject({ method: "POST", url: `/v1/administration/companies/${fixture.companyId}/logo`, headers, payload: { fileName: "company.png", contentBase64: logoPng.toString("base64") } });
  assert.equal(uploadedLogo.statusCode, 201, uploadedLogo.body);
  const uploadedLogoBody = JSON.parse(uploadedLogo.body);
  assert.equal(uploadedLogoBody.mimeType, "image/png");
  const loadedLogo = await server.inject({ method: "GET", url: `/v1/administration/companies/${fixture.companyId}/logo`, headers });
  assert.equal(loadedLogo.statusCode, 200, loadedLogo.body);
  assert.deepEqual(Buffer.from(loadedLogo.rawPayload), logoPng);
  const rejectedLogo = await server.inject({ method: "POST", url: `/v1/administration/companies/${fixture.companyId}/logo`, headers, payload: { fileName: "not-an-image.png", contentBase64: Buffer.from("not an image").toString("base64") } });
  assert.equal(rejectedLogo.statusCode, 400, rejectedLogo.body);

  await database.inTenantTransaction(fixture.tenantId, (tx) => tx.companyFinanceProfile.create({ data: { id: randomUUID(), tenantId: fixture.tenantId, companyId: fixture.companyId, vatAccountingEnabled: true, vatRateBasisPoints: 1500 } }));
  const saveAll = await server.inject({ method: "PUT", url: `/v1/administration/companies/${fixture.companyId}/settings`, headers, payload: { nameAr: "شركة اختبار محدثة", nameEn: "Updated test company", businessTimezone: "Asia/Riyadh", logoFileMetadataId: uploadedLogoBody.id, vatRateBasisPoints: 1250, contextLocationCode: null, contextLocationLabelAr: null, contextLatitude: null, contextLongitude: null } });
  assert.equal(saveAll.statusCode, 200, saveAll.body);
  const savedCompany = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.company.findFirstOrThrow({ where: { id: fixture.companyId }, select: { nameAr: true } }));
  const savedProfile = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.companyFinanceProfile.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { vatRateBasisPoints: true } }));
  assert.equal(savedCompany.nameAr, "شركة اختبار محدثة");
  assert.equal(savedProfile.vatRateBasisPoints, 1250);
  const removeLogo = await server.inject({ method: "PUT", url: `/v1/administration/companies/${fixture.companyId}/settings`, headers, payload: { nameAr: "شركة اختبار محدثة", nameEn: "Updated test company", businessTimezone: "Asia/Riyadh", logoFileMetadataId: null, vatRateBasisPoints: 1250, contextLocationCode: null, contextLocationLabelAr: null, contextLatitude: null, contextLongitude: null } });
  assert.equal(removeLogo.statusCode, 200, removeLogo.body);
  const removedLogo = await server.inject({ method: "GET", url: `/v1/administration/companies/${fixture.companyId}/logo`, headers });
  assert.equal(removedLogo.statusCode, 404, removedLogo.body);

  const updateSystemRole = await server.inject({ method: "PUT", url: `/v1/administration/roles/${fixture.systemRoleId}`, headers, payload: { nameAr: "تعديل محظور", nameEn: "Blocked update", permissionCodes: ["administration.roles.read"] } });
  assert.equal(updateSystemRole.statusCode, 403, updateSystemRole.body);
  const deleteSystemRole = await server.inject({ method: "DELETE", url: `/v1/administration/roles/${fixture.systemRoleId}`, headers, payload: {} });
  assert.equal(deleteSystemRole.statusCode, 403, deleteSystemRole.body);
  const immutableSystemRole = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.role.findFirstOrThrow({ where: { id: fixture.systemRoleId }, include: { grants: true } }));
  assert.equal(immutableSystemRole.nameAr, "دور نظام الاختبار");
  assert.equal(immutableSystemRole.nameEn, "Test system role");
  assert.equal(immutableSystemRole.isSystem, true);
  assert.equal(immutableSystemRole.grants.length, 0);

  const foreignTarget = await server.inject({ method: "PUT", url: `/v1/administration/users/${fixture.foreignUserId}/status`, headers, payload: { status: "DISABLED", reason: "اختبار عزل شركة أخرى" } });
  assert.equal(foreignTarget.statusCode, 404, foreignTarget.body);
  const foreignVisible = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.user.count({ where: { id: fixture.foreignUserId } }));
  assert.equal(foreignVisible, 0, "RLS must hide users owned by another tenant.");

  const disable = await server.inject({ method: "PUT", url: `/v1/administration/users/${fixture.userId}/status`, headers, payload: { status: "DISABLED", reason: "اختبار تعطيل المستخدم" } });
  assert.equal(disable.statusCode, 200, disable.body);
  const statusAfterDisable = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.user.findFirstOrThrow({ where: { id: fixture.userId }, select: { status: true, sessionVersion: true } }));
  assert.equal(statusAfterDisable.status, "DISABLED");
  const sessionsAfterDisable = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.appSession.count({ where: { tenantId: fixture.tenantId, userId: fixture.userId, status: "ACTIVE" } }));
  assert.equal(sessionsAfterDisable, 0, "Disabling a user must revoke active sessions.");
  const revokedSession = await server.inject({ method: "GET", url: "/v1/administration/overview", headers: { authorization: `Bearer ${target.accessToken}` } });
  assert.equal(revokedSession.statusCode, 401, revokedSession.body);

  const resetDisabled = await server.inject({ method: "POST", url: `/v1/administration/users/${fixture.userId}/reset-password`, headers, payload: { password: `New-${suffix}-password`, reason: "اختبار كلمة المرور" } });
  assert.equal(resetDisabled.statusCode, 409, resetDisabled.body);

  const activate = await server.inject({ method: "PUT", url: `/v1/administration/users/${fixture.userId}/status`, headers, payload: { status: "ACTIVE", reason: "اختبار إعادة التفعيل" } });
  assert.equal(activate.statusCode, 200, activate.body);
  const reset = await server.inject({ method: "POST", url: `/v1/administration/users/${fixture.userId}/reset-password`, headers, payload: { password: `New-${suffix}-password`, reason: "اختبار كلمة المرور" } });
  assert.equal(reset.statusCode, 200, reset.body);
  await assert.rejects(() => auth.signIn({ tenantCode: `admin-http-${suffix}`, login: `user-${suffix}`, password: `User-${suffix}`, requestId: randomUUID() }));
  await auth.signIn({ tenantCode: `admin-http-${suffix}`, login: `user-${suffix}`, password: `New-${suffix}-password`, requestId: randomUUID() });
  await auth.signIn({ tenantCode: `admin-http-${suffix}`, login: `user-${suffix}@admin-http-${suffix}.baseer.local`, password: `New-${suffix}-password`, requestId: randomUUID() });

  const withdraw = await server.inject({ method: "DELETE", url: `/v1/administration/memberships/${fixture.userId}/${fixture.companyId}`, headers, payload: { reason: "اختبار سحب الوصول" } });
  assert.equal(withdraw.statusCode, 200, withdraw.body);
  const membershipsAfterWithdrawal = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.companyMembership.count({ where: { tenantId: fixture.tenantId, userId: fixture.userId, companyId: fixture.companyId } }));
  assert.equal(membershipsAfterWithdrawal, 0);

  const lastOwner = await server.inject({ method: "PUT", url: `/v1/administration/users/${fixture.ownerId}/status`, headers, payload: { status: "DISABLED", reason: "اختبار آخر مالك" } });
  assert.equal(lastOwner.statusCode, 409, lastOwner.body);
  assert.ok(!lastOwner.body.includes("Owner-"), "Error output must not disclose credentials.");

  const passwordAudit = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.auditEvent.findFirstOrThrow({ where: { tenantId: fixture.tenantId, action: "administration.user.password_reset" }, select: { afterJson: true } }));
  assert.ok(!JSON.stringify(passwordAudit.afterJson).includes(`New-${suffix}-password`), "Password reset audit must never store the password.");
  assert.ok(target.accessToken, "Fixture target sign-in establishes a session before lifecycle changes.");
  console.log("Administration lifecycle verification passed: authentication/authority denial, system-role immutability, cross-tenant RLS, disable/activate, password reset, membership withdrawal, session revocation, audit redaction, and last-owner protection.");
} finally {
  if (app) await app.close();
  await pool.end();
  await rm(logoStorageRoot, { recursive: true, force: true });
}

async function seedFixture() {
  const tenantCode = `admin-http-${suffix}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, tenantCode, `Administration HTTP ${suffix}`]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.foreignTenantId, `admin-foreign-${suffix}`, `Foreign administration ${suffix}`]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6), ($7::uuid, $2::uuid, $8, $9, $10, $11)', [fixture.ownerId, fixture.tenantId, `owner-${suffix}@${tenantCode}.baseer.local`, "مالك الاختبار", "Test owner", await bcrypt.hash(`Owner-${suffix}`, 12), fixture.userId, `user-${suffix}@${tenantCode}.baseer.local`, "مستخدم الاختبار", "Test user", await bcrypt.hash(`User-${suffix}`, 12)]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.foreignTenantId]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [fixture.foreignUserId, fixture.foreignTenantId, `foreign-${suffix}@admin-foreign-${suffix}.baseer.local`, "مستخدم أجنبي", "Foreign user", await bcrypt.hash(`Foreign-${suffix}`, 12)]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [fixture.companyId, fixture.tenantId, "شركة اختبار", "Test company"]);
    await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5), ($6::uuid, $2::uuid, $7, $8, $9)', [fixture.roleId, fixture.tenantId, "ADMIN_HTTP_TEST", "دور اختبار", "Test role", fixture.systemRoleId, "ADMIN_HTTP_SYSTEM", "دور نظام الاختبار", "Test system role"]);
    await client.query('UPDATE "Role" SET "isSystem" = true WHERE "id" = $1::uuid', [fixture.systemRoleId]);
    await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [fixture.tenantId, fixture.userId, fixture.companyId, fixture.roleId]);
    await client.query('INSERT INTO "TenantAdministrationAssignment" ("tenantId", "userId", "isOwner") VALUES ($1::uuid, $2::uuid, true)', [fixture.tenantId, fixture.ownerId]);
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
