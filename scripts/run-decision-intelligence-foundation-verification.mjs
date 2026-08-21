import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for decision-intelligence verification.");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const tables = ["DecisionMetricDefinition", "DecisionRuleDefinition", "DecisionContextSource", "DecisionContextImportRun", "DecisionGlobalContextEvent", "DecisionGlobalContextEventRevision", "DecisionCompanyContextEvent", "DecisionEvaluationRun", "DecisionEvidenceSnapshot", "DecisionAlert", "DecisionFeedback"];
  const rls = await client.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])`, [tables]);
  assert.equal(rls.rowCount, tables.length, "Every decision table must exist.");
  for (const row of rls.rows) assert.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} must have FORCE RLS.`);
  const migration = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL`, [["20260821170000_decision_intelligence_foundation", "20260821171000_decision_rule_definitions", "20260821173000_decision_context_import_runs"]]);
  assert.equal(migration.rowCount, 3, "Decision foundation migrations must be recorded.");

  const tenantId = randomUUID();
  const companyId = randomUUID();
  const userId = randomUUID();
  const snapshotId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [tenantId, `decision-${tenantId.slice(0, 8)}`, "Decision verification"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [userId, tenantId, `decision-${tenantId.slice(0, 8)}@baseer.test`, "مدقق القرار", "Decision verifier", "verification-only"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [companyId, tenantId, "شركة تحقق القرار", "Decision verification company"]);
    await client.query('INSERT INTO "DecisionEvidenceSnapshot" ("id", "tenantId", "companyId", "evidenceKind", "verificationStatus", "periodFrom", "periodTo", "payloadJson", "checksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"DecisionEvidenceKind", $5::"DecisionVerificationStatus", $6::date, $7::date, $8::jsonb, $9, $10::uuid)', [snapshotId, tenantId, companyId, "OFFICIAL_FACT", "SYSTEM_RECONCILED", "2026-08-01", "2026-08-01", JSON.stringify({ metricCode: "finance.sales.net.daily" }), "a".repeat(64), userId]);
    await assert.rejects(() => client.query('UPDATE "DecisionEvidenceSnapshot" SET "checksum" = $2 WHERE "id" = $1::uuid', [snapshotId, "b".repeat(64)]), (error) => error?.code === "P0001", "Evidence snapshots must be append-only.");
  } finally {
    await client.query("ROLLBACK");
  }
  console.log("Decision Intelligence foundation verification passed: migration, RLS and append-only evidence are active.");
} finally {
  await client.end();
}
