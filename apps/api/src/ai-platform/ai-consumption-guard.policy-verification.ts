import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import dotenv from "dotenv";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { AiBudgetReservationStatus, AiCompanySkillOverrideState, Prisma } from "../generated/prisma/client.js";
import { AiConsumptionGuardService } from "./ai-consumption-guard.service.js";
import { BASIRA_S2_TOKENIZER_MODEL, countBasiraS2InputTokens } from "./ai-token-counter.js";

dotenv.config({ path: "apps/api/.env.baseer-test" });

/**
 * A real PostgreSQL concurrency check for E4. It deliberately uses two unique
 * runs and one request/cost budget, proving the DB advisory lock — not an
 * in-memory counter — allows one outbound reservation only.
 */
async function verify(): Promise<void> {
  const database = new DatabaseService();
  const guard = new AiConsumptionGuardService(database);
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const userId = randomUUID();
  const providerId = randomUUID();
  const activationId = randomUUID();
  const runIds = Array.from({ length: 24 }, () => randomUUID());
  const policyId = randomUUID();
  const policyRevisionId = randomUUID();
  const context: TrustedCompanyActorContext = { tenantId, companyId, actorUserId: userId };

  try {
    await database.inTenantTransaction(tenantId, async (transaction) => {
      await transaction.tenant.create({ data: { id: tenantId, code: `basira-cost-${tenantId.slice(0, 8)}`, name: "Basira consumption verification" } });
      await transaction.user.create({ data: { id: userId, tenantId, loginNormalized: `basira-cost-${tenantId.slice(0, 8)}@baseer.test`, nameAr: "مدقق استهلاك بصيرة", nameEn: "Basira consumption verifier", passwordHash: "verification-only" } });
      await transaction.company.create({ data: { id: companyId, tenantId, nameAr: "شركة تحقق استهلاك بصيرة", nameEn: "Basira consumption verification company" } });
      await transaction.aiProviderConfiguration.create({ data: {
        id: providerId, tenantId, provider: "OPENAI_COMPATIBLE", model: "gpt-5-mini", status: "ACTIVE", isDefault: true,
        dailyRequestLimit: 10, dailyCostLimit: new Prisma.Decimal("0.01000000"), encryptedCredential: "verification-ciphertext", credentialIv: "iv", credentialTag: "tag",
      } });
      await transaction.aiSkillActivation.create({ data: {
        id: activationId, tenantId, companyId, skillKey: "verification.cost_skill", skillVersion: 1, policyVersion: 1,
        status: "PILOT", dailyRequestLimit: 1, dailyCostLimit: new Prisma.Decimal("0.01000000"), approvedByUserId: userId,
      } });
      await transaction.aiInterpretationRun.createMany({ data: runIds.map((id, index) => ({
        id, tenantId, companyId, reuseKey: String(index + 1).padStart(2, "0").repeat(32), status: "PENDING", leaseExpiresAt: new Date(Date.now() + 60_000), claimedByUserId: userId,
      })) });
      await transaction.aiCompanyPolicy.create({ data: { id: policyId, tenantId, companyId, currentVersion: 1 } });
      await transaction.aiCompanyPolicyRevision.create({ data: {
        id: policyRevisionId, tenantId, companyId, policyId, version: 1, mode: "ENABLED",
        monthlyBudgetUsdCents: new Prisma.Decimal(100), billingTimeZone: "Asia/Riyadh",
        changedByUserId: userId, changeReason: "Verification policy", policyDigest: "0".repeat(64),
      } });
    });

    const provider = { id: providerId, provider: "OPENAI_COMPATIBLE" as const, model: "gpt-5-mini", dailyRequestLimit: 10, dailyCostLimit: new Prisma.Decimal("0.01000000") };
    const activation = { id: activationId, dailyRequestLimit: 1, dailyCostLimit: new Prisma.Decimal("0.01000000") };
    const profile = { key: "verification.low_cost", tokenizerModel: BASIRA_S2_TOKENIZER_MODEL, tokenSafetyMargin: 32, maxInputTokens: 500, maxOutputTokens: 100 };
    const arabicCount = countBasiraS2InputTokens({
      model: "gpt-5-mini",
      text: "ملخص مبيعات اليوم مع دليل موثق ولا توجد أسباب مؤكدة.",
      maxInputTokens: 500,
      safetyMarginTokens: 32,
    });
    assert.ok(!arabicCount.exceedsLimit && arabicCount.contentTokens !== null && arabicCount.estimatedTokens === arabicCount.contentTokens + 32, "Arabic evidence must use the local GPT-5 BPE counter plus the fixed safety margin.");
    const oversizedCount = countBasiraS2InputTokens({ model: "gpt-5-mini", text: "حد".repeat(10_000), maxInputTokens: 64, safetyMarginTokens: 16 });
    assert.equal(oversizedCount.exceedsLimit, true, "The local counter must reject oversized evidence before provider egress.");
    const results = await Promise.allSettled(runIds.slice(0, 20).map((interpretationRunId) => guard.reserve({
      context, provider, activation, interpretationRunId, profile, inputText: "حزمة أدلة تحقق محلية",
    })));
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof guard.reserve>>> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const resultSummary = results.map((result) => result.status === "fulfilled" ? "fulfilled" : result.reason instanceof Error ? `${result.reason.name}:${result.reason.message}` : "rejected").join(" | ");
    assert.equal(fulfilled.length, 1, `Exactly one of twenty concurrent reservations may pass a one-request cap. ${resultSummary}`);
    assert.equal(rejected.length, 19, "Every competing reservation must be blocked before provider egress.");
    const rejectedResult = rejected[0];
    const fulfilledResult = fulfilled[0];
    assert.ok(rejectedResult && rejectedResult.reason instanceof HttpException && rejectedResult.reason.getStatus() === 429, "The blocked reservation must be a pre-egress consumption limit.");
    assert.ok(fulfilledResult, "One reservation result must be available for settlement.");

    const reservation = fulfilledResult.value;
    await database.inTenantTransaction(tenantId, async (transaction) => {
      const count = await transaction.aiBudgetReservation.count({
        where: { tenantId, companyId, status: { in: [AiBudgetReservationStatus.RESERVED, AiBudgetReservationStatus.SETTLED] } },
      });
      assert.equal(count, 1, "The database must retain one charged reservation only.");
      const actual = await guard.settleInTransaction(transaction, context, {
        reservation,
        usage: { inputTokens: 60, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0, totalTokens: 80, providerRequestId: "verification-request" },
        executionReceiptId: null,
      });
      assert.ok(actual.greaterThan(0), "Actual metered cost must be positive.");
    });
    const companyPolicy = { policyRevisionId, monthlyBudgetUsdCents: new Prisma.Decimal(100) };
    const uncertain = await guard.reserve({ context, provider, activation, interpretationRunId: requiredRunId(runIds, 20), profile, inputText: "حجز قد يتعذر معه تأكيد نتيجة المزود", companyPolicy });
    const reconciliation = await guard.reconcileExpiredReservationsForTenant(tenantId, new Date(Date.now() + 11 * 60 * 1_000));
    assert.equal(reconciliation.markedUnknown, 1, "The scheduled reconciliation must classify every elapsed reservation without another provider request.");
    await database.inTenantTransaction(tenantId, async (transaction) => {
      const expired = await transaction.aiBudgetReservation.findUniqueOrThrow({ where: { id: uncertain.id } });
      assert.equal(expired.status, AiBudgetReservationStatus.UNKNOWN_PROVIDER_OUTCOME, "A lapsed reservation must retain an uncertain provider outcome, not release its budget.");
      assert.ok(expired.chargeCostUsd.greaterThan(0), "An uncertain provider outcome must keep its conservative cost charge.");
      assert.equal(await transaction.auditEvent.count({ where: { tenantId, companyId, action: "platform.ai.budget_reservation_provider_outcome_unknown", entityId: uncertain.id } }), 1, "The scheduled reconciliation must leave one durable operational audit record.");
      await transaction.aiCompanyPolicyRevision.create({ data: {
        id: randomUUID(), tenantId, companyId, policyId, version: 2, mode: "PAUSED",
        monthlyBudgetUsdCents: null, billingTimeZone: "Asia/Riyadh",
        changedByUserId: userId, changeReason: "Verification pause", policyDigest: "1".repeat(64),
      } });
      await transaction.aiCompanyPolicy.update({ where: { tenantId_companyId: { tenantId, companyId } }, data: { currentVersion: 2 } });
    });
    await assert.rejects(
      () => guard.reserve({ context, provider, activation, interpretationRunId: requiredRunId(runIds, 22), profile, inputText: "طلب بعد إيقاف السياسة", companyPolicy }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 409,
      "A reservation must reject a policy snapshot that is no longer the current enabled revision.",
    );
    const resumedRevisionId = randomUUID();
    await database.inTenantTransaction(tenantId, async (transaction) => {
      await transaction.aiCompanyPolicyRevision.create({ data: {
        id: resumedRevisionId, tenantId, companyId, policyId, version: 3, mode: "ENABLED",
        monthlyBudgetUsdCents: new Prisma.Decimal(100), billingTimeZone: "Asia/Riyadh",
        changedByUserId: userId, changeReason: "Verification resume", policyDigest: "2".repeat(64),
      } });
      await transaction.aiCompanyPolicy.update({ where: { tenantId_companyId: { tenantId, companyId } }, data: { currentVersion: 3 } });
    });
    let providerDispatchStarted = false;
    let providerDispatchFinished = false;
    const resumedPolicy = { policyRevisionId: resumedRevisionId, monthlyBudgetUsdCents: new Prisma.Decimal(100) };
    const dispatched = guard.dispatchProviderCall({
      context,
      activation,
      companyPolicy: resumedPolicy,
      dispatch: async () => {
        providerDispatchStarted = true;
        await delay(80);
        providerDispatchFinished = true;
        return "provider-call-started";
      },
    });
    while (!providerDispatchStarted) await delay(5);
    const suspension = database.inTenantTransaction(tenantId, async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-company-policy:${tenantId}:${companyId}`}))`);
      assert.equal(providerDispatchFinished, true, "A successful skill suspension must wait for an already-dispatched provider call to finish.");
      await transaction.aiCompanySkillOverride.create({ data: {
        id: randomUUID(), tenantId, companyId, skillKey: "verification.cost_skill",
        state: AiCompanySkillOverrideState.BLOCKED, reason: "Verification kill switch", changedByUserId: userId,
      } });
    });
    await Promise.all([dispatched, suspension]);
    await assert.rejects(
      () => guard.reserve({ context, provider, activation, interpretationRunId: requiredRunId(runIds, 23), profile, inputText: "طلب بعد تعليق المهارة", companyPolicy: resumedPolicy }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 409,
      "A suspended skill or company kill switch must reject before provider egress.",
    );
    console.log("Basira consumption guard verification passed: concurrent reservation, hard pre-egress cap, scheduled conservative unknown-outcome reconciliation, current-policy gating, and the skill kill switch are active.");
  } finally {
    await database.onModuleDestroy();
  }
}

void verify();

function requiredRunId(runIds: readonly string[], index: number): string {
  const runId = runIds[index];
  assert.ok(runId, `Missing verification run at index ${index}.`);
  return runId;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
