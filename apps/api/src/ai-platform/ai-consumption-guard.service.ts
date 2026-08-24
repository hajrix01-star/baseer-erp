import { randomUUID } from "node:crypto";

import { ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiBudgetReservationStatus,
  AiUsageLedgerKind,
  Prisma,
  type AiProviderKind,
} from "../generated/prisma/client.js";
import type { AiProviderUsage } from "./ai-provider-usage.js";
import { startOfRiyadhDay } from "./ai-consumption-time.js";

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

/**
 * The only accounting boundary before a live model request. It is deliberately
 * called after semantic reuse has been resolved, so opening a page or reading
 * a saved answer neither consumes quota nor makes an outbound request.
 */
@Injectable()
export class AiConsumptionGuardService {
  constructor(private readonly database: DatabaseService) {}

  async reserve(input: Readonly<{
    context: TrustedCompanyActorContext;
    provider: AiConsumptionProvider;
    activation: AiConsumptionActivation;
    interpretationRunId: string;
    profile: AiConsumptionProfile;
    inputCharacters: number;
  }>): Promise<AiCostReservation> {
    const now = new Date();
    const inputTokenEstimate = estimateTokens(input.inputCharacters);
    if (inputTokenEstimate > input.profile.maxInputTokens) {
      throw new HttpException(
        "The prepared evidence is too large for this low-cost Basira skill. Narrow the period or review the source data first.",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    return this.database.inTenantTransaction(input.context.tenantId, async (transaction) => {
      await this.lockBudgetInTransaction(transaction, input.context, now);
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
      if (!input.provider.dailyCostLimit || !input.activation.dailyCostLimit) {
        throw new ConflictException("Set a daily USD cost limit for the provider and this company skill before enabling live Basira requests.");
      }

      const dayStartAt = startOfRiyadhDay(now);
      const estimatedCostUsd = estimateWorstCaseCost({
        inputTokens: inputTokenEstimate,
        maxOutputTokens: input.profile.maxOutputTokens,
        inputUsdPerMillion: price.inputUsdPerMillion,
        outputUsdPerMillion: price.outputUsdPerMillion,
      });
      const activeStatuses = [AiBudgetReservationStatus.RESERVED, AiBudgetReservationStatus.SETTLED];
      const [providerTotals, activationTotals, providerRequests, activationRequests] = await Promise.all([
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
      ]);

      if (providerRequests >= input.provider.dailyRequestLimit) {
        throw new HttpException("The configured daily AI request limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (input.activation.dailyRequestLimit !== null && activationRequests >= input.activation.dailyRequestLimit) {
        throw new HttpException("The company AI request limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      }
      const providerProjected = decimalOrZero(providerTotals._sum.chargeCostUsd).plus(estimatedCostUsd);
      const activationProjected = decimalOrZero(activationTotals._sum.chargeCostUsd).plus(estimatedCostUsd);
      if (providerProjected.greaterThan(input.provider.dailyCostLimit)) {
        throw new HttpException("The configured daily AI cost limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (activationProjected.greaterThan(input.activation.dailyCostLimit)) {
        throw new HttpException("The company AI cost limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
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
        status: AiBudgetReservationStatus.RESERVED,
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

  private async expireStaleReservationsInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId">,
    now: Date,
  ): Promise<void> {
    await transaction.aiBudgetReservation.updateMany({
      where: {
        tenantId: context.tenantId,
        status: AiBudgetReservationStatus.RESERVED,
        expiresAt: { lte: now },
      },
      data: {
        status: AiBudgetReservationStatus.EXPIRED,
        chargeCostUsd: new Prisma.Decimal(0),
        releasedAt: now,
        releaseReason: "RESERVATION_LEASE_EXPIRED_BEFORE_PROVIDER_SETTLEMENT",
      },
    });
  }
}

function estimateTokens(characters: number): number {
  return Math.max(1, Math.ceil(Math.max(0, characters) / 2));
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

function decimalOrZero(value: Prisma.Decimal | null): Prisma.Decimal {
  return value ?? new Prisma.Decimal(0);
}
