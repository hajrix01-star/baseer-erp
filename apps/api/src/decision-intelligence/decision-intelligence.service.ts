import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import type { DecisionSalesComparisonRead, DecisionSalesMetricRead } from "@baseer-erp/contracts";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { canonicalJson, IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

type CreateCompanyEvent = Readonly<{
  eventKind: string;
  titleAr: string;
  startsOn: string;
  endsOn: string;
  sourceReference?: string | undefined;
}>;

type UpdateCompanyEvent = CreateCompanyEvent;

type ManualGlobalEvent = Readonly<{
  eventKind: string;
  titleAr: string;
  startsOn: string;
  endsOn: string;
  sourceReference?: string | undefined;
  reason: string;
}>;

type AlertFeedback = Readonly<{
  alertId: string;
  kind: string;
  note?: string | undefined;
}>;

type AlertStatusChange = Readonly<{
  status: "ACKNOWLEDGED" | "CLOSED";
  reason: string;
}>;

type SalesChangePolicyInput = Readonly<{
  enabled: boolean;
  decreaseThresholdBasisPoints: number | null;
  increaseThresholdBasisPoints: number | null;
  minimumBaselineAmount: string | null;
  minimumAbsoluteDifferenceAmount: string | null;
  cooldownHours: number | null;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MANUAL_GLOBAL_CONTEXT_SOURCE_CODE = "BASEER_MANUAL_CONTEXT";

/**
 * The Decision Intelligence module is a consumer of official facts. It has no
 * mutation path into Finance, Operations, Marketing or a provider connector.
 */
@Injectable()
export class DecisionIntelligenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async readSalesMetric(
    context: TrustedCompanyActorContext,
    period: Readonly<{ from: Date; to: Date }>,
  ): Promise<DecisionSalesMetricRead> {
    assertPeriod(period);
    try {
      return await this.database.inTenantTransaction(context.tenantId, (transaction) => this.readSalesMetricInTransaction(context, period, transaction));
    } catch {
      return unavailableSalesMetric(period);
    }
  }

  private async readSalesMetricInTransaction(
    context: TrustedCompanyActorContext,
    period: Readonly<{ from: Date; to: Date }>,
    transaction: Prisma.TransactionClient,
  ): Promise<DecisionSalesMetricRead> {
      const summaries = await transaction.financeDailyFinancialSummary.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          businessDate: { gte: period.from, lte: period.to },
        },
        orderBy: { businessDate: "asc" },
        select: {
          id: true,
          businessDate: true,
          salesNetAmount: true,
          salesGrossAmount: true,
          salesVatAmount: true,
          customerCount: true,
          operationalDayStatus: true,
          dataStatus: true,
          sourceChecksum: true,
          reconciledAt: true,
        },
      });
      const byDate = new Map(summaries.map((summary) => [day(summary.businessDate), summary]));
      const missingDays: string[] = [];
      const excludedDays: Array<{ date: string; reason: string }> = [];
      const usable = summaries.filter((summary) => summary.dataStatus !== "PENDING" && summary.operationalDayStatus !== "PARTIAL");
      for (let cursor = new Date(period.from); cursor <= period.to; cursor = addDay(cursor)) {
        const summary = byDate.get(day(cursor));
        if (!summary || summary.dataStatus === "PENDING") missingDays.push(day(cursor));
        else if (summary.operationalDayStatus === "PARTIAL") excludedDays.push({ date: day(cursor), reason: "OPERATIONAL_DAY_PARTIAL" });
      }
      const total = usable.reduce(
        (value, summary) => ({
          net: value.net.plus(summary.salesNetAmount),
          gross: value.gross.plus(summary.salesGrossAmount),
          vat: value.vat.plus(summary.salesVatAmount),
          customers: value.customers + summary.customerCount,
        }),
        { net: new Prisma.Decimal(0), gross: new Prisma.Decimal(0), vat: new Prisma.Decimal(0), customers: 0 },
      );
      const requiredDays = Math.floor((period.to.getTime() - period.from.getTime()) / DAY_MS) + 1;
      const freshest = usable.reduce<Date | null>((latest, summary) =>
        latest === null || summary.reconciledAt > latest ? summary.reconciledAt : latest,
      null);
      const freshnessLimitMs = salesFreshnessLimitMs();
      const recentPeriod = period.to.getTime() >= startOfRiyadhDay(new Date()).getTime() - 2 * DAY_MS;
      const stale = recentPeriod && (freshest === null || Date.now() - freshest.getTime() > freshnessLimitMs);
      const quality = usable.length === 0
        ? "NO_DATA"
        : missingDays.length > 0 || excludedDays.length > 0
          ? "INCOMPLETE"
          : stale
            ? "STALE"
            : "READY";
      return {
        metricCode: "finance.sales.net.daily",
        metricDefinitionVersion: "finance.sales.net.daily.v1",
        period: {
          fromBusinessDate: day(period.from),
          toBusinessDate: day(period.to),
          timezone: "Asia/Riyadh",
          timeGrain: "DAY",
        },
        evidenceKind: "OFFICIAL_FACT",
        verificationStatus: "SYSTEM_RECONCILED",
        dataQuality: quality,
        calculatedAt: new Date(),
        sourceFreshAt: freshest,
        coverage: { requiredDays, availableDays: usable.length, missingDays, excludedDays },
        sourceReferences: sourceReferencesForSales(usable, period),
        payload: {
          currencyCode: "SAR",
          netAmount: total.net.toFixed(4),
          grossAmount: total.gross.toFixed(4),
          vatAmount: total.vat.toFixed(4),
          customerCount: total.customers,
        },
      };
  }

  /**
   * The initial commercial comparison is deliberately a read, not an alert:
   * it compares equal-length closed periods and declines a percentage when
   * either period is incomplete or its baseline is zero.
   */
  async readSalesComparison(
    context: TrustedCompanyActorContext,
    period: Readonly<{ from: Date; to: Date }>,
  ): Promise<DecisionSalesComparisonRead> {
    assertPeriod(period);
    const days = Math.floor((period.to.getTime() - period.from.getTime()) / DAY_MS) + 1;
    const comparisonTo = addDay(period.from, -1);
    const comparisonFrom = addDay(comparisonTo, -(days - 1));
    let current: DecisionSalesMetricRead;
    let comparison: DecisionSalesMetricRead;
    try {
      [current, comparison] = await this.database.inTenantTransaction(context.tenantId, async (transaction) => Promise.all([
        this.readSalesMetricInTransaction(context, period, transaction),
        this.readSalesMetricInTransaction(context, { from: comparisonFrom, to: comparisonTo }, transaction),
      ]));
    } catch {
      current = unavailableSalesMetric(period);
      comparison = unavailableSalesMetric({ from: comparisonFrom, to: comparisonTo });
    }
    const currentNet = new Prisma.Decimal(current.payload.netAmount);
    const comparisonNet = new Prisma.Decimal(comparison.payload.netAmount);
    const difference = currentNet.minus(comparisonNet);
    const percentDifference = current.dataQuality === "READY" && comparison.dataQuality === "READY" && !comparisonNet.isZero()
      ? difference.dividedBy(comparisonNet).times(100).toFixed(2)
      : null;
    return {
      metricCode: "finance.sales.net.period_comparison",
      metricDefinitionVersion: "finance.sales.net.period_comparison.v1",
      comparisonPolicyCode: "PREVIOUS_EQUAL_PERIOD",
      comparisonPolicyVersion: "previous_equal_period.v1",
      dataQuality: comparisonQuality(current.dataQuality, comparison.dataQuality),
      current,
      comparison,
      payload: {
        currencyCode: "SAR",
        currentNetAmount: currentNet.toFixed(4),
        comparisonNetAmount: comparisonNet.toFixed(4),
        differenceNetAmount: difference.toFixed(4),
        percentDifference,
        currentCustomerCount: current.payload.customerCount,
        comparisonCustomerCount: comparison.payload.customerCount,
      },
    };
  }

  /** A daily-only, same-weekday comparison. It stays descriptive and is not an alert input in v1. */
  async readSalesMatchedWeekdayComparison(
    context: TrustedCompanyActorContext,
    businessDate: Date,
  ): Promise<DecisionSalesComparisonRead> {
    const period = { from: businessDate, to: businessDate };
    assertPeriod(period);
    const comparisonDate = addDay(businessDate, -7);
    let current: DecisionSalesMetricRead;
    let comparison: DecisionSalesMetricRead;
    try {
      [current, comparison] = await this.database.inTenantTransaction(context.tenantId, async (transaction) => Promise.all([
        this.readSalesMetricInTransaction(context, period, transaction),
        this.readSalesMetricInTransaction(context, { from: comparisonDate, to: comparisonDate }, transaction),
      ]));
    } catch {
      current = unavailableSalesMetric(period);
      comparison = unavailableSalesMetric({ from: comparisonDate, to: comparisonDate });
    }
    return salesComparisonRead(current, comparison, "finance.sales.net.weekday_comparison", "finance.sales.net.weekday_comparison.v1", "MATCHED_WEEKDAYS", "matched_weekdays.v1");
  }

  async salesChangePolicy(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const policy = await transaction.decisionSalesChangePolicy.findUnique({
        where: { companyId_tenantId: { companyId: context.companyId, tenantId: context.tenantId } },
        select: { enabled: true, comparisonPolicyCode: true, comparisonPolicyVersion: true, decreaseThresholdBasisPoints: true, increaseThresholdBasisPoints: true, minimumBaselineAmount: true, minimumAbsoluteDifferenceAmount: true, cooldownHours: true, updatedAt: true },
      });
      if (policy) return {
        ...policy,
        minimumBaselineAmount: policy.minimumBaselineAmount?.toFixed(4) ?? null,
        minimumAbsoluteDifferenceAmount: policy.minimumAbsoluteDifferenceAmount?.toFixed(4) ?? null,
      };
      return {
        enabled: false,
        comparisonPolicyCode: "PREVIOUS_EQUAL_PERIOD",
        comparisonPolicyVersion: "previous_equal_period.v1",
        decreaseThresholdBasisPoints: null,
        increaseThresholdBasisPoints: null,
        minimumBaselineAmount: null,
        minimumAbsoluteDifferenceAmount: null,
        cooldownHours: null,
        updatedAt: null,
      };
    });
  }

  async updateSalesChangePolicy(context: TrustedCompanyActorContext, input: SalesChangePolicyInput, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.policy.sales_change.update",
        key: idempotencyKey,
        request: input,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The sales-change policy request is already in progress.");
      const policy = await transaction.decisionSalesChangePolicy.upsert({
        where: { companyId_tenantId: { companyId: context.companyId, tenantId: context.tenantId } },
        create: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
          enabled: input.enabled,
          decreaseThresholdBasisPoints: input.decreaseThresholdBasisPoints,
          increaseThresholdBasisPoints: input.increaseThresholdBasisPoints,
          minimumBaselineAmount: input.minimumBaselineAmount,
          minimumAbsoluteDifferenceAmount: input.minimumAbsoluteDifferenceAmount,
          cooldownHours: input.cooldownHours,
          updatedByUserId: context.actorUserId,
        },
        update: {
          enabled: input.enabled,
          decreaseThresholdBasisPoints: input.decreaseThresholdBasisPoints,
          increaseThresholdBasisPoints: input.increaseThresholdBasisPoints,
          minimumBaselineAmount: input.minimumBaselineAmount,
          minimumAbsoluteDifferenceAmount: input.minimumAbsoluteDifferenceAmount,
          cooldownHours: input.cooldownHours,
          updatedByUserId: context.actorUserId,
        },
        select: { enabled: true, comparisonPolicyCode: true, comparisonPolicyVersion: true, decreaseThresholdBasisPoints: true, increaseThresholdBasisPoints: true, minimumBaselineAmount: true, minimumAbsoluteDifferenceAmount: true, cooldownHours: true, updatedAt: true },
      });
      const body = { ...policy, minimumBaselineAmount: policy.minimumBaselineAmount?.toFixed(4) ?? null, minimumAbsoluteDifferenceAmount: policy.minimumAbsoluteDifferenceAmount?.toFixed(4) ?? null, updatedAt: policy.updatedAt.toISOString() };
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: "decision.policy.sales_change.updated", entityType: "DecisionSalesChangePolicy", entityId: context.companyId,
          requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: body,
        },
      });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  async evaluateSalesChange(context: TrustedCompanyActorContext, period: Readonly<{ from: Date; to: Date }>, idempotencyKey: string) {
    const comparison = await this.readSalesComparison(context, period);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const policy = await transaction.decisionSalesChangePolicy.findUnique({
        where: { companyId_tenantId: { companyId: context.companyId, tenantId: context.tenantId } },
        select: { enabled: true, comparisonPolicyCode: true, comparisonPolicyVersion: true, decreaseThresholdBasisPoints: true, increaseThresholdBasisPoints: true, minimumBaselineAmount: true, minimumAbsoluteDifferenceAmount: true, cooldownHours: true },
      });
      if (!policy?.enabled || policy.decreaseThresholdBasisPoints === null || policy.increaseThresholdBasisPoints === null || policy.minimumBaselineAmount === null || policy.minimumAbsoluteDifferenceAmount === null || policy.cooldownHours === null) {
        return { evaluationRunId: null, alertId: null, outcome: "POLICY_DISABLED" as const, dataQuality: comparison.dataQuality };
      }
      const inputChecksum = salesComparisonInputChecksum(comparison, {
        ...policy,
        minimumBaselineAmount: policy.minimumBaselineAmount!,
        minimumAbsoluteDifferenceAmount: policy.minimumAbsoluteDifferenceAmount!,
        cooldownHours: policy.cooldownHours!,
      });
      const policyForEvidence = serializableSalesChangePolicy(policy);
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.evaluation.sales_change.run", key: idempotencyKey,
        request: { from: day(period.from), to: day(period.to), inputChecksum },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The sales-change evaluation is already in progress.");
      const metricCode = comparison.metricCode;
      await transaction.decisionMetricDefinition.upsert({
        where: { companyId_metricCode_definitionVersion: { companyId: context.companyId, metricCode, definitionVersion: comparison.metricDefinitionVersion } },
        update: {},
        create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, metricCode, definitionVersion: comparison.metricDefinitionVersion, comparisonCode: comparison.comparisonPolicyCode, descriptionAr: "مقارنة صافي المبيعات المثبتة بفترة سابقة متساوية" },
      });
      const ruleCode = "finance.sales.net.period_change";
      const ruleVersion = "finance.sales.net.period_change.v1";
      await transaction.decisionRuleDefinition.upsert({
        where: { companyId_ruleCode_ruleVersion: { companyId: context.companyId, ruleCode, ruleVersion } },
        update: {},
        create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, ruleCode, ruleVersion },
      });
      const percent = comparison.payload.percentDifference === null ? null : new Prisma.Decimal(comparison.payload.percentDifference);
      const threshold = percent?.isNegative() ? new Prisma.Decimal(policy.decreaseThresholdBasisPoints).dividedBy(100) : new Prisma.Decimal(policy.increaseThresholdBasisPoints).dividedBy(100);
      const baseline = new Prisma.Decimal(comparison.payload.comparisonNetAmount);
      const difference = new Prisma.Decimal(comparison.payload.differenceNetAmount).abs();
      const materialityMet = baseline.greaterThanOrEqualTo(policy.minimumBaselineAmount) && difference.greaterThanOrEqualTo(policy.minimumAbsoluteDifferenceAmount);
      const thresholdMet = comparison.dataQuality === "READY" && percent !== null && percent.abs().greaterThanOrEqualTo(threshold) && materialityMet;
      const outcome = comparison.dataQuality !== "READY" ? "DATA_QUALITY_BLOCKED" : !materialityMet ? "MATERIALITY_BLOCKED" : !thresholdMet ? "NO_THRESHOLD_ALERT" : percent!.isNegative() ? "DECREASE_ALERT" : "INCREASE_ALERT";
      const existing = await transaction.decisionEvaluationRun.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, ruleCode, ruleVersion, periodFrom: period.from, periodTo: period.to, inputsChecksum: inputChecksum },
        select: { id: true },
      });
      const evaluationRunId = existing?.id ?? randomUUID();
      if (!existing) await transaction.decisionEvaluationRun.create({
        data: {
          id: evaluationRunId, tenantId: context.tenantId, companyId: context.companyId, ruleCode, ruleVersion,
          periodFrom: period.from, periodTo: period.to, dataQuality: comparison.dataQuality, inputsChecksum: inputChecksum,
          outcomeJson: { outcome, comparisonPolicyCode: comparison.comparisonPolicyCode, comparisonPolicyVersion: comparison.comparisonPolicyVersion, policy: policyForEvidence, percentDifference: comparison.payload.percentDifference } as Prisma.InputJsonValue,
        },
      });
      let alertId: string | null = null;
      if (thresholdMet) {
        const existingAlert = await transaction.decisionAlert.findFirst({
          where: {
            tenantId: context.tenantId, companyId: context.companyId, ruleCode, ruleVersion, status: "OPEN",
            evidenceSnapshot: { is: { periodFrom: period.from, periodTo: period.to } },
          },
          select: { id: true, evidenceSnapshotId: true, evaluationRunId: true },
        });
        const cooldownSince = new Date(Date.now() - policy.cooldownHours * 60 * 60 * 1_000);
        const recentAlert = existingAlert ? null : await transaction.decisionAlert.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, ruleCode, ruleVersion, createdAt: { gte: cooldownSince } }, select: { id: true } });
        if (recentAlert) {
          const body = { evaluationRunId, alertId: recentAlert.id, outcome: "COOLDOWN_BLOCKED" as const, dataQuality: comparison.dataQuality };
          await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
          return body;
        }
        alertId = existingAlert?.id ?? randomUUID();
        if (!existingAlert || existingAlert.evaluationRunId !== evaluationRunId) {
          const evidencePayload = { comparison: serializableSalesComparison(comparison), policy: policyForEvidence, outcome, calculatedAt: new Date().toISOString() };
          const snapshotId = randomUUID();
          await transaction.decisionEvidenceSnapshot.create({
            data: { id: snapshotId, tenantId: context.tenantId, companyId: context.companyId, supersedesSnapshotId: existingAlert?.evidenceSnapshotId ?? null, evidenceKind: "OFFICIAL_FACT", verificationStatus: "SYSTEM_RECONCILED", periodFrom: period.from, periodTo: period.to, payloadJson: evidencePayload as Prisma.InputJsonValue, checksum: createHash("sha256").update(canonicalJson(evidencePayload)).digest("hex"), createdByUserId: context.actorUserId },
          });
          const direction = percent!.isNegative() ? "انخفاض" : "ارتفاع";
          const titleAr = `${direction} صافي المبيعات تجاوز العتبة المعتمدة للشركة (${percent!.abs().toFixed(2)}٪)`;
          if (existingAlert) await transaction.decisionAlert.update({ where: { id_tenantId_companyId: { id: existingAlert.id, tenantId: context.tenantId, companyId: context.companyId } }, data: { evaluationRunId, evidenceSnapshotId: snapshotId, titleAr } });
          else await transaction.decisionAlert.create({ data: { id: alertId, tenantId: context.tenantId, companyId: context.companyId, evaluationRunId, evidenceSnapshotId: snapshotId, ruleCode, ruleVersion, titleAr } });
          await transaction.auditEvent.create({
            data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: existingAlert ? "decision.alert.evidence_updated" : "decision.alert.created", entityType: "DecisionAlert", entityId: alertId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { ruleCode, ruleVersion, evaluationRunId, snapshotId, outcome } },
          });
        }
      }
      const body = { evaluationRunId, alertId, outcome, dataQuality: comparison.dataQuality };
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  async listTimeline(context: TrustedCompanyActorContext, period: Readonly<{ from: Date; to: Date }>) {
    assertPeriod(period);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const companyLocation = await transaction.company.findFirstOrThrow({ where: { id: context.companyId, tenantId: context.tenantId }, select: { contextLocationCode: true } });
      const [globalEvents, companyEvents] = await Promise.all([
        transaction.decisionGlobalContextEvent.findMany({
          where: {
            tenantId: context.tenantId,
            status: "PUBLISHED",
            OR: [
              { scope: "TENANT_GLOBAL" },
              ...(companyLocation.contextLocationCode ? [{ scope: "AREA" as const, locationCode: companyLocation.contextLocationCode }] : []),
            ],
            revisions: { some: { status: "PUBLISHED", startsOn: { lte: period.to }, endsOn: { gte: period.from } } },
          },
          select: {
            id: true,
            currentRevision: true,
            eventKind: true,
            scope: true,
            locationCode: true,
            locationLabelAr: true,
            source: { select: { sourceCode: true } },
            revisions: { select: { revision: true, titleAr: true, startsOn: true, endsOn: true, status: true, sourceChecksum: true, verificationStatus: true, importReceipt: true } },
          },
          take: 500,
        }),
        transaction.decisionCompanyContextEvent.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, status: "PUBLISHED", startsOn: { lte: period.to }, endsOn: { gte: period.from } },
          select: { id: true, eventKind: true, titleAr: true, startsOn: true, endsOn: true, verificationStatus: true, sourceReference: true, createdAt: true },
          take: 500,
        }),
      ]);
      const global = globalEvents.flatMap((event) => event.revisions
        .filter((revision) => revision.revision === event.currentRevision && revision.status === "PUBLISHED")
        .map((revision) => ({
          id: event.id,
          scope: event.scope === "AREA" ? "AREA" as const : "GLOBAL" as const,
          eventKind: event.eventKind,
          titleAr: revision.titleAr,
          startsOn: day(revision.startsOn),
          endsOn: day(revision.endsOn),
          verificationStatus: revision.verificationStatus,
          sourceReference: event.source.sourceCode === MANUAL_GLOBAL_CONTEXT_SOURCE_CODE ? manualSourceReference(revision.importReceipt) : revision.sourceChecksum,
          locationLabelAr: event.locationLabelAr,
          isManual: event.source.sourceCode === MANUAL_GLOBAL_CONTEXT_SOURCE_CODE,
        })));
      const company = companyEvents.map((event) => ({
        id: event.id,
        scope: "COMPANY" as const,
        eventKind: event.eventKind,
        titleAr: event.titleAr,
        startsOn: day(event.startsOn),
        endsOn: day(event.endsOn),
        verificationStatus: event.verificationStatus,
        sourceReference: event.sourceReference,
        locationLabelAr: null,
        isManual: false,
      }));
      return [...global, ...company].sort((left, right) => left.startsOn.localeCompare(right.startsOn) || left.titleAr.localeCompare(right.titleAr));
    });
  }

  async createCompanyEvent(context: TrustedCompanyActorContext, input: CreateCompanyEvent, idempotencyKey: string) {
    const startsOn = parseDate(input.startsOn);
    const endsOn = parseDate(input.endsOn);
    if (endsOn < startsOn) throw new ConflictException("The context-event end date cannot be before its start date.");
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.company.create",
        key: idempotencyKey,
        request: { eventKind: input.eventKind, titleAr: input.titleAr, startsOn: input.startsOn, endsOn: input.endsOn, sourceReference: input.sourceReference ?? null },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The context-event request is already in progress.");
      const duplicateCandidates = await transaction.decisionCompanyContextEvent.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          eventKind: input.eventKind,
          startsOn,
          endsOn,
          status: "PUBLISHED",
        },
        select: { id: true, titleAr: true },
      });
      const duplicate = duplicateCandidates.find((event) => normalizeContextText(event.titleAr) === normalizeContextText(input.titleAr));
      if (duplicate) throw new ConflictException("A matching company context event is already recorded.");
      const id = randomUUID();
      await transaction.decisionCompanyContextEvent.create({
        data: {
          id, tenantId: context.tenantId, companyId: context.companyId,
          eventKind: input.eventKind, titleAr: input.titleAr, startsOn, endsOn,
          sourceReference: input.sourceReference ?? null, createdByUserId: context.actorUserId,
        },
      });
      const body = { id, status: "PUBLISHED" };
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: "decision.context.company.created", entityType: "DecisionCompanyContextEvent", entityId: id,
          requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: body,
        },
      });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 201, headers: null, body } });
      return body;
    });
  }

  async archiveCompanyEvent(context: TrustedCompanyActorContext, eventId: string, reason: string, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.company.archive",
        key: idempotencyKey,
        request: { eventId, reason },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The context-event archive request is already in progress.");
      const event = await transaction.decisionCompanyContextEvent.findFirst({
        where: { id: eventId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, status: true, eventKind: true, titleAr: true, startsOn: true, endsOn: true },
      });
      if (!event) throw new NotFoundException("The company context event was not found.");
      if (event.status !== "ARCHIVED") {
        await transaction.decisionCompanyContextEvent.update({
          where: { id_tenantId_companyId: { id: event.id, tenantId: context.tenantId, companyId: context.companyId } },
          data: { status: "ARCHIVED" },
        });
      }
      const body = { id: event.id, status: "ARCHIVED" as const };
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: "decision.context.company.archived", entityType: "DecisionCompanyContextEvent", entityId: event.id,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          beforeJson: { status: event.status, eventKind: event.eventKind, titleAr: event.titleAr, startsOn: day(event.startsOn), endsOn: day(event.endsOn) },
          afterJson: { ...body, reason },
        },
      });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  async updateCompanyEvent(context: TrustedCompanyActorContext, eventId: string, input: UpdateCompanyEvent, idempotencyKey: string) {
    const startsOn = parseDate(input.startsOn);
    const endsOn = parseDate(input.endsOn);
    if (endsOn < startsOn) throw new ConflictException("The context-event end date cannot be before its start date.");
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.company.update", key: idempotencyKey,
        request: { eventId, eventKind: input.eventKind, titleAr: input.titleAr, startsOn: input.startsOn, endsOn: input.endsOn, sourceReference: input.sourceReference ?? null },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The context-event update is already in progress.");
      const event = await transaction.decisionCompanyContextEvent.findFirst({
        where: { id: eventId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, status: true, eventKind: true, titleAr: true, startsOn: true, endsOn: true, sourceReference: true },
      });
      if (!event) throw new NotFoundException("The company context event was not found.");
      if (event.status !== "PUBLISHED") throw new ConflictException("Only a published company context event can be edited.");
      const duplicateCandidates = await transaction.decisionCompanyContextEvent.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, eventKind: input.eventKind, startsOn, endsOn, status: "PUBLISHED", id: { not: event.id } },
        select: { id: true, titleAr: true },
      });
      if (duplicateCandidates.some((candidate) => normalizeContextText(candidate.titleAr) === normalizeContextText(input.titleAr))) throw new ConflictException("A matching company context event is already recorded.");
      await transaction.decisionCompanyContextEvent.update({
        where: { id_tenantId_companyId: { id: event.id, tenantId: context.tenantId, companyId: context.companyId } },
        data: { eventKind: input.eventKind, titleAr: input.titleAr, startsOn, endsOn, sourceReference: input.sourceReference ?? null },
      });
      const body = { id: event.id, status: "PUBLISHED" as const };
      await transaction.auditEvent.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
        action: "decision.context.company.updated", entityType: "DecisionCompanyContextEvent", entityId: event.id,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        beforeJson: { eventKind: event.eventKind, titleAr: event.titleAr, startsOn: day(event.startsOn), endsOn: day(event.endsOn), sourceReference: event.sourceReference },
        afterJson: { ...body, eventKind: input.eventKind, titleAr: input.titleAr, startsOn: input.startsOn, endsOn: input.endsOn, sourceReference: input.sourceReference ?? null },
      } });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  async createManualGlobalEvent(context: TrustedCompanyActorContext, input: ManualGlobalEvent, idempotencyKey: string) {
    const startsOn = parseDate(input.startsOn);
    const endsOn = parseDate(input.endsOn);
    if (endsOn < startsOn) throw new ConflictException("The context-event end date cannot be before its start date.");
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.global.manual.create", key: idempotencyKey,
        request: { ...input, sourceReference: input.sourceReference ?? null },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The global context-event request is already in progress.");
      if (await hasMatchingGlobalContextEvent(transaction, context.tenantId, input.eventKind, input.titleAr, startsOn, endsOn)) throw new ConflictException("A matching global context event is already recorded.");
      const source = await manualGlobalContextSource(transaction, context.tenantId);
      const id = randomUUID();
      const externalKey = `MANUAL:${id}`;
      const checksum = manualGlobalRevisionChecksum({ eventKind: input.eventKind, titleAr: input.titleAr, startsOn: input.startsOn, endsOn: input.endsOn, sourceReference: input.sourceReference ?? null, reason: input.reason, status: "PUBLISHED" });
      await transaction.decisionGlobalContextEvent.create({ data: { id, tenantId: context.tenantId, sourceId: source.id, externalKey, eventKind: input.eventKind, scope: "TENANT_GLOBAL", currentRevision: 1 } });
      await transaction.decisionGlobalContextEventRevision.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, eventId: id, revision: 1, titleAr: input.titleAr, startsOn, endsOn,
        sourceChecksum: checksum, importReceipt: { source: MANUAL_GLOBAL_CONTEXT_SOURCE_CODE, sourceReference: input.sourceReference ?? null, reason: input.reason, actorUserId: context.actorUserId },
        verificationStatus: "HUMAN_CONFIRMED", status: "PUBLISHED",
      } });
      const body = { id, status: "PUBLISHED" as const, revision: 1 };
      await this.auditManualGlobalEvent(transaction, context, "created", id, null, { ...body, ...input, sourceReference: input.sourceReference ?? null });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 201, headers: null, body } });
      return body;
    });
  }

  async updateManualGlobalEvent(context: TrustedCompanyActorContext, eventId: string, input: ManualGlobalEvent, idempotencyKey: string) {
    const startsOn = parseDate(input.startsOn);
    const endsOn = parseDate(input.endsOn);
    if (endsOn < startsOn) throw new ConflictException("The context-event end date cannot be before its start date.");
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.global.manual.update", key: idempotencyKey,
        request: { eventId, ...input, sourceReference: input.sourceReference ?? null },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The global context-event update is already in progress.");
      const event = await manualGlobalEvent(transaction, context.tenantId, eventId);
      if (event.status !== "PUBLISHED") throw new ConflictException("Only a published manual global context event can be edited.");
      if (await hasMatchingGlobalContextEvent(transaction, context.tenantId, input.eventKind, input.titleAr, startsOn, endsOn, event.id)) throw new ConflictException("A matching global context event is already recorded.");
      const revision = event.currentRevision + 1;
      const checksum = manualGlobalRevisionChecksum({ eventKind: input.eventKind, titleAr: input.titleAr, startsOn: input.startsOn, endsOn: input.endsOn, sourceReference: input.sourceReference ?? null, reason: input.reason, status: "PUBLISHED" });
      await transaction.decisionGlobalContextEventRevision.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, eventId: event.id, revision, titleAr: input.titleAr, startsOn, endsOn,
        sourceChecksum: checksum, importReceipt: { source: MANUAL_GLOBAL_CONTEXT_SOURCE_CODE, sourceReference: input.sourceReference ?? null, reason: input.reason, actorUserId: context.actorUserId, supersedesRevision: event.currentRevision }, verificationStatus: "HUMAN_CONFIRMED", status: "PUBLISHED",
      } });
      await transaction.decisionGlobalContextEvent.update({ where: { id_tenantId: { id: event.id, tenantId: context.tenantId } }, data: { eventKind: input.eventKind, currentRevision: revision } });
      const body = { id: event.id, status: "PUBLISHED" as const, revision };
      await this.auditManualGlobalEvent(transaction, context, "updated", event.id, manualGlobalAuditShape(event), { ...body, ...input, sourceReference: input.sourceReference ?? null });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  async archiveManualGlobalEvent(context: TrustedCompanyActorContext, eventId: string, reason: string, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.global.manual.archive", key: idempotencyKey, request: { eventId, reason }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The global context-event archive is already in progress.");
      const event = await manualGlobalEvent(transaction, context.tenantId, eventId);
      if (event.status === "ARCHIVED") throw new ConflictException("The global context event is already withdrawn.");
      const current = event.revisions.find((revision) => revision.revision === event.currentRevision);
      if (!current) throw new ConflictException("The manual global context event is missing its current revision.");
      const revision = event.currentRevision + 1;
      const checksum = manualGlobalRevisionChecksum({ eventKind: event.eventKind, titleAr: current.titleAr, startsOn: day(current.startsOn), endsOn: day(current.endsOn), sourceReference: manualSourceReference(current.importReceipt), reason, status: "ARCHIVED" });
      await transaction.decisionGlobalContextEventRevision.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, eventId: event.id, revision, titleAr: current.titleAr, startsOn: current.startsOn, endsOn: current.endsOn,
        sourceChecksum: checksum, importReceipt: { source: MANUAL_GLOBAL_CONTEXT_SOURCE_CODE, reason, actorUserId: context.actorUserId, supersedesRevision: event.currentRevision }, verificationStatus: "HUMAN_CONFIRMED", status: "ARCHIVED",
      } });
      await transaction.decisionGlobalContextEvent.update({ where: { id_tenantId: { id: event.id, tenantId: context.tenantId } }, data: { status: "ARCHIVED", currentRevision: revision } });
      const body = { id: event.id, status: "ARCHIVED" as const, revision };
      await this.auditManualGlobalEvent(transaction, context, "archived", event.id, manualGlobalAuditShape(event), { ...body, reason });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  private async auditManualGlobalEvent(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: "created" | "updated" | "archived", eventId: string, beforeJson: Prisma.InputJsonValue | null, afterJson: Prisma.InputJsonValue) {
    await transaction.auditEvent.create({ data: {
      id: randomUUID(), tenantId: context.tenantId, companyId: null, actorUserId: context.actorUserId,
      action: `decision.context.global.manual.${action}`, entityType: "DecisionGlobalContextEvent", entityId: eventId,
      requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson ?? Prisma.JsonNull, afterJson,
    } });
  }

  async listAlerts(context: TrustedCompanyActorContext, status?: "OPEN" | "ACKNOWLEDGED" | "CLOSED", pageSize = 50) {
    return this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.decisionAlert.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" }, take: pageSize,
      select: { id: true, ruleCode: true, ruleVersion: true, status: true, titleAr: true, createdAt: true, acknowledgedAt: true, closedAt: true, evidenceSnapshotId: true },
    }));
  }

  async readAlertEvidence(context: TrustedCompanyActorContext, alertId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const alert = await transaction.decisionAlert.findFirst({
        where: { id: alertId, tenantId: context.tenantId, companyId: context.companyId },
        select: {
          id: true, ruleCode: true, ruleVersion: true, status: true, titleAr: true, createdAt: true, acknowledgedAt: true, closedAt: true,
          evidenceSnapshot: {
            select: { id: true, evidenceKind: true, verificationStatus: true, periodFrom: true, periodTo: true, timezone: true, payloadJson: true, checksum: true, createdAt: true, supersedesSnapshotId: true },
          },
          actions: { orderBy: { createdAt: "asc" }, select: { action: true, reason: true, createdAt: true } },
        },
      });
      if (!alert) throw new NotFoundException("The decision alert was not found.");
      const payload = alert.evidenceSnapshot.payloadJson;
      const checksum = createHash("sha256").update(canonicalJson(payload)).digest("hex");
      return {
        alert: {
          id: alert.id, ruleCode: alert.ruleCode, ruleVersion: alert.ruleVersion, status: alert.status, titleAr: alert.titleAr,
          createdAt: alert.createdAt, acknowledgedAt: alert.acknowledgedAt, closedAt: alert.closedAt,
        },
        snapshot: {
          id: alert.evidenceSnapshot.id, evidenceKind: alert.evidenceSnapshot.evidenceKind,
          verificationStatus: alert.evidenceSnapshot.verificationStatus, periodFrom: day(alert.evidenceSnapshot.periodFrom),
          periodTo: day(alert.evidenceSnapshot.periodTo), timezone: alert.evidenceSnapshot.timezone,
          checksum: alert.evidenceSnapshot.checksum, checksumValid: checksum === alert.evidenceSnapshot.checksum,
          createdAt: alert.evidenceSnapshot.createdAt, supersedesSnapshotId: alert.evidenceSnapshot.supersedesSnapshotId,
          payload,
        },
        actions: alert.actions,
      };
    });
  }

  async updateAlertStatus(context: TrustedCompanyActorContext, alertId: string, input: AlertStatusChange, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.alert.status.update",
        key: idempotencyKey,
        request: { alertId, ...input },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The decision-alert status request is already in progress.");
      const alert = await transaction.decisionAlert.findFirst({
        where: { id: alertId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, status: true },
      });
      if (!alert) throw new NotFoundException("The decision alert was not found.");
      if (alert.status === "CLOSED") throw new ConflictException("A closed decision alert cannot be changed.");
      if (input.status === "ACKNOWLEDGED" && alert.status !== "OPEN") throw new ConflictException("Only an open decision alert can be acknowledged.");
      const now = new Date();
      const nextStatus = input.status;
      await transaction.decisionAlert.update({
        where: { id_tenantId_companyId: { id: alert.id, tenantId: context.tenantId, companyId: context.companyId } },
        data: nextStatus === "ACKNOWLEDGED"
          ? { status: "ACKNOWLEDGED", acknowledgedAt: now }
          : { status: "CLOSED", closedAt: now },
      });
      const actionId = randomUUID();
      await transaction.decisionAlertAction.create({
        data: { id: actionId, tenantId: context.tenantId, companyId: context.companyId, alertId: alert.id, action: nextStatus, reason: input.reason, createdByUserId: context.actorUserId },
      });
      const body = { id: alert.id, status: nextStatus, actionId };
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: `decision.alert.${nextStatus.toLowerCase()}`, entityType: "DecisionAlert", entityId: alert.id,
          requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: { status: alert.status }, afterJson: { ...body, reason: input.reason },
        },
      });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  /**
   * The first rule deliberately alerts only on source quality. It avoids an
   * unapproved commercial threshold while still making missing sales days
   * visible, with a frozen proof for every emitted alert.
   */
  async evaluateSalesQuality(context: TrustedCompanyActorContext, period: Readonly<{ from: Date; to: Date }>, idempotencyKey: string) {
    const metric = await this.readSalesMetric(context, period);
    const inputChecksum = createHash("sha256").update(canonicalJson({
      metricCode: metric.metricCode,
      metricDefinitionVersion: metric.metricDefinitionVersion,
      period: metric.period,
      dataQuality: metric.dataQuality,
      coverage: metric.coverage,
      sourceReferences: metric.sourceReferences,
    })).digest("hex");
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.evaluation.sales_quality.run", key: idempotencyKey,
        request: { from: day(period.from), to: day(period.to), inputChecksum },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The decision-evaluation request is already in progress.");
      const ruleCode = "finance.sales.data_quality";
      const ruleVersion = "finance.sales.data_quality.v1";
      await transaction.decisionRuleDefinition.upsert({
        where: { companyId_ruleCode_ruleVersion: { companyId: context.companyId, ruleCode, ruleVersion } },
        update: {},
        create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, ruleCode, ruleVersion },
      });
      const existing = await transaction.decisionEvaluationRun.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, ruleCode, ruleVersion, periodFrom: period.from, periodTo: period.to, inputsChecksum: inputChecksum },
        select: { id: true },
      });
      const evaluationRunId = existing?.id ?? randomUUID();
      if (!existing) await transaction.decisionEvaluationRun.create({
        data: {
          id: evaluationRunId, tenantId: context.tenantId, companyId: context.companyId,
          ruleCode, ruleVersion, periodFrom: period.from, periodTo: period.to,
          dataQuality: metric.dataQuality, inputsChecksum: inputChecksum,
          outcomeJson: { ruleResult: metric.dataQuality === "READY" ? "NO_ALERT" : "DATA_QUALITY_ALERT", dataQuality: metric.dataQuality, coverage: metric.coverage } as Prisma.InputJsonValue,
        },
      });
      let alertId: string | null = null;
      if (metric.dataQuality !== "READY") {
        const existingAlert = await transaction.decisionAlert.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, evaluationRunId }, select: { id: true } });
        alertId = existingAlert?.id ?? randomUUID();
        if (!existingAlert) {
          const evidencePayload = {
            ...metric,
            calculatedAt: metric.calculatedAt.toISOString(),
            sourceFreshAt: metric.sourceFreshAt?.toISOString() ?? null,
          };
          const snapshotId = randomUUID();
          await transaction.decisionEvidenceSnapshot.create({
            data: {
              id: snapshotId, tenantId: context.tenantId, companyId: context.companyId,
              evidenceKind: "OFFICIAL_FACT", verificationStatus: "SYSTEM_RECONCILED",
              periodFrom: period.from, periodTo: period.to,
              payloadJson: evidencePayload as Prisma.InputJsonValue,
              checksum: createHash("sha256").update(canonicalJson(evidencePayload)).digest("hex"),
              createdByUserId: context.actorUserId,
            },
          });
          await transaction.decisionAlert.create({
            data: {
              id: alertId, tenantId: context.tenantId, companyId: context.companyId,
              evaluationRunId, evidenceSnapshotId: snapshotId, ruleCode, ruleVersion,
              titleAr: "بيانات المبيعات للفترة المحددة غير مكتملة أو غير متاحة",
            },
          });
          await transaction.auditEvent.create({
            data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "decision.alert.created", entityType: "DecisionAlert", entityId: alertId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { ruleCode, ruleVersion, dataQuality: metric.dataQuality, evaluationRunId, snapshotId } },
          });
        }
      }
      const body = { evaluationRunId, alertId, dataQuality: metric.dataQuality };
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  async feedback(context: TrustedCompanyActorContext, input: AlertFeedback, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.alert.feedback.create", key: idempotencyKey,
        request: { alertId: input.alertId, kind: input.kind, note: input.note ?? null },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The alert-feedback request is already in progress.");
      const alert = await transaction.decisionAlert.findFirst({ where: { id: input.alertId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } });
      if (!alert) throw new NotFoundException("The decision alert was not found.");
      const id = randomUUID();
      await transaction.decisionFeedback.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, alertId: alert.id, kind: input.kind, note: input.note ?? null, createdByUserId: context.actorUserId } });
      const body = { id, alertId: alert.id, kind: input.kind };
      await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "decision.alert.feedback.created", entityType: "DecisionFeedback", entityId: id, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: body } });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 201, headers: null, body } });
      return body;
    });
  }

  static checksum(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
}

