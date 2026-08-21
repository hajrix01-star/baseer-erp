import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import type { DecisionSalesMetricRead } from "@baseer-erp/contracts";
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

type AlertFeedback = Readonly<{
  alertId: string;
  kind: string;
  note?: string | undefined;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;

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
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
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
          dataStatus: true,
          sourceChecksum: true,
          reconciledAt: true,
        },
      });
      const byDate = new Map(summaries.map((summary) => [day(summary.businessDate), summary]));
      const missingDays: string[] = [];
      const usable = summaries.filter((summary) => summary.dataStatus !== "PENDING");
      for (let cursor = new Date(period.from); cursor <= period.to; cursor = addDay(cursor)) {
        const summary = byDate.get(day(cursor));
        if (!summary || summary.dataStatus === "PENDING") missingDays.push(day(cursor));
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
      const quality = usable.length === 0
        ? "NO_DATA"
        : missingDays.length > 0
          ? "INCOMPLETE"
          : "READY";
      const freshest = usable.reduce<Date | null>((latest, summary) =>
        latest === null || summary.reconciledAt > latest ? summary.reconciledAt : latest,
      null);
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
        coverage: { requiredDays, availableDays: usable.length, missingDays, excludedDays: [] },
        sourceReferences: usable.map((summary) => ({
          sourceType: "FinanceDailyFinancialSummary",
          sourceId: summary.id,
          checksum: summary.sourceChecksum,
        })),
        payload: {
          currencyCode: "SAR",
          netAmount: total.net.toFixed(4),
          grossAmount: total.gross.toFixed(4),
          vatAmount: total.vat.toFixed(4),
          customerCount: total.customers,
        },
      };
    });
  }

  async listTimeline(context: TrustedCompanyActorContext, period: Readonly<{ from: Date; to: Date }>) {
    assertPeriod(period);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [globalEvents, companyEvents] = await Promise.all([
        transaction.decisionGlobalContextEvent.findMany({
          where: {
            tenantId: context.tenantId,
            status: "PUBLISHED",
            revisions: { some: { status: "PUBLISHED", startsOn: { lte: period.to }, endsOn: { gte: period.from } } },
          },
          select: {
            id: true,
            currentRevision: true,
            eventKind: true,
            revisions: { select: { revision: true, titleAr: true, startsOn: true, endsOn: true, status: true, sourceChecksum: true } },
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
          scope: "GLOBAL" as const,
          eventKind: event.eventKind,
          titleAr: revision.titleAr,
          startsOn: day(revision.startsOn),
          endsOn: day(revision.endsOn),
          verificationStatus: "SYSTEM_RECONCILED" as const,
          sourceReference: revision.sourceChecksum,
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

  async listAlerts(context: TrustedCompanyActorContext, status?: "OPEN" | "ACKNOWLEDGED" | "CLOSED", pageSize = 50) {
    return this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.decisionAlert.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" }, take: pageSize,
      select: { id: true, ruleCode: true, ruleVersion: true, status: true, titleAr: true, createdAt: true, acknowledgedAt: true, closedAt: true, evidenceSnapshotId: true },
    }));
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
function addDay(value: Date): Date { return new Date(value.getTime() + DAY_MS); }
