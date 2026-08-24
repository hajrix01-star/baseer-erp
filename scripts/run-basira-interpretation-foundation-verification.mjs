import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Basira interpretation verification.");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const tables = ["AiInterpretation", "AiInterpretationRun", "AiInterpretationPlacement", "AiHumanInsight", "AiBudgetReservation", "AiUsageLedger", "AiSkillEvaluationRun"];
  const rls = await client.query(
    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])",
    [tables],
  );
  assert.equal(rls.rowCount, tables.length, "Every interpretation table must exist.");
  for (const row of rls.rows) {
    assert.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} must have FORCE RLS.`);
  }
  const databaseRole = await client.query("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user");
  assert.equal(databaseRole.rows[0]?.rolbypassrls, false, "The verification must run as a non-BYPASSRLS database role.");
  const migration = await client.query(
    "SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL",
    ["20260824190000_basira_interpretation_foundation"],
  );
  assert.equal(migration.rowCount, 1, "The Basira interpretation migration must be recorded.");
  const centerMigration = await client.query(
    "SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL",
    ["20260824200000_basira_interpretation_center"],
  );
  assert.equal(centerMigration.rowCount, 1, "The Basira interpretation centre migration must be recorded.");
  const lineageMigration = await client.query(
    "SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL",
    ["20260824201000_basira_human_insight_lineage_guard"],
  );
  assert.equal(lineageMigration.rowCount, 1, "The Basira human-insight lineage hardening migration must be recorded.");
  const consumptionMigration = await client.query(
    "SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL",
    ["20260824210000_basira_consumption_guard"],
  );
  assert.equal(consumptionMigration.rowCount, 1, "The Basira consumption-guard migration must be recorded.");
  const evaluationMigration = await client.query(
    "SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL",
    ["20260824220000_basira_skill_evaluation_foundation"],
  );
  assert.equal(evaluationMigration.rowCount, 1, "The Basira skill-evaluation migration must be recorded.");
  const priceRls = await client.query(
    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'AiModelPriceRevision'",
  );
  assert.equal(priceRls.rows[0]?.relrowsecurity, true, "The price revision catalogue must have RLS enabled.");
  assert.equal(priceRls.rows[0]?.relforcerowsecurity, true, "The price revision catalogue must FORCE RLS.");
  const pendingIndex = await client.query(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'AiInterpretationRun_one_pending_per_reuse_key'",
  );
  assert.match(pendingIndex.rows[0]?.indexdef ?? "", /WHERE \(status = 'PENDING'/, "Single-flight must use a partial PENDING unique index.");

  const tenantId = randomUUID();
  const companyId = randomUUID();
  const userId = randomUUID();
  const snapshotId = randomUUID();
  const receiptId = randomUUID();
  const interpretationId = randomUUID();
  const runId = randomUUID();
  const humanInsightId = randomUUID();
  const secondInterpretationId = randomUUID();
  const selfReferencingInsightId = randomUUID();
  const crossInterpretationInsightId = randomUUID();
  const correctionInsightId = randomUUID();
  const draftWithdrawalInsightId = randomUUID();
  const providerConfigurationId = randomUUID();
  const activationId = randomUUID();
  const reservationId = randomUUID();
  const ledgerId = randomUUID();
  const evaluationRunId = randomUUID();
  const checksum = "a".repeat(64);
  const outputChecksum = "b".repeat(64);
  const reuseKey = "c".repeat(64);

  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [tenantId, `basira-${tenantId.slice(0, 8)}`, "Basira interpretation verification"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [userId, tenantId, `basira-${tenantId.slice(0, 8)}@baseer.test`, "مدقق بصيرة", "Basira verifier", "verification-only"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [companyId, tenantId, "شركة تحقق بصيرة", "Basira verification company"]);
    await client.query('INSERT INTO "DecisionEvidenceSnapshot" ("id", "tenantId", "companyId", "evidenceKind", "verificationStatus", "periodFrom", "periodTo", "payloadJson", "checksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"DecisionEvidenceKind", $5::"DecisionVerificationStatus", $6::date, $7::date, $8::jsonb, $9, $10::uuid)', [snapshotId, tenantId, companyId, "OFFICIAL_FACT", "SYSTEM_RECONCILED", "2026-08-01", "2026-08-01", JSON.stringify({ schemaVersion: "verification" }), checksum, userId]);
    await client.query('INSERT INTO "AiExecutionReceipt" ("id", "tenantId", "companyId", "evidenceSnapshotId", "moduleKey", "capability", "skillKey", "skillVersion", "policyVersion", "outcome", "promptVersion", "inputChecksum", "outputChecksum", "requestId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::"AiExecutionOutcome", $11, $12, $13, $14)', [receiptId, tenantId, companyId, snapshotId, "decision-intelligence", "platform.ai.use", "verification.skill", 1, 1, "SUCCEEDED", 1, checksum, outputChecksum, "basira-interpretation-verification"]);
    await client.query('INSERT INTO "AiInterpretation" ("id", "tenantId", "companyId", "subjectKind", "subjectId", "evidenceSnapshotId", "evidenceChecksum", "reuseKey", "skillKey", "skillVersion", "policyVersion", "promptVersion", "language", "companyContextDigest", "modelProfileDigest", "providerSnapshot", "modelSnapshot", "sourceExecutionReceiptId", "encryptedOutput", "outputIv", "outputTag", "outputKeyVersion", "outputChecksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"AiInterpretationSubjectKind", $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::"AiProviderKind", $17, $18::uuid, $19, $20, $21, $22, $23, $24::uuid)', [interpretationId, tenantId, companyId, "DECISION_ALERT", randomUUID(), snapshotId, checksum, reuseKey, "verification.skill", 1, 1, 1, "ar", "d".repeat(64), "e".repeat(64), "OPENAI_COMPATIBLE", "verification-model", receiptId, "ciphertext", "iv", "tag", 1, outputChecksum, userId]);
    const foreignTenantId = randomUUID();
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [foreignTenantId]);
    const crossTenantRead = await client.query('SELECT "id" FROM "AiInterpretation" WHERE "id" = $1::uuid', [interpretationId]);
    assert.equal(crossTenantRead.rowCount, 0, "A non-BYPASSRLS role must not read another tenant's interpretation.");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query('INSERT INTO "AiHumanInsight" ("id", "tenantId", "companyId", "interpretationId", "kind", "encryptedStatement", "statementIv", "statementTag", "statementKeyVersion", "statementChecksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"AiHumanInsightKind", $6, $7, $8, $9, $10, $11::uuid)', [humanInsightId, tenantId, companyId, interpretationId, "DECISION", "ciphertext", "iv", "tag", 1, "f".repeat(64), userId]);
    await client.query("SAVEPOINT human_insight_self_lineage");
    await assert.rejects(
      () => client.query('INSERT INTO "AiHumanInsight" ("id", "tenantId", "companyId", "interpretationId", "kind", "encryptedStatement", "statementIv", "statementTag", "statementKeyVersion", "statementChecksum", "supersedesInsightId", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"AiHumanInsightKind", $6, $7, $8, $9, $10, $1::uuid, $11::uuid)', [selfReferencingInsightId, tenantId, companyId, interpretationId, "NOTE", "ciphertext", "iv", "tag", 1, "1".repeat(64), userId]),
      (error) => error?.code === "P0001",
      "A human insight cannot supersede itself.",
    );
    await client.query("ROLLBACK TO SAVEPOINT human_insight_self_lineage");
    await client.query('INSERT INTO "AiInterpretation" ("id", "tenantId", "companyId", "subjectKind", "subjectId", "evidenceSnapshotId", "evidenceChecksum", "reuseKey", "skillKey", "skillVersion", "policyVersion", "promptVersion", "language", "companyContextDigest", "modelProfileDigest", "providerSnapshot", "modelSnapshot", "sourceExecutionReceiptId", "encryptedOutput", "outputIv", "outputTag", "outputKeyVersion", "outputChecksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"AiInterpretationSubjectKind", $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::"AiProviderKind", $17, $18::uuid, $19, $20, $21, $22, $23, $24::uuid)', [secondInterpretationId, tenantId, companyId, "DECISION_ALERT", randomUUID(), snapshotId, checksum, "1".repeat(64), "verification.skill", 1, 1, 1, "ar", "d".repeat(64), "e".repeat(64), "OPENAI_COMPATIBLE", "verification-model", receiptId, "ciphertext", "iv", "tag", 1, outputChecksum, userId]);
    await client.query("SAVEPOINT human_insight_cross_interpretation_lineage");
    await assert.rejects(
      () => client.query('INSERT INTO "AiHumanInsight" ("id", "tenantId", "companyId", "interpretationId", "kind", "encryptedStatement", "statementIv", "statementTag", "statementKeyVersion", "statementChecksum", "supersedesInsightId", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"AiHumanInsightKind", $6, $7, $8, $9, $10, $11::uuid, $12::uuid)', [crossInterpretationInsightId, tenantId, companyId, secondInterpretationId, "NOTE", "ciphertext", "iv", "tag", 1, "2".repeat(64), humanInsightId, userId]),
      (error) => error?.code === "P0001",
      "A correction cannot cross into another interpretation.",
    );
    await client.query("ROLLBACK TO SAVEPOINT human_insight_cross_interpretation_lineage");
    await client.query('INSERT INTO "AiHumanInsight" ("id", "tenantId", "companyId", "interpretationId", "kind", "encryptedStatement", "statementIv", "statementTag", "statementKeyVersion", "statementChecksum", "supersedesInsightId", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"AiHumanInsightKind", $6, $7, $8, $9, $10, $11::uuid, $12::uuid)', [correctionInsightId, tenantId, companyId, interpretationId, "NOTE", "ciphertext", "iv", "tag", 1, "3".repeat(64), humanInsightId, userId]);
    await client.query('UPDATE "AiHumanInsight" SET "status" = $2::"AiHumanInsightStatus", "approvedByUserId" = $3::uuid, "approvedAt" = CURRENT_TIMESTAMP WHERE "id" = $1::uuid', [humanInsightId, "APPROVED", userId]);
    await client.query("SAVEPOINT human_insight_content_immutable");
    await assert.rejects(
      () => client.query('UPDATE "AiHumanInsight" SET "encryptedStatement" = $2 WHERE "id" = $1::uuid', [humanInsightId, "tampered"]),
      (error) => error?.code === "P0001",
      "Human-insight content must be immutable after approval.",
    );
    await client.query("ROLLBACK TO SAVEPOINT human_insight_content_immutable");
    await client.query('INSERT INTO "AiHumanInsight" ("id", "tenantId", "companyId", "interpretationId", "kind", "encryptedStatement", "statementIv", "statementTag", "statementKeyVersion", "statementChecksum", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"AiHumanInsightKind", $6, $7, $8, $9, $10, $11::uuid)', [draftWithdrawalInsightId, tenantId, companyId, interpretationId, "NOTE", "ciphertext", "iv", "tag", 1, "4".repeat(64), userId]);
    await client.query("SAVEPOINT human_insight_draft_withdrawal_metadata");
    await assert.rejects(
      () => client.query('UPDATE "AiHumanInsight" SET "status" = $2::"AiHumanInsightStatus", "approvedByUserId" = $3::uuid, "approvedAt" = CURRENT_TIMESTAMP, "revokedByUserId" = $3::uuid, "revokedAt" = CURRENT_TIMESTAMP, "revocationReason" = $4 WHERE "id" = $1::uuid', [draftWithdrawalInsightId, "REVOKED", userId, "withdrawn before approval"]),
      (error) => error?.code === "P0001",
      "A withdrawn draft cannot acquire approval metadata.",
    );
    await client.query("ROLLBACK TO SAVEPOINT human_insight_draft_withdrawal_metadata");
    await client.query("SAVEPOINT human_insight_approved_withdrawal_metadata");
    await assert.rejects(
      () => client.query('UPDATE "AiHumanInsight" SET "status" = $2::"AiHumanInsightStatus", "approvedByUserId" = NULL, "approvedAt" = NULL, "revokedByUserId" = $3::uuid, "revokedAt" = CURRENT_TIMESTAMP, "revocationReason" = $4 WHERE "id" = $1::uuid', [humanInsightId, "REVOKED", userId, "tampered approval"]),
      (error) => error?.code === "P0001",
      "Withdrawing an approved insight must retain its approval receipt.",
    );
    await client.query("ROLLBACK TO SAVEPOINT human_insight_approved_withdrawal_metadata");
    await client.query('UPDATE "AiHumanInsight" SET "status" = $2::"AiHumanInsightStatus", "revokedByUserId" = $3::uuid, "revokedAt" = CURRENT_TIMESTAMP, "revocationReason" = $4 WHERE "id" = $1::uuid', [humanInsightId, "REVOKED", userId, "verification withdrawal"]);
    await client.query("SAVEPOINT human_insight_final_immutable");
    await assert.rejects(
      () => client.query('UPDATE "AiHumanInsight" SET "revocationReason" = $2 WHERE "id" = $1::uuid', [humanInsightId, "tampered"]),
      (error) => error?.code === "P0001",
      "Revoked human insights must be immutable.",
    );
    await client.query("ROLLBACK TO SAVEPOINT human_insight_final_immutable");
    await client.query('INSERT INTO "AiInterpretationRun" ("id", "tenantId", "companyId", "reuseKey", "status", "leaseExpiresAt", "claimedByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::"AiInterpretationRunStatus", CURRENT_TIMESTAMP + INTERVAL \'1 minute\', $6::uuid)', [runId, tenantId, companyId, reuseKey, "PENDING", userId]);
    const price = await client.query('SELECT "id" FROM "AiModelPriceRevision" WHERE "provider" = $1::"AiProviderKind" AND "model" = $2 ORDER BY "effectiveFrom" DESC LIMIT 1', ["OPENAI_COMPATIBLE", "gpt-5-mini"]);
    assert.equal(price.rowCount, 1, "The code-owned gpt-5-mini price revision must be available.");
    await client.query('INSERT INTO "AiProviderConfiguration" ("id", "tenantId", "provider", "model", "status", "dailyRequestLimit", "dailyCostLimit", "encryptedCredential", "credentialIv", "credentialTag") VALUES ($1::uuid, $2::uuid, $3::"AiProviderKind", $4, $5::"AiProviderConfigurationStatus", $6, $7, $8, $9, $10)', [providerConfigurationId, tenantId, "OPENAI_COMPATIBLE", "gpt-5-mini", "ACTIVE", 10, "1.00000000", "ciphertext", "iv", "tag"]);
    await client.query('INSERT INTO "AiSkillActivation" ("id", "tenantId", "companyId", "skillKey", "skillVersion", "policyVersion", "status", "dailyRequestLimit", "dailyCostLimit", "approvedByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::"AiSkillActivationStatus", $8, $9, $10::uuid)', [activationId, tenantId, companyId, "verification.skill", 1, 1, "PILOT", 5, "0.50000000", userId]);
    await client.query('INSERT INTO "AiBudgetReservation" ("id", "tenantId", "companyId", "providerConfigurationId", "skillActivationId", "interpretationRunId", "modelPriceRevisionId", "dayStartAt", "inputTokenEstimate", "maxOutputTokens", "estimatedCostUsd", "chargeCostUsd", "expiresAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, CURRENT_TIMESTAMP, $8, $9, $10, $10, CURRENT_TIMESTAMP + INTERVAL \'1 minute\')', [reservationId, tenantId, companyId, providerConfigurationId, activationId, runId, price.rows[0].id, 40, 100, "0.01000000"]);
    await client.query('INSERT INTO "AiUsageLedger" ("id", "tenantId", "companyId", "reservationId", "providerConfigurationId", "skillActivationId", "modelPriceRevisionId", "kind", "estimatedCostUsd", "safeReasonCode") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::"AiUsageLedgerKind", $9, $10)', [ledgerId, tenantId, companyId, reservationId, providerConfigurationId, activationId, price.rows[0].id, "RESERVATION", "0.01000000", "MAX_COST_RESERVED"]);
    await client.query("SAVEPOINT budget_reservation_scope_immutable");
    await assert.rejects(
      () => client.query('UPDATE "AiBudgetReservation" SET "maxOutputTokens" = $2 WHERE "id" = $1::uuid', [reservationId, 101]),
      (error) => error?.code === "P0001",
      "A cost reservation estimate must be immutable.",
    );
    await client.query("ROLLBACK TO SAVEPOINT budget_reservation_scope_immutable");
    await client.query('UPDATE "AiBudgetReservation" SET "status" = $2::"AiBudgetReservationStatus", "actualCostUsd" = $3, "chargeCostUsd" = $3, "settledAt" = CURRENT_TIMESTAMP WHERE "id" = $1::uuid', [reservationId, "SETTLED", "0.00800000"]);
    await client.query("SAVEPOINT usage_ledger_append_only");
    await assert.rejects(
      () => client.query('UPDATE "AiUsageLedger" SET "safeReasonCode" = $2 WHERE "id" = $1::uuid', [ledgerId, "tampered"]),
      (error) => error?.code === "P0001",
      "The consumption ledger must be append-only.",
    );
    await client.query("ROLLBACK TO SAVEPOINT usage_ledger_append_only");
    await client.query('INSERT INTO "AiSkillEvaluationRun" ("id", "tenantId", "companyId", "skillKey", "skillVersion", "policyVersion", "suiteKey", "suiteVersion", "suiteChecksum", "mode", "status", "totalCaseCount", "passedCaseCount", "failedCaseCount", "resultSummaryJson", "createdByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::"AiSkillEvaluationRunMode", $11::"AiSkillEvaluationRunStatus", $12, $13, $14, $15::jsonb, $16::uuid)', [evaluationRunId, tenantId, companyId, "verification.skill", 1, 1, "verification.suite", 1, "d".repeat(64), "OFFLINE", "PASSED", 1, 1, 0, JSON.stringify({ case: "de-identified" }), userId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [foreignTenantId]);
    const crossTenantEvaluationRead = await client.query('SELECT "id" FROM "AiSkillEvaluationRun" WHERE "id" = $1::uuid', [evaluationRunId]);
    assert.equal(crossTenantEvaluationRead.rowCount, 0, "A non-BYPASSRLS role must not read another tenant's offline evaluation evidence.");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SAVEPOINT offline_evaluation_append_only");
    await assert.rejects(
      () => client.query('UPDATE "AiSkillEvaluationRun" SET "status" = $2::"AiSkillEvaluationRunStatus" WHERE "id" = $1::uuid', [evaluationRunId, "FAILED"]),
      (error) => error?.code === "P0001",
      "Offline evaluation evidence must be append-only.",
    );
    await client.query("ROLLBACK TO SAVEPOINT offline_evaluation_append_only");
    await client.query("SAVEPOINT interpretation_single_flight");
    await assert.rejects(
      () => client.query('INSERT INTO "AiInterpretationRun" ("id", "tenantId", "companyId", "reuseKey", "status", "leaseExpiresAt", "claimedByUserId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::"AiInterpretationRunStatus", CURRENT_TIMESTAMP + INTERVAL \'1 minute\', $6::uuid)', [randomUUID(), tenantId, companyId, reuseKey, "PENDING", userId]),
      (error) => error?.code === "23505",
      "Only one PENDING run may claim an exact reuse key.",
    );
    await client.query("ROLLBACK TO SAVEPOINT interpretation_single_flight");
    await client.query('UPDATE "AiInterpretationRun" SET "status" = $2::"AiInterpretationRunStatus", "interpretationId" = $3::uuid, "completedAt" = CURRENT_TIMESTAMP WHERE "id" = $1::uuid', [runId, "COMPLETED", interpretationId]);
    await client.query("SAVEPOINT interpretation_append_only");
    await assert.rejects(
      () => client.query('UPDATE "AiInterpretation" SET "modelSnapshot" = $2 WHERE "id" = $1::uuid', [interpretationId, "tampered"]),
      (error) => error?.code === "P0001",
      "Interpretations must be append-only.",
    );
    await client.query("ROLLBACK TO SAVEPOINT interpretation_append_only");
    await client.query("SAVEPOINT interpretation_run_final");
    await assert.rejects(
      () => client.query('UPDATE "AiInterpretationRun" SET "safeFailureCode" = $2 WHERE "id" = $1::uuid', [runId, "tampered"]),
      (error) => error?.code === "P0001",
      "Completed runs must be immutable.",
    );
    await client.query("ROLLBACK TO SAVEPOINT interpretation_run_final");
  } finally {
    await client.query("ROLLBACK");
  }
  console.log("Basira interpretation verification passed: RLS, source binding, immutable human records, single-flight, cost reservation, and offline evaluation evidence are active.");
} finally {
  await client.end();
}