function assertPeriod(period: Readonly<{ from: Date; to: Date }>) {
  if (!(period.from instanceof Date) || !(period.to instanceof Date) || Number.isNaN(period.from.valueOf()) || Number.isNaN(period.to.valueOf()) || period.from > period.to) throw new ConflictException("A valid decision period is required.");
  if (period.to.getTime() - period.from.getTime() > 366 * DAY_MS) throw new ConflictException("The decision period cannot exceed 366 days.");
}
function parseDate(value: string): Date { const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.valueOf()) || day(date) !== value) throw new ConflictException("A valid decision business date is required."); return date; }
function day(value: Date): string { return value.toISOString().slice(0, 10); }
function addDay(value: Date, count = 1): Date { return new Date(value.getTime() + count * DAY_MS); }
function comparisonQuality(current: DecisionSalesMetricRead["dataQuality"], comparison: DecisionSalesMetricRead["dataQuality"]): DecisionSalesMetricRead["dataQuality"] {
  const severity: Record<DecisionSalesMetricRead["dataQuality"], number> = { READY: 0, STALE: 1, INCOMPLETE: 2, NO_DATA: 3, UNAVAILABLE: 4, CONFLICTED: 5 };
  return severity[current] >= severity[comparison] ? current : comparison;
}

/**
 * An evaluation is reproducible only when its signature excludes execution
 * time. `calculatedAt` deliberately remains in the user-facing read, but is
 * not an input fact: including it would create a new alert on every run.
 */
