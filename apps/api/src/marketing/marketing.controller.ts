import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Put, Query, UnauthorizedException } from "@nestjs/common";
import { archiveMarketingCampaignRequestSchema, createMarketingCampaignAnalysisFeedbackRequestSchema, createMarketingCampaignRequestSchema, linkMarketingCampaignContextRequestSchema, linkMarketingCampaignFinancialDocumentRequestSchema, marketingCalendarQuerySchema, marketingCalendarReadSchema, marketingCampaignAnalysisSchema, marketingEntityReceiptSchema, marketingLinkableFinancialDocumentsSchema, marketingProviderConnectionsReadSchema, marketingProviderSchema, marketingTargetMonthSchema, marketingWorkspaceSchema, requestMarketingProviderConnectionSetupSchema, updateMarketingCampaignRequestSchema, updateMarketingReputationReplyPolicyRequestSchema, upsertMarketingSalesTargetRequestSchema } from "@baseer-erp/contracts";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { MarketingService } from "./marketing.service.js";
import { MarketingGoogleOAuthService } from "./marketing-google-oauth.service.js";

@Controller("marketing")
export class MarketingController {
  constructor(private readonly companyContext: CompanyContextService, private readonly marketing: MarketingService, private readonly googleOAuth: MarketingGoogleOAuthService) {}

  @Get()
  async workspace(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return marketingWorkspaceSchema.parse(await this.marketing.workspace(await this.context(authorization, companyId, "marketing.insights.read")));
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
  async beginGoogleAuthorization(@Param("provider") provider: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    // This incomplete pre-connector route must never make a Google consent URL
    // reachable just because platform variables happen to be present. A later
    // Provider Decision Record enables the separate, named release gate after
    // callback, vault, selection, revocation and pilot controls exist.
    if (process.env.BASEER_MARKETING_OAUTH_EXPERIMENT_ENABLED !== "true") {
      throw new ForbiddenException("Google authorization is not enabled for this Baseer release.");
    }
    const parsedProvider = marketingProviderSchema.safeParse(provider);
    if (!parsedProvider.success) throw new BadRequestException("Invalid provider connection request.");
    return this.googleOAuth.begin(await this.context(authorization, companyId, "marketing.google-connection.manage"), parsedProvider.data);
  }

  @Put("reputation/reply-policy")
  async updateReplyPolicy(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateMarketingReputationReplyPolicyRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing reputation reply policy request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.updateReputationReplyPolicy(await this.context(authorization, companyId, "marketing.reputation.policy.manage"), parsed.data));
  }

  private async context(authorization: string | undefined, companyId: string | undefined, capability: string | readonly string[]) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken || !companyId) throw new UnauthorizedException("Invalid authentication credentials.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId, requiredCapabilities: typeof capability === "string" ? [capability] : [...capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
