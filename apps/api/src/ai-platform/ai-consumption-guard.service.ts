import { randomUUID } from "node:crypto";

import { ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiBudgetReservationStatus,
  AiCompanyPolicyMode,
  AiCompanySkillOverrideState,
  AiSkillActivationStatus,
  AiUsageLedgerKind,
  Prisma,
  type AiProviderKind,
} from "../generated/prisma/client.js";
import type { AiProviderUsage } from "./ai-provider-usage.js";
import { startOfRiyadhDay, startOfRiyadhMonth } from "./ai-consumption-time.js";
import { countBasiraS2InputTokens } from "./ai-token-counter.js";

const RESERVATION_LEASE_MS = 10 * 60 * 1_000;
const USD_PER_MILLION = new Prisma.Decimal(1_000_000);

export type AiConsumptionProvider = Readonly<{
  id: string;
  provider: AiProviderKind;
  model: string;
  dailyRequestLimit: number;
  dailyCostLimit: Prisma.Decimal | null;
}>;

export type AiConsumptionActivation = Readonly<{
  id: string;
  dailyRequestLimit: number | null;
  dailyCostLimit: Prisma.Decimal | null;
}>;

export type AiConsumptionProfile = Readonly<{
  key: string;
  tokenizerModel: string;
  tokenSafetyMargin: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}>;

export type AiCostReservation = Readonly<{
  id: string;
  modelPriceRevisionId: string;
  estimatedCostUsd: Prisma.Decimal;
  inputTokenEstimate: number;
  maxOutputTokens: number;
}>;

export type AiCompanyMonthlyPolicy = Readonly<{
  policyRevisionId: string;
  monthlyBudgetUsdCents: Prisma.Decimal;
}>;

/**
 * The only accounting boundary before a live model request. It is deliberately
 * called after semantic reuse has been resolved, so opening a page or reading
 * a saved answer neither consumes quota nor makes an outbound request.
 */
