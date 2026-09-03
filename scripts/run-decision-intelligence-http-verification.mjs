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
  tenantId: randomUUID(), foreignTenantId: randomUUID(),
  companyId: randomUUID(), alternateCompanyId: randomUUID(), foreignCompanyId: randomUUID(),
  managerUserId: randomUUID(), readerUserId: randomUUID(), deniedUserId: randomUUID(),
  alertId: randomUUID(), foreignAlertId: randomUUID(), evidenceId: randomUUID(), evaluationId: randomUUID(), foreignEvidenceId: randomUUID(), foreignEvaluationId: randomUUID(),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `decision-http-${suffix}`;
  const [{ AppModule }, { ApiExceptionFilter }, { AuthService }, { DatabaseService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/common/api-exception.filter.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/database/database.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  const auth = app.get(AuthService);
  const [manager, reader, denied] = await Promise.all([
    signIn(auth, "manager", `Manager-${suffix}`), signIn(auth, "reader", `Reader-${suffix}`), signIn(auth, "denied", `Denied-${suffix}`),
  ]);
  const server = app.getHttpAdapter().getInstance();
  const managerHeaders = headers(manager.accessToken, fixture.companyId);
  const readerHeaders = headers(reader.accessToken, fixture.companyId);
  const deniedHeaders = headers(denied.accessToken, fixture.companyId);

  const unauthenticated = await server.inject({ method: "GET", url: "/v1/decision-intelligence/alerts" });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
  const noCapability = await server.inject({ method: "GET", url: "/v1/decision-intelligence/alerts", headers: deniedHeaders });
  assert.equal(noCapability.statusCode, 403, noCapability.body);
  const alerts = await server.inject({ method: "GET", url: "/v1/decision-intelligence/alerts", headers: readerHeaders });
  assert.equal(alerts.statusCode, 200, alerts.body);
  assert.deepEqual(alerts.json().map((alert) => alert.id), [fixture.alertId]);

  const crossCompany = await server.inject({ method: "GET", url: `/v1/decision-intelligence/alerts/${fixture.alertId}/evidence`, headers: headers(manager.accessToken, fixture.alternateCompanyId) });
  assert.equal(crossCompany.statusCode, 404, crossCompany.body);
  const crossTenant = await server.inject({ method: "GET", url: "/v1/decision-intelligence/alerts", headers: headers(manager.accessToken, fixture.foreignCompanyId) });
  assert.equal(crossTenant.statusCode, 403, crossTenant.body);

  const evidence = await server.inject({ method: "GET", url: `/v1/decision-intelligence/alerts/${fixture.alertId}/evidence`, headers: readerHeaders });
  assert.equal(evidence.statusCode, 200, evidence.body);
  assert.equal(evidence.json().alert.id, fixture.alertId);
  const missingEvidence = await server.inject({ method: "GET", url: `/v1/decision-intelligence/alerts/${fixture.foreignAlertId}/evidence`, headers: readerHeaders });
  assert.equal(missingEvidence.statusCode, 404, missingEvidence.body);

  const statusKey = `decision-status-${suffix}`;
  const statusPayload = { status: "ACKNOWLEDGED", reason: "Verified lifecycle evidence", idempotencyKey: statusKey };
  const acknowledged = await server.inject({ method: "POST", url: `/v1/decision-intelligence/alerts/${fixture.alertId}/status`, headers: managerHeaders, payload: statusPayload });
  assert.equal(acknowledged.statusCode, 201, acknowledged.body);
  const statusReplay = await server.inject({ method: "POST", url: `/v1/decision-intelligence/alerts/${fixture.alertId}/status`, headers: managerHeaders, payload: statusPayload });
  assert.equal(statusReplay.statusCode, 201, statusReplay.body);
  assert.deepEqual(statusReplay.json(), acknowledged.json(), "Idempotency replay must return the original alert lifecycle receipt.");
  const statusMismatch = await server.inject({ method: "POST", url: `/v1/decision-intelligence/alerts/${fixture.alertId}/status`, headers: managerHeaders, payload: { ...statusPayload, reason: "Different lifecycle reason" } });
  assert.equal(statusMismatch.statusCode, 409, statusMismatch.body);
  assert.equal(statusMismatch.json().error.code, "IDEMPOTENCY_MISMATCH");
  assert.equal(statusMismatch.json().error.retry.kind, "do-not-retry");

  const feedbackKey = `decision-feedback-${suffix}`;
  const feedbackPayload = { alertId: fixture.alertId, kind: "CORRECT", note: "Verifier feedback", idempotencyKey: feedbackKey };
  const feedback = await server.inject({ method: "POST", url: "/v1/decision-intelligence/alerts/feedback", headers: managerHeaders, payload: feedbackPayload });
  assert.equal(feedback.statusCode, 201, feedback.body);
  const feedbackReplay = await server.inject({ method: "POST", url: "/v1/decision-intelligence/alerts/feedback", headers: managerHeaders, payload: feedbackPayload });
  assert.equal(feedbackReplay.statusCode, 201, feedbackReplay.body);
  assert.deepEqual(feedbackReplay.json(), feedback.json(), "Feedback replay must return the original receipt.");

  const noPolicyCapability = await server.inject({ method: "GET", url: "/v1/decision-intelligence/policies/sales-change", headers: readerHeaders });
  assert.equal(noPolicyCapability.statusCode, 403, noPolicyCapability.body);
  const policyKey = `decision-policy-${suffix}`;
  const policyPayload = { enabled: true, decreaseThresholdBasisPoints: 500, increaseThresholdBasisPoints: 500, minimumBaselineAmount: "100.0000", minimumAbsoluteDifferenceAmount: "25.0000", cooldownHours: 24, idempotencyKey: policyKey };
  const policy = await server.inject({ method: "PUT", url: "/v1/decision-intelligence/policies/sales-change", headers: managerHeaders, payload: policyPayload });
  assert.equal(policy.statusCode, 200, policy.body);
  const policyReplay = await server.inject({ method: "PUT", url: "/v1/decision-intelligence/policies/sales-change", headers: managerHeaders, payload: policyPayload });
  assert.equal(policyReplay.statusCode, 200, policyReplay.body);
  assert.deepEqual(policyReplay.json(), policy.json(), "Policy replay must return the original receipt.");
  const policyMismatch = await server.inject({ method: "PUT", url: "/v1/decision-intelligence/policies/sales-change", headers: managerHeaders, payload: { ...policyPayload, cooldownHours: 48 } });
  assert.equal(policyMismatch.statusCode, 409, policyMismatch.body);
  assert.equal(policyMismatch.json().error.code, "IDEMPOTENCY_MISMATCH");
  assert.equal(policyMismatch.json().error.retry.kind, "do-not-retry");

  const database = app.get(DatabaseService);
  const foreignRows = await database.inTenantTransaction(fixture.foreignTenantId, (transaction) => transaction.decisionAlert.count({ where: { id: fixture.alertId } }));
  assert.equal(foreignRows, 0, "Tenant RLS must hide a known decision alert from another tenant.");
  const audit = await database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.auditEvent.findMany({
    where: { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.managerUserId, action: { in: ["decision.alert.acknowledged", "decision.alert.feedback.created", "decision.policy.sales_change.updated"] } },
    select: { action: true },
  }));
  assert.deepEqual(audit.map((event) => event.action).sort(), ["decision.alert.acknowledged", "decision.alert.feedback.created", "decision.policy.sales_change.updated"], "Replays must not duplicate decision audit records.");

  await revokeLatestSession(fixture.readerUserId);
  const revoked = await server.inject({ method: "GET", url: "/v1/decision-intelligence/alerts", headers: readerHeaders });
  assert.equal(revoked.statusCode, 401, revoked.body);

  console.log(`Decision Intelligence HTTP verification passed: 401/403, capability and company/tenant boundaries, revoked sessions, alert/evidence lifecycle, policy and feedback receipts, stable 409 idempotency mismatch receipts, audit non-duplication, and tenant RLS.`);
} finally {
  if (app) await app.close();
  await pool.end();
}