function salesComparisonInputChecksum(
  comparison: DecisionSalesComparisonRead,
  policy: Readonly<{
    enabled: boolean;
    comparisonPolicyCode: string;
    comparisonPolicyVersion: string;
    decreaseThresholdBasisPoints: number | null;
    increaseThresholdBasisPoints: number | null;
    minimumBaselineAmount: Prisma.Decimal;
    minimumAbsoluteDifferenceAmount: Prisma.Decimal;
    cooldownHours: number;
  }>,
): string {
  const stableMetric = (metric: DecisionSalesMetricRead) => ({
    metricCode: metric.metricCode,
    metricDefinitionVersion: metric.metricDefinitionVersion,
    period: metric.period,
    evidenceKind: metric.evidenceKind,
    verificationStatus: metric.verificationStatus,
    dataQuality: metric.dataQuality,
    sourceFreshAt: metric.sourceFreshAt?.toISOString() ?? null,
    coverage: metric.coverage,
    sourceReferences: metric.sourceReferences,
    payload: metric.payload,
  });
  return createHash("sha256").update(canonicalJson({
    metricCode: comparison.metricCode,
    metricDefinitionVersion: comparison.metricDefinitionVersion,
    comparisonPolicyCode: comparison.comparisonPolicyCode,
    comparisonPolicyVersion: comparison.comparisonPolicyVersion,
    dataQuality: comparison.dataQuality,
    current: stableMetric(comparison.current),
    comparison: stableMetric(comparison.comparison),
    payload: comparison.payload,
    policy: {
      enabled: policy.enabled,
      comparisonPolicyCode: policy.comparisonPolicyCode,
      comparisonPolicyVersion: policy.comparisonPolicyVersion,
      decreaseThresholdBasisPoints: policy.decreaseThresholdBasisPoints,
      increaseThresholdBasisPoints: policy.increaseThresholdBasisPoints,
      minimumBaselineAmount: policy.minimumBaselineAmount.toFixed(4),
      minimumAbsoluteDifferenceAmount: policy.minimumAbsoluteDifferenceAmount.toFixed(4),
      cooldownHours: policy.cooldownHours,
    },
  })).digest("hex");
}

