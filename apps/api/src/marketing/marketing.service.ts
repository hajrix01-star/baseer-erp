import { randomUUID } from "node:crypto";

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { ArchiveMarketingCampaignRequest, CreateMarketingCampaignRequest, LinkMarketingCampaignContextRequest, LinkMarketingCampaignFinancialDocumentRequest, RequestMarketingProviderConnectionSetup, UpdateMarketingCampaignRequest, UpdateMarketingReputationReplyPolicyRequest } from "@baseer-erp/contracts";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { DecisionIntelligenceService } from "../decision-intelligence/decision-intelligence.service.js";
import { Prisma } from "../generated/prisma/client.js";

type Receipt = { id: string; replayed: boolean };

/**
 * The internal marketing foundation. It owns campaign context and references
 * existing, posted financial documents; it never posts finance, calls a
 * provider, or stores Google content.
 */
@Injectable()
export class MarketingService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService, private readonly decisions: DecisionIntelligenceService) {}

  async workspace(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const campaigns = await tx.marketingCampaign.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: [{ status: "asc" }, { startsOn: "desc" }, { createdAt: "desc" }],
        take: 1_000,
      });
      const replyPolicy = await tx.marketingReputationReplyPolicy.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
      });
      return {
        companyId: context.companyId,
        campaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          titleAr: campaign.titleAr,
          titleEn: campaign.titleEn,
          platform: campaign.platform,
          externalReference: campaign.externalReference,
          startsOn: day(campaign.startsOn),
          endsOn: day(campaign.endsOn),
          status: campaign.status,
          objective: campaign.objective,
          notes: campaign.notes,
          plannedCost: campaign.plannedCost?.toFixed(4) ?? null,
          plannedCurrencyCode: campaign.plannedCurrencyCode,
          createdAt: campaign.createdAt.toISOString(),
          updatedAt: campaign.updatedAt.toISOString(),
        })),
        readiness: [
          { provider: "GOOGLE_ADS" as const, status: "NOT_CONNECTED" as const, messageAr: "Google Ads غير متصل في هذه المرحلة؛ لا تُعرض أي تكلفة أو تحويلات أو قرارات إنفاق." },
          { provider: "GOOGLE_BUSINESS" as const, status: "NOT_CONNECTED" as const, messageAr: "ملف Google Business غير متصل؛ لا توجد تقييمات أو منشورات أو صلاحية نشر في هذه المرحلة." },
        ],
        replyPolicy: publicReplyPolicy(replyPolicy),
      };
    });
  }

  async createCampaign(context: TrustedCompanyActorContext, request: CreateMarketingCampaignRequest): Promise<Receipt> {
    return this.withIdempotency(context, "marketing.campaign.create", request.idempotencyKey, request, async (tx) => {
      const id = randomUUID();
      const campaign = normalizeCampaign(request);
      await tx.marketingCampaign.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, createdByUserId: context.actorUserId, ...campaign } });
      await this.audit(tx, context, "marketing.campaign.created", id, null, { ...campaign, status: campaign.status });
      return { id, replayed: false };
    }, 201);
  }

  async updateCampaign(context: TrustedCompanyActorContext, campaignId: string, request: UpdateMarketingCampaignRequest): Promise<Receipt> {
    return this.withIdempotency(context, "marketing.campaign.update", request.idempotencyKey, { campaignId, ...request }, async (tx) => {
      const existing = await tx.marketingCampaign.findFirst({ where: { id: campaignId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!existing) throw new NotFoundException("The marketing campaign was not found.");
      if (existing.status === "ARCHIVED") throw new ConflictException("Archived campaigns cannot be changed.");
      const campaign = normalizeCampaign(request);
      await tx.marketingCampaign.update({ where: { id: existing.id }, data: campaign });
      await this.audit(tx, context, "marketing.campaign.updated", existing.id, publicCampaign(existing), campaign);
      return { id: existing.id, replayed: false };
    }, 200);
  }

  async archiveCampaign(context: TrustedCompanyActorContext, request: ArchiveMarketingCampaignRequest): Promise<Receipt> {
    return this.withIdempotency(context, "marketing.campaign.archive", request.idempotencyKey, request, async (tx) => {
      const existing = await tx.marketingCampaign.findFirst({ where: { id: request.campaignId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!existing) throw new NotFoundException("The marketing campaign was not found.");
      if (existing.status === "ARCHIVED") return { id: existing.id, replayed: false };
      await tx.marketingCampaign.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
      await this.audit(tx, context, "marketing.campaign.archived", existing.id, publicCampaign(existing), { status: "ARCHIVED", reason: request.reason });
      return { id: existing.id, replayed: false };
    }, 200);
  }

  async linkFinancialDocument(context: TrustedCompanyActorContext, campaignId: string, request: LinkMarketingCampaignFinancialDocumentRequest): Promise<Receipt> {
    return this.withIdempotency(context, "marketing.campaign.financial_document.link", request.idempotencyKey, { campaignId, ...request }, async (tx) => {
      const [campaign, document] = await Promise.all([
        tx.marketingCampaign.findFirst({ where: { id: campaignId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } }),
        tx.financeOutflowDocument.findFirst({ where: { id: request.financialDocumentId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, status: true } }),
      ]);
      if (!campaign) throw new NotFoundException("The marketing campaign was not found.");
      if (!document) throw new NotFoundException("The financial document was not found in the active company.");
      if (document.status !== "POSTED") throw new ConflictException("Only a posted financial document can be linked to a campaign.");
      const existing = await tx.marketingCampaignFinancialLink.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, financialDocumentId: document.id }, select: { id: true } });
      if (existing) throw new ConflictException("The financial document is already linked to a marketing campaign.");
      const id = randomUUID();
      await tx.marketingCampaignFinancialLink.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, campaignId: campaign.id, financialDocumentId: document.id, createdByUserId: context.actorUserId } });
      await this.audit(tx, context, "marketing.campaign.financial_document.linked", campaign.id, null, { linkId: id, financialDocumentId: document.id });
      return { id, replayed: false };
    }, 201);
  }

  /** Returns references only; Finance remains the owner of document detail. */
  async linkableFinancialDocuments(context: TrustedCompanyActorContext, campaignId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const campaign = await tx.marketingCampaign.findFirst({ where: { id: campaignId, tenantId: context.tenantId, companyId: context.companyId }, select: { startsOn: true, endsOn: true } });
      if (!campaign) throw new NotFoundException("The marketing campaign was not found.");
      const documents = await tx.financeOutflowDocument.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: "POSTED",
          marketingCampaignFinancialLinks: { none: {} },
          ...(campaign.startsOn && campaign.endsOn ? { businessDate: { gte: campaign.startsOn, lte: campaign.endsOn } } : {}),
        },
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: { id: true, documentNumber: true, businessDate: true, kind: true, grossAmount: true },
      });
      return { documents: documents.map((document) => ({ id: document.id, documentNumber: document.documentNumber, businessDate: day(document.businessDate)!, kind: document.kind, grossAmount: document.grossAmount.toFixed(4) })) };
    });
  }

  async linkContext(context: TrustedCompanyActorContext, campaignId: string, request: LinkMarketingCampaignContextRequest): Promise<Receipt> {
    return this.withIdempotency(context, "marketing.campaign.context.link", request.idempotencyKey, { campaignId, ...request }, async (tx) => {
      const campaign = await tx.marketingCampaign.findFirst({ where: { id: campaignId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } });
      if (!campaign) throw new NotFoundException("The marketing campaign was not found.");
      const id = randomUUID();
      if ("companyEventId" in request) {
        const event = await tx.decisionCompanyContextEvent.findFirst({ where: { id: request.companyEventId, tenantId: context.tenantId, companyId: context.companyId, status: "PUBLISHED" }, select: { id: true } });
        if (!event) throw new NotFoundException("The published company context event was not found.");
        const existing = await tx.marketingCampaignContextLink.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, campaignId, companyContextEventId: event.id }, select: { id: true } });
        if (existing) throw new ConflictException("The company context event is already linked to this campaign.");
        await tx.marketingCampaignContextLink.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, campaignId, companyContextEventId: event.id, createdByUserId: context.actorUserId } });
      } else {
        const company = await tx.company.findFirstOrThrow({ where: { id: context.companyId, tenantId: context.tenantId }, select: { contextLocationCode: true } });
        const event = await tx.decisionGlobalContextEvent.findFirst({ where: { id: request.globalEventId, tenantId: context.tenantId, status: "PUBLISHED", OR: [{ scope: "TENANT_GLOBAL" }, ...(company.contextLocationCode ? [{ scope: "AREA" as const, locationCode: company.contextLocationCode }] : [])] }, include: { revisions: { where: { status: "PUBLISHED" }, select: { id: true, revision: true } } } });
        const revision = event?.revisions.find((item) => item.revision === event.currentRevision);
        if (!event || !revision) throw new NotFoundException("The published context event was not available to the active company.");
        const existing = await tx.marketingCampaignContextLink.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, campaignId, globalContextRevisionId: revision.id }, select: { id: true } });
        if (existing) throw new ConflictException("The context event revision is already linked to this campaign.");
        await tx.marketingCampaignContextLink.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, campaignId, globalContextRevisionId: revision.id, createdByUserId: context.actorUserId } });
      }
      await this.audit(tx, context, "marketing.campaign.context.linked", campaign.id, null, { linkId: id, target: "companyEventId" in request ? request.companyEventId : request.globalEventId });
      return { id, replayed: false };
    }, 201);
  }

  async campaignAnalysis(context: TrustedCompanyActorContext, campaignId: string) {
    const campaign = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.marketingCampaign.findFirst({
      where: { id: campaignId, tenantId: context.tenantId, companyId: context.companyId },
      include: { financialLinks: { include: { financialDocument: { select: { id: true, documentNumber: true, businessDate: true, kind: true, status: true, grossAmount: true, netAmount: true, vatAmount: true } } }, orderBy: { createdAt: "asc" } }, contextLinks: { select: { companyContextEventId: true, globalContextRevision: { select: { eventId: true } } } } },
    }));
    if (!campaign) throw new NotFoundException("The marketing campaign was not found.");
    const documents = campaign.financialLinks.filter((link) => link.financialDocument.status === "POSTED").map((link) => ({
      linkId: link.id, documentId: link.financialDocument.id, documentNumber: link.financialDocument.documentNumber, businessDate: day(link.financialDocument.businessDate)!, kind: link.financialDocument.kind, status: "POSTED" as const,
      grossAmount: link.financialDocument.grossAmount.toFixed(4), netAmount: link.financialDocument.netAmount.toFixed(4), vatAmount: link.financialDocument.vatAmount.toFixed(4),
    }));
    const linkedActualGrossAmount = documents.reduce((total, document) => total.plus(document.grossAmount), new Prisma.Decimal(0)).toFixed(4);
    if (!campaign.startsOn || !campaign.endsOn) return { campaign: publicCampaign(campaign), period: null, sales: null, linkedFinancialDocuments: documents, linkedActualGrossAmount, spendResult: spendResult(null, campaign.plannedCost ?? new Prisma.Decimal(0), new Prisma.Decimal(linkedActualGrossAmount), 1), relatedContext: [], analysisBoundary: "TEMPORAL_CONTEXT_ONLY_NOT_CAUSATION" as const };
    const period = { from: campaign.startsOn, to: campaign.endsOn };
    const [sales, timeline] = await Promise.all([this.decisions.readSalesMetric(context, period), this.decisions.listTimeline(context, period)]);
    return { campaign: publicCampaign(campaign), period: { fromBusinessDate: day(period.from)!, toBusinessDate: day(period.to)!, timezone: "Asia/Riyadh" as const }, sales, linkedFinancialDocuments: documents, linkedActualGrossAmount, spendResult: spendResult(sales, campaign.plannedCost ?? new Prisma.Decimal(0), new Prisma.Decimal(linkedActualGrossAmount), 1),
      relatedContext: timeline.map((event) => ({ id: event.id, scope: event.scope, eventKind: event.eventKind, titleAr: event.titleAr, startsOn: event.startsOn, endsOn: event.endsOn, verificationStatus: event.verificationStatus, explicitlyLinked: campaign.contextLinks.some((link) => link.companyContextEventId === event.id || link.globalContextRevision?.eventId === event.id) })), analysisBoundary: "TEMPORAL_CONTEXT_ONLY_NOT_CAUSATION" as const };
  }

  async calendar(context: TrustedCompanyActorContext, period: Readonly<{ from: Date; to: Date }>) {
    const [dailySales, timeline, data] = await Promise.all([this.decisions.readSalesDailySeries(context, period), this.decisions.listTimeline(context, period), this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [campaigns, links] = await Promise.all([
        tx.marketingCampaign.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, startsOn: { not: null, lte: period.to }, endsOn: { not: null, gte: period.from }, status: { not: "ARCHIVED" } }, orderBy: { startsOn: "asc" }, take: 1_000 }),
        tx.marketingCampaignFinancialLink.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, financialDocument: { status: "POSTED", businessDate: { gte: period.from, lte: period.to } } }, include: { financialDocument: { select: { businessDate: true, grossAmount: true } } }, take: 1_000 }),
      ]);
      return { campaigns, links, linkedActualGrossAmount: links.reduce((total, link) => total.plus(link.financialDocument.grossAmount), new Prisma.Decimal(0)).toFixed(4) };
    })]);
    const sales = dailySales.metric;
    const linkedSpendByDay = new Map<string, { amount: Prisma.Decimal; count: number }>();
    for (const link of data.links) {
      const businessDate = day(link.financialDocument.businessDate)!;
      const current = linkedSpendByDay.get(businessDate) ?? { amount: new Prisma.Decimal(0), count: 0 };
      linkedSpendByDay.set(businessDate, { amount: current.amount.plus(link.financialDocument.grossAmount), count: current.count + 1 });
    }
    const days = dailySales.days.map((salesDay) => {
      const linked = linkedSpendByDay.get(salesDay.businessDate) ?? { amount: new Prisma.Decimal(0), count: 0 };
      const activeCampaignIds = data.campaigns
        .filter((campaign) => day(campaign.startsOn)! <= salesDay.businessDate && day(campaign.endsOn)! >= salesDay.businessDate)
        .map((campaign) => campaign.id);
      return {
        businessDate: salesDay.businessDate,
        officialNetSales: salesDay.netAmount,
        salesDayQuality: salesDay.dayQuality,
        linkedActualSpend: linked.amount.toFixed(4),
        linkedFinancialDocumentCount: linked.count,
        activeCampaignIds,
      };
    });
    const plannedCampaignCost = data.campaigns.reduce((total, campaign) => total.plus(campaign.plannedCost ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));
    return { period: { fromBusinessDate: day(period.from)!, toBusinessDate: day(period.to)!, timezone: "Asia/Riyadh" as const }, sales, campaigns: data.campaigns.map(publicCampaign), days,
      context: timeline.map((event) => ({ id: event.id, scope: event.scope, eventKind: event.eventKind, titleAr: event.titleAr, startsOn: event.startsOn, endsOn: event.endsOn, verificationStatus: event.verificationStatus })),
      linkedActualGrossAmount: data.linkedActualGrossAmount, spendResult: spendResult(sales, plannedCampaignCost, new Prisma.Decimal(data.linkedActualGrossAmount), data.campaigns.length), dataQuality: sales.dataQuality, analysisBoundary: "TEMPORAL_CONTEXT_ONLY_NOT_CAUSATION" as const };
  }

  async providerConnections(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const stored = await tx.marketingProviderConnection.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { provider: true, status: true, setupRequestedAt: true },
      });
      const byProvider = new Map(stored.map((connection) => [connection.provider, connection]));
      return {
        liveOauthEnabled: false as const,
        connections: (["GOOGLE_ADS", "GOOGLE_BUSINESS"] as const).map((provider) => publicProviderConnection(provider, byProvider.get(provider))),
      };
    });
  }

  /** Records a company-admin request only. It never starts OAuth, opens a
   * browser redirect, stores a secret, or makes an outbound provider call. */
  async requestProviderConnectionSetup(
    context: TrustedCompanyActorContext,
    provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS",
    request: RequestMarketingProviderConnectionSetup,
  ): Promise<Receipt> {
    return this.withIdempotency(context, "marketing.provider_connection.setup.request", request.idempotencyKey, { provider }, async (tx) => {
      const current = await tx.marketingProviderConnection.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, provider } });
      const timestamp = new Date();
      const connection = current
        ? await tx.marketingProviderConnection.update({ where: { id: current.id }, data: { status: "SETUP_REQUESTED", setupRequestedAt: timestamp, setupRequestedByUserId: context.actorUserId } })
        : await tx.marketingProviderConnection.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, provider, status: "SETUP_REQUESTED", setupRequestedAt: timestamp, setupRequestedByUserId: context.actorUserId } });
      await this.audit(tx, context, "marketing.provider_connection.setup_requested", connection.id, current ? publicProviderConnection(provider, current) : null, publicProviderConnection(provider, connection), "MarketingProviderConnection");
      return { id: connection.id, replayed: false };
    }, 201);
  }

  async updateReputationReplyPolicy(context: TrustedCompanyActorContext, request: UpdateMarketingReputationReplyPolicyRequest): Promise<Receipt> {
    return this.withIdempotency(context, "marketing.reputation.reply_policy.update", request.idempotencyKey, request, async (tx) => {
      const existing = await tx.marketingReputationReplyPolicy.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId } });
      const next = normalizeReplyPolicy(request);
      const policy = existing
        ? await tx.marketingReputationReplyPolicy.update({ where: { id: existing.id }, data: { ...next, revision: { increment: 1 }, updatedByUserId: context.actorUserId } })
        : await tx.marketingReputationReplyPolicy.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, updatedByUserId: context.actorUserId, ...next } });
      await this.audit(tx, context, "marketing.reputation.reply_policy.updated", policy.id, existing ? publicReplyPolicy(existing) : null, publicReplyPolicy(policy));
      return { id: policy.id, replayed: false };
    }, 200);
  }

  private async withIdempotency(context: TrustedCompanyActorContext, operation: string, key: string, request: unknown, action: (tx: Prisma.TransactionClient) => Promise<Receipt>, status: number) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      let begun;
      try { begun = await this.idempotency.beginInTransaction(tx, context, { operation, key, request: request as CanonicalJsonValue, expiresAt: new Date(Date.now() + 86_400_000) }); }
      catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was already used with a different marketing request."); throw error; }
      if (begun.kind === "replay") return { ...(begun.response.body as Receipt), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The marketing request is still in progress.");
      const receipt = await action(tx);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status, headers: null, body: receipt as CanonicalJsonValue } });
      return receipt;
    });
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, beforeJson: unknown, afterJson: unknown, entityType = "MarketingCampaign") {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: randomUUID(), beforeJson: beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } });
  }
}

