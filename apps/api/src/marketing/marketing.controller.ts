import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, Post, Put, Query, Res, UnauthorizedException } from "@nestjs/common";
import { analysisReadinessReceiptSchema, archiveMarketingCampaignRequestSchema, createMarketingCampaignAnalysisFeedbackRequestSchema, createMarketingCampaignRequestSchema, linkMarketingCampaignContextRequestSchema, linkMarketingCampaignFinancialDocumentRequestSchema, marketingCalendarQuerySchema, marketingCalendarReadSchema, marketingCampaignAnalysisSchema, marketingEntityReceiptSchema, marketingGoogleBusinessPilotDisconnectReceiptSchema, marketingGoogleBusinessReviewsReadSchema, marketingGoogleBusinessReviewSyncReceiptSchema, marketingLinkableFinancialDocumentsSchema, marketingProviderConnectionsReadSchema, marketingProviderSchema, marketingTargetMonthSchema, marketingWorkspaceSchema, requestMarketingProviderConnectionSetupSchema, stopMarketingCampaignRequestSchema, updateMarketingCampaignRequestSchema, updateMarketingReputationReplyPolicyRequestSchema, upsertMarketingSalesTargetRequestSchema } from "@baseer-erp/contracts";
import type { FastifyReply } from "fastify";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { MarketingGoogleBusinessOAuthPilotService } from "./marketing-google-business-oauth-pilot.service.js";
import { MarketingGoogleBusinessReviewsService } from "./marketing-google-business-reviews.service.js";
import { MarketingService } from "./marketing.service.js";
import { AnalysisReadinessService } from "../ai-platform/analysis-readiness.service.js";

@Controller("marketing")
export class MarketingController {
  constructor(private readonly companyContext: CompanyContextService, private readonly marketing: MarketingService, private readonly analysisReadiness: AnalysisReadinessService, private readonly googleBusinessPilot: MarketingGoogleBusinessOAuthPilotService, private readonly googleBusinessReviews: MarketingGoogleBusinessReviewsService) {}

  @Get()
  async workspace(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingWorkspaceSchema.parse(await this.marketing.workspace(await this.context(authorization, companyId, "marketing.insights.read")));
  }

  @Get("basira/analysis-readiness")
  async basiraAnalysisReadiness(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return analysisReadinessReceiptSchema.parse(await this.analysisReadiness.marketingWorkspace(await this.context(authorization, companyId, ["marketing.insights.read", "platform.ai.use"])));
  }

  @Get("campaigns/:campaignId/basira/analysis-readiness")
  async campaignBasiraAnalysisReadiness(@Param("campaignId") campaignId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return analysisReadinessReceiptSchema.parse(await this.analysisReadiness.marketingCampaign(await this.context(authorization, companyId, ["marketing.insights.read", "platform.ai.use"]), campaignId));
  }

