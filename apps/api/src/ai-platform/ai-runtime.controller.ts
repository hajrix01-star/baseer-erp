import {
  explainDecisionAlertReceiptSchema,
  explainDecisionAlertRequestSchema,
  explainMarketingCampaignReceiptSchema,
  explainMarketingCampaignRequestSchema,
  aiRuntimePreflightReceiptSchema,
  aiRuntimePreflightRequestSchema,
  companyIdSchema,
} from "@baseer-erp/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";

import { AiRuntimeService } from "./ai-runtime.service.js";

@Controller("administration/ai")
export class AiRuntimeController {
  constructor(private readonly runtime: AiRuntimeService) {}

  @Get("skills")
  async list(
    @Query("moduleKey") moduleKey: string | undefined,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const scope = this.scope(authorization, companyId);
    return moduleKey
      ? this.runtime.list({ ...scope, moduleKey })
      : this.runtime.list(scope);
  }

  @Post("runtime/preflight")
  @HttpCode(200)
  async preflight(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = aiRuntimePreflightRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid AI runtime request.");
    const scope = this.scope(authorization, companyId);
    return aiRuntimePreflightReceiptSchema.parse(
      await this.runtime.preflight({ ...scope, request: request.data }),
    );
  }

  @Post("runtime/decision-alert-explanations")
  @HttpCode(200)
  async explainDecisionAlert(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = explainDecisionAlertRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid AI decision-alert explanation request.");
    const scope = this.scope(authorization, companyId);
    return explainDecisionAlertReceiptSchema.parse(
      await this.runtime.explainDecisionAlert({ ...scope, request: request.data }),
    );
  }

  @Post("runtime/marketing-campaign-explanations")
  @HttpCode(200)
  async explainMarketingCampaign(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = explainMarketingCampaignRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid AI Marketing campaign explanation request.");
    const scope = this.scope(authorization, companyId);
    return explainMarketingCampaignReceiptSchema.parse(
      await this.runtime.explainMarketingCampaign({ ...scope, request: request.data }),
    );
  }

  private scope(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException("Company AI scope is not permitted.");
    return { accessToken, companyId: parsedCompanyId.data };
  }
}