function headers(accessToken, companyId) { return { authorization: `Bearer ${accessToken}`, "x-baseer-company-id": companyId }; }
async function signIn(auth, loginPrefix, password) { return auth.signIn({ tenantCode: `decision-http-${suffix}`, login: `${loginPrefix}-${suffix}@baseer.test`, password, requestId: randomUUID() }); }

async function seedFixture() {
  const tenantCode = `decision-http-${suffix}`;
  const foreignTenantCode = `decision-foreign-${suffix}`;
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)', [fixture.tenantId, tenantCode, `Decision HTTP ${suffix}`, fixture.foreignTenantId, foreignTenantCode, `Decision foreign ${suffix}`]);
  await seedTenant({ tenantId: fixture.tenantId, companyId: fixture.companyId, alternateCompanyId: fixture.alternateCompanyId, tenantCode, foreign: false });
  await seedTenant({ tenantId: fixture.foreignTenantId, companyId: fixture.foreignCompanyId, tenantCode: foreignTenantCode, foreign: true });
}

async function seedTenant({ tenantId, companyId, alternateCompanyId = null, tenantCode, foreign }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const people = foreign
      ? [{ id: randomUUID(), login: `foreign-${suffix}@baseer.test`, password: `Foreign-${suffix}`, role: "foreign", capabilities: ["decision.alerts.read"] }]
      : [
          { id: fixture.managerUserId, login: `manager-${suffix}@baseer.test`, password: `Manager-${suffix}`, role: "manager", capabilities: ["decision.alerts.read", "decision.alerts.manage", "decision.feedback.write", "decision.policy.manage", "decision.context.read", "decision.context.company.manage", "decision.context.global.manage", "decision.metrics.read"] },
          { id: fixture.readerUserId, login: `reader-${suffix}@baseer.test`, password: `Reader-${suffix}`, role: "reader", capabilities: ["decision.alerts.read"] },
          { id: fixture.deniedUserId, login: `denied-${suffix}@baseer.test`, password: `Denied-${suffix}`, role: "denied", capabilities: [] },
        ];
    const roleIds = new Map(people.map((person) => [person.role, randomUUID()]));
    if (alternateCompanyId) {
      await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)', [companyId, tenantId, "شركة القرار", "Decision company", alternateCompanyId, "شركة قرار بديلة", "Alternate decision company"]);
    } else {
      await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [companyId, tenantId, "شركة قرار أجنبية", "Foreign decision company"]);
    }
    for (const person of people) {
      await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [person.id, tenantId, person.login, `مستخدم ${person.role}`, `${person.role} user`, await bcrypt.hash(person.password, 12)]);
      await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)', [roleIds.get(person.role), tenantId, `DECISION_${person.role.toUpperCase()}_${suffix}`, `دور ${person.role}`, `${person.role} role`]);
      await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [tenantId, person.id, companyId, roleIds.get(person.role)]);
      if (!foreign && person.id === fixture.managerUserId) await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [tenantId, person.id, alternateCompanyId, roleIds.get(person.role)]);
      for (const capability of person.capabilities) await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)', [tenantId, roleIds.get(person.role), capability]);
    }
    await insertAlertFixture(client, { tenantId, companyId, alertId: foreign ? fixture.foreignAlertId : fixture.alertId, evidenceId: foreign ? fixture.foreignEvidenceId : fixture.evidenceId, evaluationId: foreign ? fixture.foreignEvaluationId : fixture.evaluationId, actorUserId: people[0].id });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertAlertFixture(client, { tenantId, companyId, alertId, evidenceId, evaluationId, actorUserId }) {
  await client.query('INSERT INTO "DecisionEvidenceSnapshot" ("id", "tenantId", "companyId", "evidenceKind", "verificationStatus", "periodFrom", "periodTo", "payloadJson", "checksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"DecisionEvidenceKind", $5::"DecisionVerificationStatus", $6::date, $7::date, $8::jsonb, $9, $10::uuid)', [evidenceId, tenantId, companyId, "OFFICIAL_FACT", "SYSTEM_RECONCILED", "2026-08-01", "2026-08-31", JSON.stringify({ metricCode: "finance.sales.net.period_comparison", proof: "decision-http-verifier" }), "a".repeat(64), actorUserId]);
  await client.query('INSERT INTO "DecisionEvaluationRun" ("id", "tenantId", "companyId", "ruleCode", "ruleVersion", "periodFrom", "periodTo", "dataQuality", "inputsChecksum", "outcomeJson") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7::date, $8::"DecisionDataQualityStatus", $9, $10::jsonb)', [evaluationId, tenantId, companyId, "decision.http.verifier", "v1", "2026-08-01", "2026-08-31", "READY", "b".repeat(64), JSON.stringify({ result: "fixture" })]);
  await client.query('INSERT INTO "DecisionAlert" ("id", "tenantId", "companyId", "evaluationRunId", "evidenceSnapshotId", "ruleCode", "ruleVersion", "titleAr") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8)', [alertId, tenantId, companyId, evaluationId, evidenceId, "decision.http.verifier", "v1", "تنبيه تحقق القرار"]);
}

async function revokeLatestSession(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    const result = await client.query('UPDATE "AppSession" SET "status" = $3::"SessionStatus", "revokedAt" = now() WHERE "id" = (SELECT "id" FROM "AppSession" WHERE "tenantId" = $1::uuid AND "userId" = $2::uuid ORDER BY "createdAt" DESC LIMIT 1) RETURNING "id"', [fixture.tenantId, userId, "REVOKED"]);
    assert.equal(result.rowCount, 1, "Verifier must revoke the signed-in session.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
