import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured through apps/api/.env.baseer-test.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const fixture = { tenantId: randomUUID(), companyId: randomUUID(), otherCompanyId: randomUUID(), actorUserId: randomUUID() };
const context = { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.actorUserId };
let app;

try {
  await seed();
  const [{ AppModule }, { DatabaseService }, { MarketingService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/database/database.service.js"),
    import("../apps/api/dist/marketing/marketing.service.js"),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const marketing = app.get(MarketingService);
  const request = { titleAr: "حملة تحقق", titleEn: "Verification campaign", platform: "MANUAL", status: "PLANNED", startsOn: "2026-08-01", endsOn: "2026-08-31", objective: "اختبار العزل", idempotencyKey: randomUUID() };
  const created = await marketing.createCampaign(context, request);
  const replayed = await marketing.createCampaign(context, request);
  assert.equal(replayed.id, created.id, "A matching idempotency request must replay the original campaign receipt.");
  assert.equal(replayed.replayed, true, "A matching idempotency request must be marked replayed.");
  await assert.rejects(() => marketing.createCampaign(context, { ...request, titleAr: "طلب مختلف" }), /different marketing request/i, "A reused key with another payload must be rejected.");
  const workspace = await marketing.workspace(context);
  assert.equal(workspace.campaigns.length, 1, "The company register must return its campaign.");
  assert.equal(workspace.readiness.every((entry) => entry.status === "NOT_CONNECTED"), true, "Provider readiness must not masquerade as a zero metric.");
  assert.equal(workspace.replyPolicy.executionReadiness, "NOT_CONNECTED", "Saving reply configuration must not imply a live publisher.");
  const replyPolicyRequest = { automationStatus: "ENABLED", authoringMethod: "TEMPLATE", tone: "WARM", languageMode: "MATCH_REVIEW", autoFourFiveEnabled: true, autoThreeIfSafe: true, signature: "فريق الشركة", idempotencyKey: randomUUID() };
  const policyCreated = await marketing.updateReputationReplyPolicy(context, replyPolicyRequest);
  const policyReplayed = await marketing.updateReputationReplyPolicy(context, replyPolicyRequest);
  assert.equal(policyReplayed.id, policyCreated.id, "A matching reply policy request must replay its receipt.");
  assert.equal(policyReplayed.replayed, true, "A matching reply policy request must be marked replayed.");
  const policyWorkspace = await marketing.workspace(context);
  assert.equal(policyWorkspace.replyPolicy.automationStatus, "ENABLED", "The company policy must retain its selected automation state.");
  assert.equal(policyWorkspace.replyPolicy.executionReadiness, "NOT_CONNECTED", "A configured policy must still report no live Google execution.");
  const otherPolicyWorkspace = await marketing.workspace({ ...context, companyId: fixture.otherCompanyId });
  assert.equal(otherPolicyWorkspace.replyPolicy.automationStatus, "DISABLED", "A company must not read another company's reply policy.");
  await assert.rejects(() => marketing.updateCampaign({ ...context, companyId: fixture.otherCompanyId }, created.id, { ...request, idempotencyKey: randomUUID(), titleAr: "محاولة شركة أخرى" }), /not found/i, "A company must not update another company's campaign.");
  await marketing.archiveCampaign(context, { campaignId: created.id, reason: "اختبار دورة الحياة", idempotencyKey: randomUUID() });
  const archived = await marketing.workspace(context);
  assert.equal(archived.campaigns[0]?.status, "ARCHIVED", "Archiving must preserve a campaign record.");
  const [auditCount, journalCount] = await database.inTenantTransaction(fixture.tenantId, async (tx) => Promise.all([
    tx.auditEvent.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, action: { startsWith: "marketing." } } }),
    tx.financeJournalEntry.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
  ]));
  assert.ok(auditCount >= 3, "Marketing create, reply policy and archive must be audited.");
  assert.equal(journalCount, 0, "Marketing Gate A1 must not create financial journal entries.");
  console.log(JSON.stringify({ ok: true, verified: ["company_scope", "idempotency_replay", "idempotency_mismatch", "archive_history", "reply_policy", "reply_policy_replay", "audit", "no_finance_posting", "honest_provider_readiness"] }));
} finally {
  await app?.close();
  await pool.end();
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, `marketing-${fixture.tenantId.slice(0, 8)}`, "Marketing verification tenant"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [fixture.actorUserId, fixture.tenantId, `marketing-${fixture.actorUserId.slice(0, 8)}@baseer.test`, "مالك تحقق التسويق", "Marketing verification owner", "verification-only"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)', [fixture.companyId, fixture.tenantId, "شركة تحقق التسويق", "Marketing verification company", fixture.otherCompanyId, "شركة عزل أخرى", "Other isolation company"]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
