import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

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
  tenantId: randomUUID(), foreignTenantId: randomUUID(), companyId: randomUUID(), alternateCompanyId: randomUUID(), foreignCompanyId: randomUUID(),
  reporterUserId: randomUUID(), previewUserId: randomUUID(), readerUserId: randomUUID(), deniedUserId: randomUUID(), foreignUserId: randomUUID(),
  reportRunId: randomUUID(), previewRunId: randomUUID(), foreignRunId: randomUUID(), reporterDocumentId: randomUUID(), previewDocumentId: randomUUID(),
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = `reports-http-${suffix}`;
  const [{ AppModule }, { ApiExceptionFilter }, { AuthService }, { DatabaseService }, { ReportRunService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/common/api-exception.filter.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/database/database.service.js"),
    import("../apps/api/dist/reports/report-run.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  const auth = app.get(AuthService);
  const [reporter, previewOnly, reader, denied] = await Promise.all([
    signIn(auth, "reporter", `Reporter-${suffix}`), signIn(auth, "preview", `Preview-${suffix}`), signIn(auth, "reader", `Reader-${suffix}`),
    signIn(auth, "denied", `Denied-${suffix}`),
  ]);
  const server = app.getHttpAdapter().getInstance();
  const reporterHeaders = headers(reporter.accessToken, fixture.companyId);
  const previewHeaders = headers(previewOnly.accessToken, fixture.companyId);
  const readerHeaders = headers(reader.accessToken, fixture.companyId);
  const deniedHeaders = headers(denied.accessToken, fixture.companyId);

  const unauthenticated = await server.inject({ method: "GET", url: "/v1/reports/catalogue" });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
  const withoutReportsRead = await server.inject({ method: "GET", url: "/v1/reports/catalogue", headers: deniedHeaders });
  assert.equal(withoutReportsRead.statusCode, 403, withoutReportsRead.body);
  const catalogue = await server.inject({ method: "GET", url: "/v1/reports/catalogue", headers: readerHeaders });
  assert.equal(catalogue.statusCode, 200, catalogue.body);

  const crossCompany = await server.inject({ method: "GET", url: "/v1/reports/catalogue", headers: headers(reader.accessToken, fixture.alternateCompanyId) });
  assert.equal(crossCompany.statusCode, 403, crossCompany.body);
  const crossTenant = await server.inject({ method: "GET", url: "/v1/reports/catalogue", headers: headers(reporter.accessToken, fixture.foreignCompanyId) });
  assert.equal(crossTenant.statusCode, 403, crossTenant.body);

  const officialRunBody = { reportCode: "personal_cash_performance", purpose: "evidence", request: { from: "2026-08-01", to: "2026-08-20", vatInclusive: true } };
  const officialUnauthenticated = await server.inject({ method: "POST", url: "/v1/reports/official-runs", payload: officialRunBody });
  assert.equal(officialUnauthenticated.statusCode, 401, officialUnauthenticated.body);
  const officialEvidence = await server.inject({ method: "POST", url: "/v1/reports/official-runs", headers: readerHeaders, payload: officialRunBody });
  assert.equal(officialEvidence.statusCode, 201, officialEvidence.body);
  assert.equal(officialEvidence.json().reportCode, "personal_cash_performance");
  assert.equal(officialEvidence.json().ledgerRevision, "41");
  // Dashboard drill-downs are live reads. This confirms the literal /live
  // route is never consumed by the legacy :reportRunId route and does not
  // create an output snapshot just to show operations on screen.
  const liveEvidence = await server.inject({ method: "GET", url: "/v1/reports/personal-cash-performance/live/evidence?from=2026-08-01&to=2026-08-20&vatInclusive=true&rowCode=expenses%3Acategory%3Arent", headers: readerHeaders });
  assert.equal(liveEvidence.statusCode, 200, liveEvidence.body);
  assert.equal(liveEvidence.json().rowCode, "expenses:category:rent");
  assert.equal("reportRunId" in liveEvidence.json(), false, "Live evidence must not require or disclose an output snapshot.");
  const officialPreviewDenied = await server.inject({ method: "POST", url: "/v1/reports/official-runs", headers: readerHeaders, payload: { ...officialRunBody, purpose: "preview" } });
  assert.equal(officialPreviewDenied.statusCode, 403, officialPreviewDenied.body);
  for (const payload of [
    { reportCode: "ledger_trial_balance", purpose: "evidence", request: { from: "2026-08-01", to: "2026-08-20", includeZeroRows: false } },
    { reportCode: "internal_vat_report", purpose: "evidence", request: { from: "2026-08-01", to: "2026-08-20" } },
  ]) {
    const issued = await server.inject({ method: "POST", url: "/v1/reports/official-runs", headers: readerHeaders, payload });
    assert.equal(issued.statusCode, 201, issued.body);
    assert.equal(issued.json().reportCode, payload.reportCode);
  }

  const ownDocuments = await server.inject({ method: "GET", url: "/v1/reports/documents?locale=en", headers: reporterHeaders });
  assert.equal(ownDocuments.statusCode, 200, ownDocuments.body);
  assert.deepEqual(ownDocuments.json().documents.map((document) => document.id), [fixture.reporterDocumentId]);
  const actorScopedDocuments = await server.inject({ method: "GET", url: "/v1/reports/documents?locale=en", headers: readerHeaders });
  assert.equal(actorScopedDocuments.statusCode, 200, actorScopedDocuments.body);
  assert.deepEqual(actorScopedDocuments.json().documents, [], "Report documents must be scoped to their creating actor.");

  const noPreviewCapability = await server.inject({ method: "POST", url: `/v1/reports/documents/${fixture.reporterDocumentId}/render`, headers: readerHeaders, payload: { format: "preview" } });
  assert.equal(noPreviewCapability.statusCode, 403, noPreviewCapability.body);
  const crossActorDocument = await server.inject({ method: "POST", url: `/v1/reports/documents/${fixture.reporterDocumentId}/render`, headers: previewHeaders, payload: { format: "preview" } });
  assert.equal(crossActorDocument.statusCode, 404, crossActorDocument.body);
  const preview = await server.inject({ method: "POST", url: `/v1/reports/documents/${fixture.previewDocumentId}/render`, headers: previewHeaders, payload: { format: "preview" } });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().format, "preview");
  assert.match(preview.json().content, /Verifier ledger/i);
  const noExportCapability = await server.inject({ method: "POST", url: `/v1/reports/documents/${fixture.previewDocumentId}/render`, headers: previewHeaders, payload: { format: "xlsx" } });
  assert.equal(noExportCapability.statusCode, 403, noExportCapability.body);
  const exported = await server.inject({ method: "POST", url: `/v1/reports/documents/${fixture.reporterDocumentId}/render`, headers: reporterHeaders, payload: { format: "xlsx" } });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.equal(exported.json().format, "xlsx");
  assert.equal(exported.json().contentEncoding, "base64");

  const evidenceUrl = `/v1/reports/ledger-trial-balance/${fixture.reportRunId}/evidence?accountId=${randomUUID()}&scope=PERIOD`;
  const sourceUrl = `/v1/reports/ledger-trial-balance/${fixture.reportRunId}/evidence/${randomUUID()}/source?accountId=${randomUUID()}&scope=PERIOD`;
  const evidenceCrossCompany = await server.inject({ method: "GET", url: evidenceUrl, headers: headers(reporter.accessToken, fixture.alternateCompanyId) });
  assert.equal(evidenceCrossCompany.statusCode, 403, evidenceCrossCompany.body);
  const sourceCrossTenant = await server.inject({ method: "GET", url: sourceUrl, headers: headers(reporter.accessToken, fixture.foreignCompanyId) });
  assert.equal(sourceCrossTenant.statusCode, 403, sourceCrossTenant.body);

  const database = app.get(DatabaseService);
  const reportRuns = app.get(ReportRunService);
  const frozen = await reportRuns.findReady({ tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.reporterUserId }, fixture.reportRunId);
  assert.equal(frozen.ledgerRevision, BigInt(41));
  const checksum = frozen.checksum;
  await database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.financeLedgerRevision.update({
    where: { tenantId_companyId: { tenantId: fixture.tenantId, companyId: fixture.companyId } }, data: { currentRevision: BigInt(42) },
  }));
  const afterRevisionAdvance = await reportRuns.findReady({ tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.reporterUserId }, fixture.reportRunId);
  assert.equal(afterRevisionAdvance.ledgerRevision, BigInt(41), "A report run must retain its frozen ledger revision.");
  assert.equal(afterRevisionAdvance.checksum, checksum, "A report run checksum must remain frozen.");
  await database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.reportRun.update({ where: { id: fixture.reportRunId }, data: { status: 'EXPIRED' } }));
  const expiredRun = await server.inject({ method: "POST", url: "/v1/reports/documents/render", headers: reporterHeaders, payload: { reportRunId: fixture.reportRunId, locale: "en", format: "xlsx" } });
  assert.equal(expiredRun.statusCode, 404, expiredRun.body);
  assert.equal(expiredRun.json().error.code, "REPORT_RUN_EXPIRED", expiredRun.body);
  const foreignRows = await database.inTenantTransaction(fixture.foreignTenantId, (transaction) => transaction.reportRun.count({ where: { id: fixture.reportRunId } }));
  assert.equal(foreignRows, 0, "Tenant RLS must hide report runs from another tenant even when IDs are known.");

  console.log("Reports HTTP verification passed: 401/403, official-run purpose RBAC, company/tenant isolation, actor-scoped documents, preview/export permissions, evidence/source boundaries, report-run expiry receipt, RLS, and frozen revision/checksum.");
} finally {
  if (app) await app.close();
  await pool.end();
}

