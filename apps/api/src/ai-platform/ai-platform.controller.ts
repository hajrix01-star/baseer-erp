import {
  aiCompanyIdentityReceiptSchema,
  aiProviderConnectionReceiptSchema,
  aiPlatformConfigurationReceiptSchema,
  aiProviderConfigurationReceiptSchema,
  approveAiCompanyContextRequestSchema,
  activateAiProviderConfigurationRequestSchema,
  aiSystemIdentityReceiptSchema,
  companyIdSchema,
  configureAiProviderRequestSchema,
  createAiCompanyContextDraftRequestSchema,
  createAiHumanInsightRequestSchema,
  createAiEvaluationFeedbackRequestSchema,
  runAiSkillOfflineEvaluationRequestSchema,
  aiSkillEvaluationRunReceiptSchema,
  createAiIdentityRequestSchema,
  createAiSkillActivationRequestSchema,
  createAiSystemIdentityRequestSchema,
  revokeAiCompanyContextRequestSchema,
  revokeAiHumanInsightRequestSchema,
  approveAiHumanInsightRequestSchema,
  aiInterpretationListQuerySchema,
  suspendAiSkillActivationRequestSchema,
} from "@baseer-erp/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";

import { AiPlatformService } from "./ai-platform.service.js";
import { AiInterpretationCenterService } from "./ai-interpretation-center.service.js";

@Controller("administration/ai")
export class AiPlatformController {
  constructor(private readonly platform: AiPlatformService, private readonly interpretationCenter: AiInterpretationCenterService) {}

  @Get("interpretations")
  async interpretations(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const parsed = aiInterpretationListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid Basira interpretation query.");
    const scope = this.scope(authorization, companyId);
    return this.interpretationCenter.list(
      await this.platform.authorizeInterpretationRead(scope.accessToken, scope.companyId),
      parsed.data,
    );
  }

  @Get("interpretations/:interpretationId")
  async interpretation(
    @Param("interpretationId") interpretationId: string,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    if (!isUuid(interpretationId)) throw new BadRequestException("Invalid Basira interpretation identifier.");
    const scope = this.scope(authorization, companyId);
    return this.interpretationCenter.detail(
      await this.platform.authorizeInterpretationRead(scope.accessToken, scope.companyId),
      interpretationId,
    );
  }

  @Post("interpretations/:interpretationId/human-insights")
  @HttpCode(201)
  async createHumanInsight(
    @Param("interpretationId") interpretationId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createAiHumanInsightRequestSchema.safeParse(body);
    if (!request.success || !isUuid(interpretationId)) throw new BadRequestException("Invalid human insight request.");
    const scope = this.scope(authorization, companyId);
    return this.interpretationCenter.createHumanInsight(
      await this.platform.authorizeHumanInsightWrite(scope.accessToken, scope.companyId),
      interpretationId,
      request.data,
    );
  }

  @Post("human-insights/:insightId/approve")
  async approveHumanInsight(
    @Param("insightId") insightId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = approveAiHumanInsightRequestSchema.safeParse(body);
    if (!request.success || !isUuid(insightId)) throw new BadRequestException("Invalid human insight approval.");
    const scope = this.scope(authorization, companyId);
    return this.interpretationCenter.approveHumanInsight(
      await this.platform.authorizeHumanInsightWrite(scope.accessToken, scope.companyId),
      insightId,
      request.data,
    );
  }

  @Post("human-insights/:insightId/revoke")
  async revokeHumanInsight(
    @Param("insightId") insightId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = revokeAiHumanInsightRequestSchema.safeParse(body);
    if (!request.success || !isUuid(insightId)) throw new BadRequestException("Invalid human insight revocation.");
    const scope = this.scope(authorization, companyId);
    return this.interpretationCenter.revokeHumanInsight(
      await this.platform.authorizeHumanInsightWrite(scope.accessToken, scope.companyId),
      insightId,
      request.data,
    );
  }

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