function serializableSalesComparison(comparison: DecisionSalesComparisonRead) {
  const metric = (value: DecisionSalesMetricRead) => ({
    ...value,
    calculatedAt: value.calculatedAt.toISOString(),
    sourceFreshAt: value.sourceFreshAt?.toISOString() ?? null,
  });
  return { ...comparison, current: metric(comparison.current), comparison: metric(comparison.comparison) };
}

function serializableSalesChangePolicy(policy: Readonly<{
  enabled: boolean;
  comparisonPolicyCode: string;
  comparisonPolicyVersion: string;
  decreaseThresholdBasisPoints: number | null;
  increaseThresholdBasisPoints: number | null;
  minimumBaselineAmount: Prisma.Decimal | null;
  minimumAbsoluteDifferenceAmount: Prisma.Decimal | null;
  cooldownHours: number | null;
}>) {
  return {
    ...policy,
    minimumBaselineAmount: policy.minimumBaselineAmount?.toFixed(4) ?? null,
    minimumAbsoluteDifferenceAmount: policy.minimumAbsoluteDifferenceAmount?.toFixed(4) ?? null,
  };
}

function normalizeContextText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ar-SA");
}

async function manualGlobalContextSource(transaction: Prisma.TransactionClient, tenantId: string) {
  return transaction.decisionContextSource.upsert({
    where: { tenantId_sourceCode: { tenantId, sourceCode: MANUAL_GLOBAL_CONTEXT_SOURCE_CODE } },
    update: { displayNameAr: "مركز القرار — أحداث عامة يدوية", sourceUrl: "baseer://decision-context/manual", scheduleCode: "MANUAL" },
    create: { id: randomUUID(), tenantId, sourceCode: MANUAL_GLOBAL_CONTEXT_SOURCE_CODE, displayNameAr: "مركز القرار — أحداث عامة يدوية", sourceUrl: "baseer://decision-context/manual", scheduleCode: "MANUAL" },
    select: { id: true },
  });
}