@Injectable()
export class AiConsumptionGuardService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Serialises the final provider dispatch with policy and skill kill-switch
   * writes. The callback intentionally runs while the transaction advisory
   * lock is held: a successful suspension means no provider call starts after
   * it. A call that started before suspension may finish normally.
   */
  async dispatchProviderCall<T>(input: Readonly<{
    context: TrustedCompanyActorContext;
    activation: AiConsumptionActivation;
    companyPolicy?: AiCompanyMonthlyPolicy | null;
    dispatch: () => Promise<T>;
  }>): Promise<T> {
    const now = new Date();
    return this.database.inTenantTransaction(input.context.tenantId, async (transaction) => {
      await this.lockCompanyPolicyInTransaction(transaction, input.context);
      if (input.companyPolicy) {
        await this.assertCompanyPolicySnapshotIsCurrent(transaction, input.context, input.companyPolicy);
      }
      await this.assertActivationIsStillLive(transaction, input.context, input.activation, now);
      return input.dispatch();
    });
  }

  async reserve(input: Readonly<{
    context: TrustedCompanyActorContext;
    provider: AiConsumptionProvider;
    activation: AiConsumptionActivation;
    interpretationRunId: string;
    profile: AiConsumptionProfile;
    inputText: string;
    companyPolicy?: AiCompanyMonthlyPolicy | null;
  }>): Promise<AiCostReservation> {
    const now = new Date();
    let tokenCount;
    try {
      if (input.provider.model !== input.profile.tokenizerModel) {
        throw new Error("Configured model does not match the approved tokenizer profile.");
      }
      tokenCount = countBasiraS2InputTokens({
        model: input.profile.tokenizerModel,
        text: input.inputText,
        maxInputTokens: input.profile.maxInputTokens,
        safetyMarginTokens: input.profile.tokenSafetyMargin,
      });
    } catch {
      throw new ConflictException("No approved local token counter exists for the configured Basira model.");
    }
    if (tokenCount.exceedsLimit) {
      throw new HttpException(
        "The prepared evidence is too large for this low-cost Basira skill. Narrow the period or review the source data first.",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const inputTokenEstimate = tokenCount.estimatedTokens;

    return this.database.inTenantTransaction(input.context.tenantId, async (transaction) => {
      await this.lockBudgetInTransaction(transaction, input.context, now);
      // Every live reservation shares this lock with policy and skill-pause
      // writes. A request that passed an earlier eligibility read must verify
      // the current kill-switch state immediately before provider egress.
      await this.lockCompanyPolicyInTransaction(transaction, input.context);
      if (input.companyPolicy) {
        // Policy writes and live-cost reservations share this lock.  A policy
        // pause or allowlist change therefore cannot land between the runtime
        // eligibility check and the outbound provider call.
        await this.assertCompanyPolicySnapshotIsCurrent(transaction, input.context, input.companyPolicy);
        await this.lockCompanyMonthInTransaction(transaction, input.context, now);
      }
      await this.assertActivationIsStillLive(transaction, input.context, input.activation, now);
      await this.expireStaleReservationsInTransaction(transaction, input.context, now);

      const price = await transaction.aiModelPriceRevision.findFirst({
        where: {
          provider: input.provider.provider,
          model: input.provider.model,
          effectiveFrom: { lte: now },
        },
        orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        select: {
          id: true,
          inputUsdPerMillion: true,
          cachedInputUsdPerMillion: true,
          outputUsdPerMillion: true,
        },
      });
      if (!price) {
        throw new ConflictException("No approved price revision exists for the configured Basira model.");
      }
      if (!input.provider.dailyCostLimit || (!input.companyPolicy && !input.activation.dailyCostLimit)) {
        throw new ConflictException("Set a daily USD cost limit for the provider and this company skill before enabling live Basira requests.");
      }

      const dayStartAt = startOfRiyadhDay(now);
      const estimatedCostUsd = estimateWorstCaseCost({
        inputTokens: inputTokenEstimate,
        maxOutputTokens: input.profile.maxOutputTokens,
        inputUsdPerMillion: price.inputUsdPerMillion,
        outputUsdPerMillion: price.outputUsdPerMillion,
      });
      // An expired reservation can follow a process crash after the provider
      // accepted the request. It remains charged until reconciliation proves
      // otherwise; expiry must never create a new paid retry window.
      const activeStatuses = [
        AiBudgetReservationStatus.RESERVED,
        AiBudgetReservationStatus.SETTLED,
        AiBudgetReservationStatus.UNKNOWN_PROVIDER_OUTCOME,
      ];
      const monthStartAt = input.companyPolicy ? startOfRiyadhMonth(now) : null;
      const [providerTotals, activationTotals, providerRequests, activationRequests, monthlyTotals] = await Promise.all([
        transaction.aiBudgetReservation.aggregate({
          where: {
            tenantId: input.context.tenantId,
            providerConfigurationId: input.provider.id,
            dayStartAt,
            status: { in: activeStatuses },
          },
          _sum: { chargeCostUsd: true },
        }),
        transaction.aiBudgetReservation.aggregate({
          where: {
            tenantId: input.context.tenantId,
            companyId: input.context.companyId,
            skillActivationId: input.activation.id,
            dayStartAt,
            status: { in: activeStatuses },
          },
          _sum: { chargeCostUsd: true },
        }),
        transaction.aiBudgetReservation.count({
          where: {
            tenantId: input.context.tenantId,
            providerConfigurationId: input.provider.id,
            dayStartAt,
            status: { in: activeStatuses },
          },
        }),
        input.activation.dailyRequestLimit === null
          ? Promise.resolve(0)
          : transaction.aiBudgetReservation.count({
            where: {
              tenantId: input.context.tenantId,
              companyId: input.context.companyId,
              skillActivationId: input.activation.id,
              dayStartAt,
              status: { in: activeStatuses },
            },
          }),
        input.companyPolicy
          ? transaction.aiBudgetReservation.aggregate({
            where: { tenantId: input.context.tenantId, companyId: input.context.companyId, monthStartAt: monthStartAt!, status: { in: activeStatuses } },
            _sum: { chargeCostUsd: true },
          })
          : Promise.resolve(null),
      ]);

      if (providerRequests >= input.provider.dailyRequestLimit) {
        throw new HttpException("The configured daily AI request limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (!input.companyPolicy && input.activation.dailyRequestLimit !== null && activationRequests >= input.activation.dailyRequestLimit) {
        throw new HttpException("The company AI request limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      }
      const providerProjected = decimalOrZero(providerTotals._sum.chargeCostUsd).plus(estimatedCostUsd);
      const activationProjected = decimalOrZero(activationTotals._sum.chargeCostUsd).plus(estimatedCostUsd);
      if (providerProjected.greaterThan(input.provider.dailyCostLimit)) {
        throw new HttpException("The configured daily AI cost limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (!input.companyPolicy && activationProjected.greaterThan(input.activation.dailyCostLimit!)) {
        throw new HttpException("The company AI cost limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (input.companyPolicy) {
        const monthlyProjected = decimalOrZero(monthlyTotals?._sum.chargeCostUsd).plus(estimatedCostUsd);
        if (monthlyProjected.mul(100).ceil().greaterThan(input.companyPolicy.monthlyBudgetUsdCents)) {
          throw new HttpException("The company Basira monthly cost limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
        }
      }

      const reservation = await transaction.aiBudgetReservation.create({
        data: {
          id: randomUUID(),
          tenantId: input.context.tenantId,
          companyId: input.context.companyId,
          providerConfigurationId: input.provider.id,
          skillActivationId: input.activation.id,
          interpretationRunId: input.interpretationRunId,
          modelPriceRevisionId: price.id,
          dayStartAt,
          monthStartAt,
          companyPolicyRevisionId: input.companyPolicy?.policyRevisionId ?? null,
          status: AiBudgetReservationStatus.RESERVED,
          inputTokenEstimate,
          maxOutputTokens: input.profile.maxOutputTokens,
          estimatedCostUsd,
          chargeCostUsd: estimatedCostUsd,
          expiresAt: new Date(now.valueOf() + RESERVATION_LEASE_MS),
        },
        select: {
          id: true,
          modelPriceRevisionId: true,
          estimatedCostUsd: true,
          inputTokenEstimate: true,
          maxOutputTokens: true,
        },
      });
      await transaction.aiUsageLedger.create({
        data: {
          id: randomUUID(),
          tenantId: input.context.tenantId,
          companyId: input.context.companyId,
          reservationId: reservation.id,
          providerConfigurationId: input.provider.id,
          skillActivationId: input.activation.id,
          modelPriceRevisionId: price.id,
          kind: AiUsageLedgerKind.RESERVATION,
          estimatedCostUsd,
          actualCostUsd: null,
          safeReasonCode: "MAX_COST_RESERVED",
        },
      });
      return reservation;
    });
  }

  async settleAfterProviderFailure(input: Readonly<{
    context: TrustedCompanyActorContext;
    reservation: AiCostReservation;
    safeReasonCode: string;
    usage?: AiProviderUsage | null;
  }>): Promise<Prisma.Decimal> {
    return this.database.inTenantTransaction(input.context.tenantId, async (transaction) => {
      await this.lockBudgetInTransaction(transaction, input.context, new Date());
      return this.settleInTransaction(transaction, input.context, {
        reservation: input.reservation,
        usage: input.usage ?? null,
        executionReceiptId: null,
        safeReasonCode: input.safeReasonCode,
      });
    });
  }

  /**
   * A crashed API can leave a reservation after the provider may have accepted
   * it. The scheduler records that uncertainty durably and retains the
   * conservative charge; it never invents a provider result or reopens budget.
   */
  async reconcileExpiredReservationsForTenant(tenantId: string, now = new Date()): Promise<{ markedUnknown: number }> {
    return this.database.inTenantTransaction(tenantId, async (transaction) => {
      await this.lockBudgetInTransaction(transaction, { tenantId }, now);
      return { markedUnknown: await this.expireStaleReservationsInTransaction(transaction, { tenantId }, now) };
    });
  }

  async settleInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: Readonly<{
      reservation: AiCostReservation;
      usage: AiProviderUsage | null;
      executionReceiptId: string | null;
      safeReasonCode?: string | null;
    }>,
  ): Promise<Prisma.Decimal> {
    const reservation = await transaction.aiBudgetReservation.findFirst({
      where: {
        id: input.reservation.id,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: { in: [AiBudgetReservationStatus.RESERVED, AiBudgetReservationStatus.UNKNOWN_PROVIDER_OUTCOME] },
      },
      include: {
        modelPriceRevision: {
          select: {
            inputUsdPerMillion: true,
            cachedInputUsdPerMillion: true,
            outputUsdPerMillion: true,
          },
        },
      },
    });
    if (!reservation) {
      throw new ConflictException("The Basira cost reservation is no longer available for settlement.");
    }
    const actualCostUsd = input.usage
      ? calculateActualCost(reservation.modelPriceRevision, input.usage, reservation.estimatedCostUsd)
      : reservation.estimatedCostUsd;
    const safeReasonCode = input.safeReasonCode ?? (input.usage ? "USAGE_REPORTED" : "USAGE_UNAVAILABLE_CONSERVATIVE");
    await transaction.aiBudgetReservation.update({
      where: { id: reservation.id },
      data: {
        status: AiBudgetReservationStatus.SETTLED,
        actualCostUsd,
        chargeCostUsd: actualCostUsd,
        settledAt: new Date(),
        releasedAt: null,
        releaseReason: null,
      },
    });
    await transaction.aiUsageLedger.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        reservationId: reservation.id,
        executionReceiptId: input.executionReceiptId,
        providerConfigurationId: reservation.providerConfigurationId,
        skillActivationId: reservation.skillActivationId,
        modelPriceRevisionId: reservation.modelPriceRevisionId,
        kind: AiUsageLedgerKind.SETTLEMENT,
        inputTokens: input.usage?.inputTokens ?? null,
        cachedInputTokens: input.usage?.cachedInputTokens ?? null,
        outputTokens: input.usage?.outputTokens ?? null,
        reasoningTokens: input.usage?.reasoningTokens ?? null,
        estimatedCostUsd: reservation.estimatedCostUsd,
        actualCostUsd,
        safeReasonCode,
      },
    });
    return actualCostUsd;
  }

  private async lockBudgetInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId">,
    now: Date,
  ): Promise<void> {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`baseer-ai-consumption:${context.tenantId}:${startOfRiyadhDay(now).toISOString()}`}, 0))`,
    );
  }

  private async lockCompanyMonthInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
    now: Date,
  ): Promise<void> {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`baseer-ai-company-month:${context.tenantId}:${context.companyId}:${startOfRiyadhMonth(now).toISOString()}`}, 0))`,
    );
  }

  private async lockCompanyPolicyInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
  ): Promise<void> {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-company-policy:${context.tenantId}:${context.companyId}`}))`,
    );
  }

  private async assertCompanyPolicySnapshotIsCurrent(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
    snapshot: AiCompanyMonthlyPolicy,
  ): Promise<void> {
    const policy = await transaction.aiCompanyPolicy.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      select: { id: true, currentVersion: true },
    });
    const revision = policy
      ? await transaction.aiCompanyPolicyRevision.findFirst({
        where: {
          id: snapshot.policyRevisionId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          policyId: policy.id,
          version: policy.currentVersion,
          mode: AiCompanyPolicyMode.ENABLED,
          monthlyBudgetUsdCents: snapshot.monthlyBudgetUsdCents,
        },
        select: { id: true },
      })
      : null;
    if (!revision) {
      throw new ConflictException("The Basira company policy changed before this request could reserve cost. Review the current policy and try again.");
    }
  }

  private async assertActivationIsStillLive(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
    activation: AiConsumptionActivation,
    now: Date,
  ): Promise<void> {
    const currentActivation = await transaction.aiSkillActivation.findFirst({
      where: {
        id: activation.id,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: { in: [AiSkillActivationStatus.ACTIVE, AiSkillActivationStatus.PILOT] },
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { id: true, skillKey: true },
    });
    const blockedOverride = currentActivation
      ? await transaction.aiCompanySkillOverride.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          skillKey: currentActivation.skillKey,
          state: AiCompanySkillOverrideState.BLOCKED,
        },
        select: { id: true },
      })
      : null;
    if (!currentActivation || blockedOverride) {
      throw new ConflictException("This Basira skill was paused or is no longer active before provider egress.");
    }
  }

  private async expireStaleReservationsInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId">,
    now: Date,
  ): Promise<number> {
    const candidates = await transaction.aiBudgetReservation.findMany({
      where: { tenantId: context.tenantId, status: AiBudgetReservationStatus.RESERVED, expiresAt: { lte: now } },
      select: { id: true, companyId: true, expiresAt: true, chargeCostUsd: true },
    });
    let markedUnknown = 0;
    for (const candidate of candidates) {
      const updated = await transaction.aiBudgetReservation.updateMany({
        where: { id: candidate.id, tenantId: context.tenantId, companyId: candidate.companyId, status: AiBudgetReservationStatus.RESERVED, expiresAt: { lte: now } },
        data: { status: AiBudgetReservationStatus.UNKNOWN_PROVIDER_OUTCOME, releasedAt: now, releaseReason: "PROVIDER_OUTCOME_UNCERTAIN_AFTER_RESERVATION_LEASE" },
      });
      if (!updated.count) continue;
      markedUnknown += 1;
      await transaction.auditEvent.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: candidate.companyId, actorUserId: null,
        action: "platform.ai.budget_reservation_provider_outcome_unknown", entityType: "AiBudgetReservation", entityId: candidate.id,
        requestId: randomUUID(), afterJson: { expiresAt: candidate.expiresAt.toISOString(), retainedChargeUsd: candidate.chargeCostUsd.toString(), actionRequired: "Reconcile authoritative provider usage before any manual settlement." },
      } });
    }
    return markedUnknown;
  }
}

