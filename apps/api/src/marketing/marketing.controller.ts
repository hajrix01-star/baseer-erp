import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Put, UnauthorizedException } from "@nestjs/common";
import { archiveMarketingCampaignRequestSchema, createMarketingCampaignRequestSchema, marketingEntityReceiptSchema, marketingWorkspaceSchema, updateMarketingCampaignRequestSchema, updateMarketingReputationReplyPolicyRequestSchema } from "@baseer-erp/contracts";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { MarketingService } from "./marketing.service.js";

@Controller("marketing")
export class MarketingController {
  constructor(private readonly companyContext: CompanyContextService, private readonly marketing: MarketingService) {}

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

  @Put("reputation/reply-policy")
  async updateReplyPolicy(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateMarketingReputationReplyPolicyRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException("Invalid marketing reputation reply policy request.");
    return marketingEntityReceiptSchema.parse(await this.marketing.updateReputationReplyPolicy(await this.context(authorization, companyId, "marketing.reputation.policy.manage"), parsed.data));
  }

  private async context(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken || !companyId) throw new UnauthorizedException("Invalid authentication credentials.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