async function manualGlobalEvent(transaction: Prisma.TransactionClient, tenantId: string, eventId: string) {
  const event = await transaction.decisionGlobalContextEvent.findFirst({
    where: { id: eventId, tenantId },
    select: {
      id: true, tenantId: true, eventKind: true, status: true, currentRevision: true,
      source: { select: { sourceCode: true } },
      revisions: { select: { revision: true, titleAr: true, startsOn: true, endsOn: true, importReceipt: true, status: true } },
    },
  });
  if (!event) throw new NotFoundException("The global context event was not found.");
  if (event.source.sourceCode !== MANUAL_GLOBAL_CONTEXT_SOURCE_CODE) throw new ConflictException("An imported or researched context event cannot be changed manually.");
  return event;
}

async function hasMatchingGlobalContextEvent(transaction: Prisma.TransactionClient, tenantId: string, eventKind: string, titleAr: string, startsOn: Date, endsOn: Date, excludeId?: string) {
  const events = await transaction.decisionGlobalContextEvent.findMany({
    where: { tenantId, eventKind, scope: "TENANT_GLOBAL", status: "PUBLISHED", ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, currentRevision: true, revisions: { select: { revision: true, titleAr: true, startsOn: true, endsOn: true, status: true } } },
    take: 100,
  });
  const title = normalizeContextText(titleAr);
  return events.some((event) => event.revisions.some((revision) => revision.revision === event.currentRevision && revision.status === "PUBLISHED" && revision.startsOn.getTime() === startsOn.getTime() && revision.endsOn.getTime() === endsOn.getTime() && normalizeContextText(revision.titleAr) === title));
}