  @Post("campaigns") @HttpCode(201)
  async create(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = createMarketingCampaignRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing campaign request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.createCampaign(await this.context(authorization, companyId, "marketing.campaign.write"), parsed.data));
  }

  @Put("campaigns/:campaignId")
  async update(@Param("campaignId") campaignId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateMarketingCampaignRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing campaign update.");
    return marketingEntityReceiptSchema.parse(await this.marketing.updateCampaign(await this.context(authorization, companyId, "marketing.campaign.write"), campaignId, parsed.data));
  }

  @Post("campaigns/archive")
  async archive(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = archiveMarketingCampaignRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing campaign archive request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.archiveCampaign(await this.context(authorization, companyId, "marketing.campaign.write"), parsed.data));
  }

  @Post("campaigns/:campaignId/stop")
  async stop(@Param("campaignId") campaignId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = stopMarketingCampaignRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing campaign stop request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.stopCampaign(await this.context(authorization, companyId, "marketing.campaign.write"), campaignId, parsed.data));
  }

  @Post("campaigns/:campaignId/financial-documents") @HttpCode(201)
  async linkFinancialDocument(@Param("campaignId") campaignId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = linkMarketingCampaignFinancialDocumentRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing financial-document link request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.linkFinancialDocument(await this.context(authorization, companyId, ["marketing.campaign.write", "finance.purchase_expense.read"]), campaignId, parsed.data));
  }

  @Get("campaigns/:campaignId/financial-documents/available")
  async linkableFinancialDocuments(@Param("campaignId") campaignId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingLinkableFinancialDocumentsSchema.parse(await this.marketing.linkableFinancialDocuments(await this.context(authorization, companyId, ["marketing.campaign.write", "finance.purchase_expense.read"]), campaignId));
  }

  @Post("campaigns/:campaignId/context") @HttpCode(201)
  async linkContext(@Param("campaignId") campaignId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = linkMarketingCampaignContextRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing context-link request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.linkContext(await this.context(authorization, companyId, "marketing.campaign.write"), campaignId, parsed.data));
  }

  @Get("campaigns/:campaignId/analysis")
  async campaignAnalysis(@Param("campaignId") campaignId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingCampaignAnalysisSchema.parse(await this.marketing.campaignAnalysis(await this.context(authorization, companyId, "marketing.insights.read"), campaignId));
  }

  @Post("campaigns/:campaignId/analysis-feedback") @HttpCode(201)
  async campaignAnalysisFeedback(@Param("campaignId") campaignId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = createMarketingCampaignAnalysisFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid Marketing campaign analysis feedback request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.createCampaignAnalysisFeedback(await this.context(authorization, companyId, "marketing.insights.read"), campaignId, parsed.data));
  }

  @Get("calendar")
  async calendar(@Query() query: Record<string, unknown>, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = marketingCalendarQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid marketing calendar query.");
    return marketingCalendarReadSchema.parse(await this.marketing.calendar(await this.context(authorization, companyId, "marketing.insights.read"), { from: new Date(`${parsed.data.from}T00:00:00.000Z`), to: new Date(`${parsed.data.to}T00:00:00.000Z`) }));
  }

  @Put("sales-targets/:periodMonth")
  async upsertSalesTarget(@Param("periodMonth") periodMonth: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsedMonth = marketingTargetMonthSchema.safeParse(periodMonth);
    const parsedBody = upsertMarketingSalesTargetRequestSchema.safeParse(body);
    if (!parsedMonth.success || !parsedBody.success) throw new BadRequestException("Invalid marketing sales target request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.upsertSalesTarget(await this.context(authorization, companyId, "marketing.campaign.write"), parsedMonth.data, parsedBody.data));
  }

  @Get("provider-connections")
  async providerConnections(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingProviderConnectionsReadSchema.parse(await this.marketing.providerConnections(await this.context(authorization, companyId, "marketing.insights.read")));
  }

  @Post("provider-connections/:provider/setup-requests") @HttpCode(201)
  async requestProviderSetup(@Param("provider") provider: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsedProvider = marketingProviderSchema.safeParse(provider);
    const parsedBody = requestMarketingProviderConnectionSetupSchema.safeParse(body);
    if (!parsedProvider.success || !parsedBody.success) throw new BadRequestException("Invalid provider connection setup request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.requestProviderConnectionSetup(await this.context(authorization, companyId, "marketing.google-connection.manage"), parsedProvider.data, parsedBody.data));
  }

  @Post("provider-connections/:provider/authorization")
  async beginGoogleAuthorization(@Param("provider") _provider: string, @Headers("authorization") _authorization?: string, @Headers("x-baseer-company-id") _companyId?: string) {
    // MKT-01A is a two-layer, hard-off boundary. It must stay false even when
    // a deployment accidentally retains an old experimental environment flag.
    throw new ForbiddenException("Google authorization is not available in this Baseer release.");
  }

  /** MKT-02A is intentionally separate from the generic hard-off route above. */
  @Post("provider-connections/google-business/pilot/authorization")
  async beginGoogleBusinessPilot(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.googleBusinessPilot.begin(await this.context(authorization, companyId, "marketing.google-connection.manage"));
  }

  /** Keeps the provider lifecycle in the single Sources & connection workspace. */
  @Delete("provider-connections/google-business/pilot")
  async disconnectGoogleBusinessPilot(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingGoogleBusinessPilotDisconnectReceiptSchema.parse(await this.googleBusinessPilot.disconnect(await this.context(authorization, companyId, "marketing.google-connection.manage")));
  }

  /** OAuth callbacks have no Baseer session; the single-use state restores context. */
  @Get("provider-connections/google-business/pilot/callback")
  async completeGoogleBusinessPilot(@Query("state") state: string | undefined, @Query("code") code: string | undefined, @Query("error") error: string | undefined, @Res() reply: FastifyReply) {
    await this.googleBusinessPilot.complete({ state, code, error });
    // The callback returns the user to the same single-action workspace. No
    // provider data or OAuth value is placed in the redirect.
    return reply.code(303).redirect("/#module=marketing&page=marketing-sources-policies");
  }

  @Put("reputation/reply-policy")
  async updateReplyPolicy(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateMarketingReputationReplyPolicyRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing reputation reply policy request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.updateReputationReplyPolicy(await this.context(authorization, companyId, "marketing.reputation.policy.manage"), parsed.data));
  }

  @Get("reputation/reviews")
  async reputationReviews(@Query("cursor") cursor: string | undefined, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingGoogleBusinessReviewsReadSchema.parse(await this.googleBusinessReviews.read(await this.context(authorization, companyId, "marketing.insights.read"), cursor));
  }

  @Post("reputation/reviews/sync")
  async synchronizeReputationReviews(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingGoogleBusinessReviewSyncReceiptSchema.parse(await this.googleBusinessReviews.sync(await this.context(authorization, companyId, "marketing.google-connection.manage")));
  }

  private async context(authorization: string | undefined, companyId: string | undefined, capability: string | readonly string[]) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken || !companyId) throw new UnauthorizedException("Invalid authentication credentials.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId, requiredCapabilities: typeof capability === "string" ? [capability] : [...capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
