import { randomUUID } from "node:crypto";

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { ArchiveMarketingCampaignRequest, CreateMarketingCampaignRequest, UpdateMarketingCampaignRequest, UpdateMarketingReputationReplyPolicyRequest } from "@baseer-erp/contracts";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";

type Receipt = { id: string; replayed: boolean };

/**
 * Gate A1 only: a company-scoped campaign register and honest provider
 * readiness. This service has no OAuth, no HTTP provider client, no worker,
 * no financial write and no Google-content storage.
 */
@Injectable()
export class MarketingService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

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

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, campaignId: string, beforeJson: unknown, afterJson: unknown) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: "MarketingCampaign", entityId: campaignId, requestId: randomUUID(), beforeJson: beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } });
  }
}

function normalizeCampaign(value: Omit<CreateMarketingCampaignRequest, "idempotencyKey">) {
  return {
    titleAr: value.titleAr.trim(), titleEn: blank(value.titleEn), platform: value.platform,
    externalReference: blank(value.externalReference), startsOn: date(value.startsOn), endsOn: date(value.endsOn),
    status: value.status, objective: blank(value.objective), notes: blank(value.notes),
  };
}
function blank(value: string | undefined) { const normalized = value?.trim(); return normalized ? normalized : null; }
function date(value: string | undefined) { return value ? new Date(`${value}T00:00:00.000Z`) : null; }
function day(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }
function publicCampaign(campaign: { titleAr: string; titleEn: string | null; platform: string; externalReference: string | null; startsOn: Date | null; endsOn: Date | null; status: string; objective: string | null; notes: string | null }) {
  return { titleAr: campaign.titleAr, titleEn: campaign.titleEn, platform: campaign.platform, externalReference: campaign.externalReference, startsOn: day(campaign.startsOn), endsOn: day(campaign.endsOn), status: campaign.status, objective: campaign.objective, notes: campaign.notes };
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