function manualGlobalRevisionChecksum(value: Readonly<{ eventKind: string; titleAr: string; startsOn: string; endsOn: string; sourceReference: string | null; reason: string; status: "PUBLISHED" | "ARCHIVED" }>) {
  return createHash("sha256").update(canonicalJson({ source: MANUAL_GLOBAL_CONTEXT_SOURCE_CODE, ...value })).digest("hex");
}

function manualSourceReference(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reference = (value as { sourceReference?: unknown }).sourceReference;
  return typeof reference === "string" ? reference : null;
}

function manualGlobalAuditShape(event: Awaited<ReturnType<typeof manualGlobalEvent>>): Prisma.InputJsonValue {
  const current = event.revisions.find((revision) => revision.revision === event.currentRevision);
  return {
    eventKind: event.eventKind,
    status: event.status,
    revision: event.currentRevision,
    titleAr: current?.titleAr ?? null,
    startsOn: current ? day(current.startsOn) : null,
    endsOn: current ? day(current.endsOn) : null,
    sourceReference: current ? manualSourceReference(current.importReceipt) : null,
  };
}

function unavailableSalesMetric(period: Readonly<{ from: Date; to: Date }>): DecisionSalesMetricRead {
  const missingDays: string[] = [];
  for (let cursor = new Date(period.from); cursor <= period.to; cursor = addDay(cursor)) missingDays.push(day(cursor));
  return {
    metricCode: "finance.sales.net.daily",
    metricDefinitionVersion: "finance.sales.net.daily.v1",
    period: { fromBusinessDate: day(period.from), toBusinessDate: day(period.to), timezone: "Asia/Riyadh", timeGrain: "DAY" },
    evidenceKind: "OFFICIAL_FACT",
    verificationStatus: "NOT_APPLICABLE",
    dataQuality: "UNAVAILABLE",
    calculatedAt: new Date(),
    sourceFreshAt: null,
    coverage: { requiredDays: missingDays.length, availableDays: 0, missingDays, excludedDays: [] },
    sourceReferences: [],
    payload: { currencyCode: "SAR", netAmount: "0.0000", grossAmount: "0.0000", vatAmount: "0.0000", customerCount: 0 },
  };
}

