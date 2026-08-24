import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import dotenv from "dotenv";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { AiBudgetReservationStatus, Prisma } from "../generated/prisma/client.js";
import { AiConsumptionGuardService } from "./ai-consumption-guard.service.js";

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
  const runIds = [randomUUID(), randomUUID()];
  const context: TrustedCompanyActorContext = { tenantId, companyId, actorUserId: userId };

  try {
    await database.inTenantTransaction(tenantId, async (transaction) => {
      await transaction.tenant.create({ data: { id: tenantId, code: `basira-cost-${tenantId.slice(0, 8)}`, name: "Basira consumption verification" } });
      await transaction.user.create({ data: { id: userId, tenantId, loginNormalized: `basira-cost-${tenantId.slice(0, 8)}@baseer.test`, nameAr: "مدقق استهلاك بصيرة", nameEn: "Basira consumption verifier", passwordHash: "verification-only" } });
      await transaction.company.create({ data: { id: companyId, tenantId, nameAr: "شركة تحقق استهلاك بصيرة", nameEn: "Basira consumption verification company" } });
      await transaction.aiProviderConfiguration.create({ data: {
        id: providerId, tenantId, provider: "OPENAI_COMPATIBLE", model: "gpt-5-mini", status: "ACTIVE", isDefault: true,
        dailyRequestLimit: 1, dailyCostLimit: new Prisma.Decimal("0.01000000"), encryptedCredential: "verification-ciphertext", credentialIv: "iv", credentialTag: "tag",
      } });
      await transaction.aiSkillActivation.create({ data: {
        id: activationId, tenantId, companyId, skillKey: "verification.cost_skill", skillVersion: 1, policyVersion: 1,
        status: "PILOT", dailyRequestLimit: 1, dailyCostLimit: new Prisma.Decimal("0.01000000"), approvedByUserId: userId,
      } });
      await transaction.aiInterpretationRun.createMany({ data: runIds.map((id, index) => ({
        id, tenantId, companyId, reuseKey: `${index + 1}`.repeat(64), status: "PENDING", leaseExpiresAt: new Date(Date.now() + 60_000), claimedByUserId: userId,
      })) });
    });

    const provider = { id: providerId, provider: "OPENAI_COMPATIBLE" as const, model: "gpt-5-mini", dailyRequestLimit: 1, dailyCostLimit: new Prisma.Decimal("0.01000000") };
    const activation = { id: activationId, dailyRequestLimit: 1, dailyCostLimit: new Prisma.Decimal("0.01000000") };
    const profile = { key: "verification.low_cost", maxInputTokens: 500, maxOutputTokens: 100 };
    const results = await Promise.allSettled(runIds.map((interpretationRunId) => guard.reserve({
      context, provider, activation, interpretationRunId, profile, inputCharacters: 120,
    })));
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof guard.reserve>>> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const resultSummary = results.map((result) => result.status === "fulfilled" ? "fulfilled" : result.reason instanceof Error ? `${result.reason.name}:${result.reason.message}` : "rejected").join(" | ");
    assert.equal(fulfilled.length, 1, `Exactly one concurrent reservation may pass a one-request cap. ${resultSummary}`);
    assert.equal(rejected.length, 1, "The second concurrent reservation must be blocked.");
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
    console.log("Basira consumption guard verification passed: concurrent reservation, hard pre-egress cap, and settlement are active.");
  } finally {
    await database.onModuleDestroy();
  }
}

void verify();