function normalizeCampaign(value: Omit<CreateMarketingCampaignRequest, "idempotencyKey">) {
  return {
    titleAr: value.titleAr.trim(), titleEn: blank(value.titleEn), platform: value.platform,
    externalReference: blank(value.externalReference), startsOn: date(value.startsOn), endsOn: date(value.endsOn),
    status: value.status, objective: blank(value.objective), notes: blank(value.notes),
    plannedCost: value.plannedCost ? new Prisma.Decimal(value.plannedCost) : null,
    plannedCurrencyCode: value.plannedCost ? "SAR" : null,
  };
}
function blank(value: string | undefined) { const normalized = value?.trim(); return normalized ? normalized : null; }
function date(value: string | undefined) { return value ? new Date(`${value}T00:00:00.000Z`) : null; }
function day(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }

function publicProviderConnection(
  provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS",
  connection: Readonly<{ status: "NOT_CONNECTED" | "SETUP_REQUESTED" | "BLOCKED"; setupRequestedAt: Date | null }> | undefined,
) {
  const requested = connection?.status === "SETUP_REQUESTED";
  const business = provider === "GOOGLE_BUSINESS";
  return {
    provider,
    status: connection?.status ?? "NOT_CONNECTED",
    setupRequestedAt: connection?.setupRequestedAt?.toISOString() ?? null,
    platformReadiness: "PLATFORM_SETUP_REQUIRED" as const,
    allowedOperation: business ? "BUSINESS_READ_AND_GOVERNED_PUBLISH" as const : "ADS_READ_ONLY" as const,
    messageAr: requested
      ? "تم تسجيل طلب تهيئة هذا الموصل للشركة. لا يوجد اتصال أو تفويض Google حتى يعتمد مالك المنصة إعداد المشروع وسياسة الموصل."
      : business
        ? "يتطلب Google Business مشروع Google معتمداً وموافقة وتفويض OAuth وسياسة احتفاظ قبل بدء الربط الذاتي. لا توجد بيانات أو صلاحية نشر حالياً."
        : "يتطلب Google Ads إعداداً مركزياً معتمداً (مشروع Google وdeveloper token وسياسة قراءة فقط) قبل بدء الربط الذاتي. لا توجد بيانات أو صلاحية إنفاق حالياً.",
    messageEn: requested
      ? "This company's setup request is recorded. No Google connection or authorization exists until the platform owner approves the project setup and provider policy."
      : business
        ? "Google Business needs an approved Google project, consent, OAuth authorization, and a retention policy before self-service connection begins. No data or publishing authority exists now."
        : "Google Ads needs approved central setup (Google project, developer token, and read-only policy) before self-service connection begins. No data or spending authority exists now.",
  };
}
function spendResult(sales: Awaited<ReturnType<DecisionIntelligenceService["readSalesMetric"]>> | null, plannedCampaignCost: Prisma.Decimal, linkedActualSpend: Prisma.Decimal, campaignCount: number) {
  const salesReady = sales?.dataQuality === "READY";
  const officialNetSales = salesReady ? new Prisma.Decimal(sales.payload.netAmount) : null;
  const spendToSalesPercent = officialNetSales && !officialNetSales.isZero() ? linkedActualSpend.div(officialNetSales).mul(100).toFixed(2) : null;
  const hasSpend = linkedActualSpend.gt(0);
  const conclusionAr = !sales ? "أضف فترة للحملة لقراءة المبيعات الرسمية ونتيجة الصرف الوصفية." : !salesReady ? "لا يمكن مقارنة الصرف بالمبيعات لأن جودة قراءة المبيعات ليست جاهزة؛ لا تتحول البيانات الناقصة إلى صفر." : !hasSpend ? "لا توجد مصروفات تسويقية مثبتة مرتبطة في هذه الفترة؛ لا يمكن تقييم نتيجة الصرف بعد." : `المصروف المرتبط المثبت ${linkedActualSpend.toFixed(4)} ر.س مقابل مبيعات رسمية ${officialNetSales!.toFixed(4)} ر.س${spendToSalesPercent ? ` (${spendToSalesPercent}% من مبيعات الفترة)` : ""}. هذه قراءة وصفية زمنية وليست ROI أو إثباتاً للأثر.`;
  const conclusionEn = !sales ? "Add campaign dates to read official sales and descriptive spend results." : !salesReady ? "Spend cannot be compared with sales because sales data quality is not ready; incomplete data is never turned into zero." : !hasSpend ? "There is no posted campaign-linked spend in this period, so spend results cannot yet be assessed." : `Posted linked spend is ${linkedActualSpend.toFixed(4)} SAR against official net sales of ${officialNetSales!.toFixed(4)} SAR${spendToSalesPercent ? ` (${spendToSalesPercent}% of period sales)` : ""}. This is a descriptive temporal read, not ROI or proof of impact.`;
  return { plannedCampaignCost: plannedCampaignCost.toFixed(4), linkedActualSpend: linkedActualSpend.toFixed(4), officialNetSales: officialNetSales?.toFixed(4) ?? null, spendToSalesPercent, campaignCount, salesDataQuality: sales?.dataQuality ?? "NO_DATA", googleAdsStatus: "NOT_CONNECTED" as const, conclusionAr, conclusionEn, analysisBoundary: "DESCRIPTIVE_SPEND_SALES_ONLY_NOT_ROI_OR_CAUSATION" as const };
}
function publicCampaign(campaign: { id?: string; titleAr: string; titleEn: string | null; platform: string; externalReference: string | null; startsOn: Date | null; endsOn: Date | null; status: string; objective: string | null; notes: string | null; plannedCost: Prisma.Decimal | null; plannedCurrencyCode: string | null; createdAt?: Date; updatedAt?: Date }) {
  return { ...(campaign.id ? { id: campaign.id } : {}), titleAr: campaign.titleAr, titleEn: campaign.titleEn, platform: campaign.platform, externalReference: campaign.externalReference, startsOn: day(campaign.startsOn), endsOn: day(campaign.endsOn), status: campaign.status, objective: campaign.objective, notes: campaign.notes, plannedCost: campaign.plannedCost?.toFixed(4) ?? null, plannedCurrencyCode: campaign.plannedCurrencyCode, ...(campaign.createdAt ? { createdAt: campaign.createdAt.toISOString() } : {}), ...(campaign.updatedAt ? { updatedAt: campaign.updatedAt.toISOString() } : {}) };
}