function salesComparisonRead(
  current: DecisionSalesMetricRead,
  comparison: DecisionSalesMetricRead,
  metricCode: "finance.sales.net.period_comparison" | "finance.sales.net.weekday_comparison",
  metricDefinitionVersion: "finance.sales.net.period_comparison.v1" | "finance.sales.net.weekday_comparison.v1",
  comparisonPolicyCode: "PREVIOUS_EQUAL_PERIOD" | "MATCHED_WEEKDAYS",
  comparisonPolicyVersion: "previous_equal_period.v1" | "matched_weekdays.v1",
): DecisionSalesComparisonRead {
  const currentNet = new Prisma.Decimal(current.payload.netAmount);
  const comparisonNet = new Prisma.Decimal(comparison.payload.netAmount);
  const difference = currentNet.minus(comparisonNet);
  const percentDifference = current.dataQuality === "READY" && comparison.dataQuality === "READY" && !comparisonNet.isZero()
    ? difference.dividedBy(comparisonNet).times(100).toFixed(2)
    : null;
  return {
    metricCode, metricDefinitionVersion, comparisonPolicyCode, comparisonPolicyVersion,
    dataQuality: comparisonQuality(current.dataQuality, comparison.dataQuality), current, comparison,
    payload: {
      currencyCode: "SAR", currentNetAmount: currentNet.toFixed(4), comparisonNetAmount: comparisonNet.toFixed(4),
      differenceNetAmount: difference.toFixed(4), percentDifference,
      currentCustomerCount: current.payload.customerCount, comparisonCustomerCount: comparison.payload.customerCount,
    },
  };
}

function sourceReferencesForSales(
  summaries: readonly Readonly<{ id: string; sourceChecksum: string }>[],
  period: Readonly<{ from: Date; to: Date }>,
) {
  if (summaries.length <= 100) return summaries.map((summary) => ({ sourceType: "FinanceDailyFinancialSummary", sourceId: summary.id, checksum: summary.sourceChecksum }));
  const checksum = createHash("sha256").update(canonicalJson(summaries.map((summary) => ({ id: summary.id, checksum: summary.sourceChecksum })))).digest("hex");
  return [{ sourceType: "FinanceDailyFinancialSummaryBatch", sourceId: `${day(period.from)}:${day(period.to)}:${summaries.length}`, checksum }];
}

function salesFreshnessLimitMs(): number {
  const configuredHours = Number(process.env.BASEER_DECISION_SALES_FRESHNESS_MAX_HOURS);
  const hours = Number.isInteger(configuredHours) && configuredHours >= 1 && configuredHours <= 168 ? configuredHours : 48;
  return hours * 60 * 60 * 1_000;
}

function startOfRiyadhDay(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
}