function estimateWorstCaseCost(input: Readonly<{
  inputTokens: number;
  maxOutputTokens: number;
  inputUsdPerMillion: Prisma.Decimal;
  outputUsdPerMillion: Prisma.Decimal;
}>): Prisma.Decimal {
  return input.inputUsdPerMillion.mul(input.inputTokens).div(USD_PER_MILLION)
    .plus(input.outputUsdPerMillion.mul(input.maxOutputTokens).div(USD_PER_MILLION));
}

function calculateActualCost(
  price: Readonly<{
    inputUsdPerMillion: Prisma.Decimal;
    cachedInputUsdPerMillion: Prisma.Decimal;
    outputUsdPerMillion: Prisma.Decimal;
  }>,
  usage: AiProviderUsage,
  fallback: Prisma.Decimal,
): Prisma.Decimal {
  if (usage.inputTokens === null || usage.outputTokens === null) return fallback;
  const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), usage.inputTokens);
  const uncached = Math.max(usage.inputTokens - cached, 0);
  return price.inputUsdPerMillion.mul(uncached).div(USD_PER_MILLION)
    .plus(price.cachedInputUsdPerMillion.mul(cached).div(USD_PER_MILLION))
    .plus(price.outputUsdPerMillion.mul(Math.max(usage.outputTokens, 0)).div(USD_PER_MILLION));
}

function decimalOrZero(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? new Prisma.Decimal(0);
}
