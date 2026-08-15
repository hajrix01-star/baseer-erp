import {
  aiCompanyIdentityReceiptSchema,
  aiPlatformConfigurationReceiptSchema,
  aiProviderConfigurationReceiptSchema,
  aiSystemIdentityReceiptSchema,
  companyIdSchema,
  configureAiProviderRequestSchema,
  createAiIdentityRequestSchema,
  createAiSystemIdentityRequestSchema,
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
  UnauthorizedException,
} from "@nestjs/common";

import { AiPlatformService } from "./ai-platform.service.js";

@Controller("administration/ai")
export class AiPlatformController {
  constructor(private readonly platform: AiPlatformService) {}

  @Get("configuration")
  async read(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    return aiPlatformConfigurationReceiptSchema.parse(
      await this.platform.read(this.scope(authorization, companyId)),
    );
  }

  @Post("provider-configurations")
  @HttpCode(201)
  async configureProvider(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = configureAiProviderRequestSchema.safeParse(body);
    if (!request.success) {
      throw new BadRequestException("Invalid AI provider configuration.");
    }
    const scope = this.scope(authorization, companyId);
    const context = await this.platform.authorizeProviderWrite(
      scope.accessToken,
      scope.companyId,
    );
    return aiProviderConfigurationReceiptSchema.parse(
      await this.platform.configureProvider(context, request.data),
    );
  }

  @Post("system-identity")
  @HttpCode(201)
  async createSystemIdentity(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createAiSystemIdentityRequestSchema.safeParse(body);
    if (!request.success) {
      throw new BadRequestException("Invalid system AI identity.");
    }
    const scope = this.scope(authorization, companyId);
    const context = await this.platform.authorizeSystemIdentityWrite(
      scope.accessToken,
      scope.companyId,
    );
    return aiSystemIdentityReceiptSchema.parse(
      await this.platform.createSystemIdentity(context, request.data),
    );
  }

  @Post("identities")
  @HttpCode(201)
  async createIdentity(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createAiIdentityRequestSchema.safeParse(body);
    if (!request.success) {
      throw new BadRequestException("Invalid AI company identity.");
    }
    const scope = this.scope(authorization, companyId);
    const context = await this.platform.authorizeIdentityWrite(
      scope.accessToken,
      scope.companyId,
    );
    return aiCompanyIdentityReceiptSchema.parse(
      await this.platform.createIdentity(context, request.data),
    );
  }

  private scope(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) {
      throw new UnauthorizedException("Invalid authentication credentials.");
    }
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) {
      throw new ForbiddenException("Company AI scope is not permitted.");
    }
    return { accessToken, companyId: parsedCompanyId.data };
  }
}