  @Post("provider-connection")
  @HttpCode(200)
  async checkProviderConnection(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const scope = this.scope(authorization, companyId);
    const context = await this.platform.authorizeProviderWrite(
      scope.accessToken,
      scope.companyId,
    );
    return aiProviderConnectionReceiptSchema.parse(
      await this.platform.checkProviderConnection(context),
    );
  }

  @Post("provider-configurations/:configurationId/activate")
  @HttpCode(200)
  async activateProvider(
    @Param("configurationId") configurationId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = activateAiProviderConfigurationRequestSchema.safeParse(body);
    if (!request.success || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configurationId)) {
      throw new BadRequestException("Invalid AI provider activation.");
    }
    const scope = this.scope(authorization, companyId);
    const context = await this.platform.authorizeProviderWrite(scope.accessToken, scope.companyId);
    return aiProviderConfigurationReceiptSchema.parse(
      await this.platform.activateProvider(context, configurationId, request.data),
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

  @Get("governance")
  async governance(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    return this.platform.readGovernance(this.scope(authorization, companyId));
  }

  @Post("company-contexts")
  @HttpCode(201)
  async createCompanyContext(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createAiCompanyContextDraftRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid Basira company context.");
    const scope = this.scope(authorization, companyId);
    return this.platform.createCompanyContextDraft(
      await this.platform.authorizeCompanyContextWrite(scope.accessToken, scope.companyId), request.data,
    );
  }

  @Post("company-contexts/:contextId/approve")
  async approveCompanyContext(
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = approveAiCompanyContextRequestSchema.safeParse(body);
    if (!request.success || !isUuid(contextId)) throw new BadRequestException("Invalid Basira company-context approval.");
    const scope = this.scope(authorization, companyId);
    return this.platform.approveCompanyContext(
      await this.platform.authorizeCompanyContextWrite(scope.accessToken, scope.companyId), contextId, request.data,
    );
  }

  @Post("company-contexts/:contextId/revoke")
  async revokeCompanyContext(
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = revokeAiCompanyContextRequestSchema.safeParse(body);
    if (!request.success || !isUuid(contextId)) throw new BadRequestException("Invalid Basira company-context revocation.");
    const scope = this.scope(authorization, companyId);
    return this.platform.revokeCompanyContext(
      await this.platform.authorizeCompanyContextWrite(scope.accessToken, scope.companyId), contextId, request.data,
    );
  }

  @Post("skill-activations")
  @HttpCode(201)
  async createSkillActivation(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createAiSkillActivationRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid Basira skill activation.");
    const scope = this.scope(authorization, companyId);
    return this.platform.createSkillActivation(
      await this.platform.authorizeSkillActivation(scope.accessToken, scope.companyId), request.data,
    );
  }

  @Post("skill-activations/:activationId/suspend")
  async suspendSkillActivation(
    @Param("activationId") activationId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = suspendAiSkillActivationRequestSchema.safeParse(body);
    if (!request.success || !isUuid(activationId)) throw new BadRequestException("Invalid Basira skill suspension.");
    const scope = this.scope(authorization, companyId);
    return this.platform.suspendSkillActivation(
      await this.platform.authorizeSkillActivation(scope.accessToken, scope.companyId), activationId, request.data,
    );
  }

  @Post("evaluation-feedback")
  @HttpCode(201)
  async createEvaluationFeedback(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createAiEvaluationFeedbackRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid Basira evaluation feedback.");
    const scope = this.scope(authorization, companyId);
    return this.platform.createEvaluationFeedback(
      await this.platform.authorizeEvaluationWrite(scope.accessToken, scope.companyId), request.data,
    );
  }

  @Post("skill-evaluations/offline")
  @HttpCode(201)
  async runOfflineSkillEvaluation(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = runAiSkillOfflineEvaluationRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid Basira offline evaluation request.");
    const scope = this.scope(authorization, companyId);
    return aiSkillEvaluationRunReceiptSchema.parse(
      await this.platform.runOfflineSkillEvaluation(
        await this.platform.authorizeEvaluationWrite(scope.accessToken, scope.companyId), request.data,
      ),
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