function normalizeReplyPolicy(value: UpdateMarketingReputationReplyPolicyRequest) {
  return {
    automationStatus: value.automationStatus,
    authoringMethod: value.authoringMethod,
    tone: value.tone,
    languageMode: value.languageMode,
    autoFourFiveEnabled: value.autoFourFiveEnabled,
    autoThreeIfSafe: value.autoThreeIfSafe,
    signature: blank(value.signature),
  };
}

function publicReplyPolicy(policy: { automationStatus: "DISABLED" | "ENABLED" | "PAUSED"; authoringMethod: "TEMPLATE" | "BASIRA_DRAFT"; tone: "WARM" | "PROFESSIONAL" | "FORMAL"; languageMode: "MATCH_REVIEW" | "ARABIC" | "ENGLISH"; autoFourFiveEnabled: boolean; autoThreeIfSafe: boolean; signature: string | null; revision: number } | null) {
  return policy ? { automationStatus: policy.automationStatus, authoringMethod: policy.authoringMethod, tone: policy.tone, languageMode: policy.languageMode, autoFourFiveEnabled: policy.autoFourFiveEnabled, autoThreeIfSafe: policy.autoThreeIfSafe, signature: policy.signature, revision: policy.revision, executionReadiness: "NOT_CONNECTED" as const } : { automationStatus: "DISABLED" as const, authoringMethod: "TEMPLATE" as const, tone: "WARM" as const, languageMode: "MATCH_REVIEW" as const, autoFourFiveEnabled: true, autoThreeIfSafe: true, signature: null, revision: 0 + 1, executionReadiness: "NOT_CONNECTED" as const };
}