function headers(accessToken, companyId) { return { authorization: `Bearer ${accessToken}`, "x-baseer-company-id": companyId }; }
async function signIn(auth, loginPrefix, password, tenantCode = `reports-http-${suffix}`) {
  return auth.signIn({ tenantCode, login: `${loginPrefix}-${suffix}@baseer.test`, password, requestId: randomUUID() });
}

async function seedFixture() {
  const tenantCode = `reports-http-${suffix}`;
  const foreignTenantCode = `reports-foreign-${suffix}`;
  await pool.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)', [fixture.tenantId, tenantCode, `Reports HTTP ${suffix}`, fixture.foreignTenantId, foreignTenantCode, `Reports foreign ${suffix}`]);
  await seedTenant({ tenantId: fixture.tenantId, companyId: fixture.companyId, alternateCompanyId: fixture.alternateCompanyId, tenantCode, includeReportFixtures: true });
  await seedTenant({ tenantId: fixture.foreignTenantId, companyId: fixture.foreignCompanyId, tenantCode: foreignTenantCode, foreign: true, includeReportFixtures: true });
}

async function seedTenant({ tenantId, companyId, alternateCompanyId = null, tenantCode, foreign = false, includeReportFixtures }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const people = foreign
      ? [{ id: fixture.foreignUserId, login: `foreign-${suffix}@baseer.test`, password: `Foreign-${suffix}`, role: "foreign", capabilities: ["reports.read"] }]
      : [
          { id: fixture.reporterUserId, login: `reporter-${suffix}@baseer.test`, password: `Reporter-${suffix}`, role: "reporter", capabilities: ["reports.read", "platform.output.preview", "platform.output.export"] },
          { id: fixture.previewUserId, login: `preview-${suffix}@baseer.test`, password: `Preview-${suffix}`, role: "preview", capabilities: ["reports.read", "platform.output.preview"] },
          { id: fixture.readerUserId, login: `reader-${suffix}@baseer.test`, password: `Reader-${suffix}`, role: "reader", capabilities: ["reports.read"] },
          { id: fixture.deniedUserId, login: `denied-${suffix}@baseer.test`, password: `Denied-${suffix}`, role: "denied", capabilities: [] },
        ];
    const roleIds = new Map(people.map((person) => [person.role, randomUUID()]));
    const companyValues = alternateCompanyId
      ? [companyId, tenantId, "شركة التقارير", "Reports company", alternateCompanyId, tenantId, "شركة بديلة", "Alternate company"]
      : [companyId, tenantId, "شركة أجنبية", "Foreign company"];
    const companySql = alternateCompanyId
      ? 'INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $6::uuid, $7, $8)'
      : 'INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)';
    await client.query(companySql, companyValues);
    for (const person of people) {
      await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [person.id, tenantId, person.login, `مستخدم ${person.role}`, `${person.role} user`, await bcrypt.hash(person.password, 12)]);
      await client.query('INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)', [roleIds.get(person.role), tenantId, `REPORTS_${person.role.toUpperCase()}_${suffix}`, `دور ${person.role}`, `${person.role} role`]);
      await client.query('INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)', [tenantId, person.id, companyId, roleIds.get(person.role)]);
      for (const capability of person.capabilities) await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)', [tenantId, roleIds.get(person.role), capability]);
    }
    if (includeReportFixtures) {
      const actorId = foreign ? fixture.foreignUserId : fixture.reporterUserId;
      const primaryRunId = foreign ? fixture.foreignRunId : fixture.reportRunId;
      await insertReportRun(client, { tenantId, companyId, id: primaryRunId, actorId, revision: 41 });
      if (!foreign) {
        await insertReportRun(client, { tenantId, companyId, id: fixture.previewRunId, actorId: fixture.previewUserId, revision: 41 });
        await insertDocument(client, { tenantId, companyId, id: fixture.reporterDocumentId, reportRunId: fixture.reportRunId, actorId: fixture.reporterUserId });
        await insertDocument(client, { tenantId, companyId, id: fixture.previewDocumentId, reportRunId: fixture.previewRunId, actorId: fixture.previewUserId });
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertReportRun(client, { tenantId, companyId, id, actorId, revision }) {
  const canonicalOptions = { from: "2026-08-01", to: "2026-08-31", includeZeroRows: false };
  const sourceCoverage = { source: "reports-http-verifier", sealed: true };
  const checksum = reportRunChecksum({ canonicalOptions, sourceCoverage, revision });
  await client.query('INSERT INTO "FinanceLedgerRevision" ("tenantId", "companyId", "currentRevision") VALUES ($1::uuid, $2::uuid, $3::bigint) ON CONFLICT ("tenantId", "companyId") DO NOTHING', [tenantId, companyId, revision]);
  await client.query('INSERT INTO "ReportRun" ("id", "tenantId", "companyId", "reportCode", "definitionVersion", "canonicalOptionsJson", "economicAsOfDate", "ledgerRevision", "eligibleEntryPredicateVersion", "sourceCoverageJson", "checksum", "expiresAt", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7::date, $8::bigint, $9, $10::jsonb, $11, $12::timestamptz, $13::uuid)', [id, tenantId, companyId, "ledger_trial_balance", "ledger_trial_balance_v1", JSON.stringify(canonicalOptions), "2026-08-31", revision, "sealed_posted_or_reversed_v1", JSON.stringify(sourceCoverage), checksum, "2099-01-01T00:00:00.000Z", actorId]);
}

async function insertDocument(client, { tenantId, companyId, id, reportRunId, actorId }) {
  const snapshot = { snapshotId: id, reportCode: "ledger_trial_balance", templateVersion: "ledger_trial_balance_v1", title: "Verifier ledger", direction: "ltr", locale: "en", generatedAtRiyadh: "2026-08-23T00:00:00.000+03:00", companies: [{ id: companyId, name: "Reports company" }], periodLabel: "2026-08", taxPresentation: "taxSeparated", columns: [{ key: "account", label: "Account", kind: "text" }], rows: [{ account: "Cash" }], sourceLabel: "sealed ledger" };
  await client.query('INSERT INTO "ReportDocument" ("id", "tenantId", "companyId", "reportRunId", "reportCode", "locale", "titleAr", "titleEn", "snapshotJson", "snapshotChecksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::jsonb, $10, $11::uuid)', [id, tenantId, companyId, reportRunId, "ledger_trial_balance", "en", "ميزان المراجعة", "Trial Balance", JSON.stringify(snapshot), hash(snapshot), actorId]);
}

function reportRunChecksum({ canonicalOptions, sourceCoverage, revision }) {
  return createHash("sha256").update(JSON.stringify({ policyVersion: "REPORTING_R0_B_2026_08_20", predicateVersion: "sealed_posted_or_reversed_v1", reportCode: "ledger_trial_balance", definitionVersion: "ledger_trial_balance_v1", canonicalOptions, economicAsOfDate: "2026-08-31", ledgerRevision: String(revision), sourceCoverage, projectionWatermark: null, accountMappingVersionId: null, accountMappingChecksum: null })).digest("hex");
}
function hash(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value !== "object") throw new Error("Fixture report snapshot must be JSON.");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
