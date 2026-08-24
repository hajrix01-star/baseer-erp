import { randomUUID } from "node:crypto";

import {
  decisionAlertExplanationSchema,
  explainDecisionAlertReceiptSchema,
  explainMarketingCampaignReceiptSchema,
  marketingCampaignExplanationSchema,
  aiRuntimePreflightReceiptSchema,
  type ExplainDecisionAlertReceipt,
  type ExplainDecisionAlertRequest,
  type ExplainMarketingCampaignReceipt,
  type ExplainMarketingCampaignRequest,
  type DecisionAlertExplanation,
  type MarketingCampaignExplanation,
  type AiRuntimePreflightReceipt,
  type AiRuntimePreflightRequest,
} from "@baseer-erp/contracts";
import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import {
  IdempotencyPayloadMismatchError,
  IdempotencyService,
} from "../core-controls/idempotency.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiCompanyIdentityStatus,
  AiExecutionOutcome,
  AiProviderConfigurationStatus,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { AiProviderAdapterRegistry } from "./ai-provider-adapter-registry.js";
import { AiCredentialVault } from "./ai-credential-vault.js";
import { AiRuntimeRateLimitService } from "./ai-runtime-rate-limit.service.js";
import { DecisionIntelligenceService } from "../decision-intelligence/decision-intelligence.service.js";
import { MarketingService } from "../marketing/marketing.service.js";
import { listAiSkills, selectAiSkill } from "./ai-skills.js";

const AI_USE_CAPABILITY = "platform.ai.use";
const PREFLIGHT_OPERATION = "platform.ai.runtime.preflight";

/**
 * Gate B runtime boundary. It authorizes and records a selected skill, but it
 * intentionally does not invoke a provider, expose a prompt or run a tool.
 */
@Injectable()
export class AiRuntimeService {
  private readonly logger = new Logger(AiRuntimeService.name);
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
    private readonly adapters: AiProviderAdapterRegistry,
    private readonly vault: AiCredentialVault,
    private readonly rateLimit: AiRuntimeRateLimitService,
    private readonly decisions: DecisionIntelligenceService,
    private readonly marketing: MarketingService,
  ) {}

  async list(input: { accessToken: string; companyId: string; moduleKey?: string }) {
    await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [AI_USE_CAPABILITY],
    });
    return listAiSkills(input.moduleKey);
  }

  async preflight(input: {
    accessToken: string;
    companyId: string;
    request: AiRuntimePreflightRequest;
  }): Promise<AiRuntimePreflightReceipt> {
    const skill = selectAiSkill(input.request.moduleKey, input.request.skillKey);
    if (!skill) {
      throw new ForbiddenException("The selected AI skill is not available for this module.");
    }
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: Array.from(
        new Set([AI_USE_CAPABILITY, ...skill.requiredCapabilities]),
      ),
    });
    const context: TrustedCompanyActorContext = {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };

    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      let begun;
      try {
        begun = await this.idempotency.beginInTransaction(transaction, context, {
          operation: PREFLIGHT_OPERATION,
          key: input.request.idempotencyKey,
          request: {
            moduleKey: input.request.moduleKey,
            skillKey: input.request.skillKey,
            skillVersion: skill.version,
            policyVersion: skill.policyVersion,
          },
          expiresAt: new Date(Date.now() + 86_400_000),
        });
      } catch (error) {
        if (error instanceof IdempotencyPayloadMismatchError) {
          throw new ConflictException("The idempotency key was used with a different AI runtime request.");
        }
        throw error;
      }
      if (begun.kind === "in-progress") {
        throw new ConflictException("The AI runtime request is still in progress.");
      }
      if (begun.kind === "replay") {
        const replay = aiRuntimePreflightReceiptSchema.safeParse({
          ...(begun.response.body as object),
          replayed: true,
        });
        if (!replay.success) throw new ConflictException("The stored AI runtime receipt is invalid.");
        return replay.data;
      }

      this.rateLimit.recordNewExecution(context);
      const [provider, identity, systemIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({
          where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true },
          select: { id: true, provider: true, model: true, configurationVersion: true },
        }),
        transaction.aiCompanyIdentity.findFirst({
          where: { tenantId: context.tenantId, companyId: context.companyId, status: AiCompanyIdentityStatus.ACTIVE },
          select: { id: true, version: true },
        }),
        transaction.aiSystemIdentity.findFirst({
          where: { tenantId: context.tenantId, status: AiCompanyIdentityStatus.ACTIVE },
          select: { id: true, version: true },
        }),
      ]);
      const offline = this.adapters.offlineResult(provider?.provider ?? null);
      const safeReasonCode = skill.status === "PLANNED"
        ? "AI_SKILL_NOT_ACTIVATED"
        : skill.status === "SUSPENDED"
          ? "AI_SKILL_SUSPENDED"
          : offline.safeReasonCode;
      const createdAt = new Date();
      const receiptId = randomUUID();
      const requestId = RequestContext.correlationId() ?? randomUUID();
      await transaction.aiExecutionReceipt.create({
        data: {
          id: receiptId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          providerConfigurationId: provider?.id ?? null,
          identityId: identity?.id ?? null,
          systemIdentityId: systemIdentity?.id ?? null,
          moduleKey: input.request.moduleKey,
          capability: AI_USE_CAPABILITY,
          skillKey: skill.key,
          skillVersion: skill.version,
          policyVersion: skill.policyVersion,
          outcome: AiExecutionOutcome.BLOCKED,
          providerSnapshot: provider?.provider ?? null,
          modelSnapshot: provider?.model ?? null,
          configurationVersion: provider?.configurationVersion ?? null,
          identityVersion: identity?.version ?? null,
          systemIdentityVersion: systemIdentity?.version ?? null,
          safeErrorCode: safeReasonCode,
          requestId,
          createdAt,
        },
      });
      const receipt = aiRuntimePreflightReceiptSchema.parse({
        receiptId,
        skillKey: skill.key,
        skillVersion: skill.version,
        riskTier: skill.riskTier,
        status: skill.status,
        policyVersion: skill.policyVersion,
        requiredCapabilities: [...skill.requiredCapabilities],
        outcome: offline.outcome,
        safeReasonCode,
        companyId: context.companyId,
        requestId,
        createdAt,
        replayed: false,
      });
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
          actorUserId: context.actorUserId, action: "platform.ai.runtime_preflight_blocked",
          entityType: "AiExecutionReceipt", entityId: receiptId, requestId: receipt.requestId,
          afterJson: {
            moduleKey: input.request.moduleKey, skillKey: skill.key,
            skillVersion: skill.version, policyVersion: skill.policyVersion,
            systemIdentityVersion: systemIdentity?.version ?? null,
            riskTier: skill.riskTier, status: skill.status, safeReasonCode,
          },
        },
      });
      const receiptBody = { ...receipt, createdAt: receipt.createdAt.toISOString() };
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: begun.receiptId,
        response: { status: 200, headers: null, body: receiptBody },
      });
      return receipt;
    });
  }

  /**
   * The first live provider path. It deliberately accepts an alert id, then
   * constructs the frozen brief on the server; the browser never supplies a
   * prompt, rows, an instruction, or a provider credential.
   */
  async explainDecisionAlert(input: {
    accessToken: string;
    companyId: string;
    request: ExplainDecisionAlertRequest;
  }): Promise<ExplainDecisionAlertReceipt> {
    const skill = selectAiSkill("decision-intelligence", "decision.command_center_analyst");
    if (!skill || (skill.status !== "PILOT" && skill.status !== "ACTIVE")) {
      throw new ForbiddenException("The Decision explanation skill is not active.");
    }
    // A provider configuration and credential are not an activation switch.
    // The pilot remains deny-by-default until the deployment owner enables this
    // exact, narrow capability in the server environment.
    if (process.env.BASEER_BASIRA_DECISION_PILOT_ENABLED !== "true") {
      throw new ForbiddenException("The Basira Decision explanation pilot is not enabled.");
    }
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: Array.from(new Set([AI_USE_CAPABILITY, ...skill.requiredCapabilities])),
    });
    const context: TrustedCompanyActorContext = {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
    const brief = await this.decisions.readBasiraDecisionAlertBrief(context, input.request.alertId);
    if (!brief.evidence.checksumValid) throw new ConflictException("The frozen alert evidence cannot be explained because its checksum is invalid.");

    const setup = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [provider, identity, systemIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({
          where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true },
          select: { id: true, provider: true, model: true, configurationVersion: true, dailyRequestLimit: true, encryptedCredential: true, credentialIv: true, credentialTag: true, credentialKeyVersion: true },
        }),
        transaction.aiCompanyIdentity.findFirst({
          where: { tenantId: context.tenantId, companyId: context.companyId, status: AiCompanyIdentityStatus.ACTIVE },
          select: { id: true, version: true, toneInstructions: true, safetyInstructions: true },
        }),
        transaction.aiSystemIdentity.findFirst({
          where: { tenantId: context.tenantId, status: AiCompanyIdentityStatus.ACTIVE },
          select: { id: true, version: true, toneInstructions: true, safetyInstructions: true },
        }),
      ]);
      if (!provider || provider.provider !== "OPENAI_COMPATIBLE") throw new ConflictException("An active OpenAI provider configuration is required for this pilot.");
      const startOfUtcDay = new Date(); startOfUtcDay.setUTCHours(0, 0, 0, 0);
      const usedToday = await transaction.aiExecutionReceipt.count({ where: { tenantId: context.tenantId, providerConfigurationId: provider.id, createdAt: { gte: startOfUtcDay }, outcome: AiExecutionOutcome.SUCCEEDED } });
      if (usedToday >= provider.dailyRequestLimit) throw new HttpException("The configured daily AI request limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      return { provider, identity, systemIdentity };
    });

    let begun;
    try {
      begun = await this.idempotency.begin(context, {
        operation: "platform.ai.runtime.decision_alert_explain",
        key: input.request.idempotencyKey,
        request: { alertId: input.request.alertId, language: input.request.language, skillVersion: skill.version, policyVersion: skill.policyVersion, snapshotId: brief.evidence.snapshotId, checksum: brief.evidence.checksum },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    } catch (error) {
      if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was used with a different AI explanation request.");
      throw error;
    }
    if (begun.kind === "in-progress") throw new ConflictException("The AI explanation request is still in progress.");
    if (begun.kind === "replay") {
      if (begun.response.status !== 200) {
        throw new HttpException("The previous AI explanation attempt was unavailable. Start a new request.", begun.response.status);
      }
      return explainDecisionAlertReceiptSchema.parse({ ...(begun.response.body as object), replayed: true });
    }

    this.rateLimit.recordNewExecution(context);
    let explanation: DecisionAlertExplanation;
    try {
      const apiKey = this.vault.decryptApiKey(setup.provider);
      explanation = decisionAlertExplanationSchema.parse(await this.adapters.explainDecisionAlert({
        apiKey,
        model: setup.provider.model,
        brief,
        language: input.request.language,
        actorFingerprint: `${context.tenantId}:${context.companyId}:${context.actorUserId}`,
        toneInstructions: [setup.systemIdentity?.toneInstructions, setup.identity?.toneInstructions].filter((value): value is string => !!value).join("\n"),
        safetyInstructions: [setup.systemIdentity?.safetyInstructions, setup.identity?.safetyInstructions].filter((value): value is string => !!value).join("\n"),
      }));
    } catch (error) {
      const failureKind = error instanceof HttpException
        ? "provider_request_failed"
        : error instanceof Error && /credential|decrypt|authenticate data|unsupported state/i.test(error.message)
          ? "credential_decryption_failed"
          : "runtime_failed";
      this.logger.warn(JSON.stringify({ event: "basira.decision_explanation_failed", failureKind }));
      const receiptId = randomUUID();
      const createdAt = new Date();
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        await transaction.aiExecutionReceipt.create({ data: {
          id: receiptId, tenantId: context.tenantId, companyId: context.companyId,
          providerConfigurationId: setup.provider.id, identityId: setup.identity?.id ?? null, systemIdentityId: setup.systemIdentity?.id ?? null,
          moduleKey: "decision-intelligence", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
          outcome: AiExecutionOutcome.FAILED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion,
          identityVersion: setup.identity?.version ?? null, systemIdentityVersion: setup.systemIdentity?.version ?? null,
          inputCharacters: JSON.stringify(brief).length, outputCharacters: 0, requestId: RequestContext.correlationId() ?? randomUUID(), createdAt,
        } });
        await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.decision_alert_explanation_failed", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { alertId: input.request.alertId, snapshotId: brief.evidence.snapshotId, checksum: brief.evidence.checksum, skillKey: skill.key, model: setup.provider.model } } });
        await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 503, headers: null, body: { error: "AI_PROVIDER_UNAVAILABLE" } } });
      });
      if (error instanceof HttpException) throw error;
      throw new HttpException("The AI explanation provider is temporarily unavailable.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    const receiptId = randomUUID();
    const createdAt = new Date();
    const receipt = explainDecisionAlertReceiptSchema.parse({ receiptId, alertId: input.request.alertId, skillKey: "decision.command_center_analyst", model: setup.provider.model, explanation, createdAt, replayed: false });
    await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.aiExecutionReceipt.create({ data: {
        id: receiptId, tenantId: context.tenantId, companyId: context.companyId,
        providerConfigurationId: setup.provider.id, identityId: setup.identity?.id ?? null, systemIdentityId: setup.systemIdentity?.id ?? null,
        moduleKey: "decision-intelligence", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
        outcome: AiExecutionOutcome.SUCCEEDED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion,
        identityVersion: setup.identity?.version ?? null, systemIdentityVersion: setup.systemIdentity?.version ?? null,
        inputCharacters: JSON.stringify(brief).length, outputCharacters: JSON.stringify(explanation).length, requestId: RequestContext.correlationId() ?? randomUUID(), createdAt,
      } });
      await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.decision_alert_explained", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { alertId: input.request.alertId, snapshotId: brief.evidence.snapshotId, checksum: brief.evidence.checksum, skillKey: skill.key, model: setup.provider.model } } });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: { ...receipt, createdAt: receipt.createdAt.toISOString() } } });
    });
    return receipt;
  }

  /**
   * Marketing's only live S2 path. The browser supplies a campaign selector,
   * but Basira receives only a new immutable evidence snapshot constructed by
   * the server inside the active company scope.
   */
  async explainMarketingCampaign(input: {
    accessToken: string;
    companyId: string;
    request: ExplainMarketingCampaignRequest;
  }): Promise<ExplainMarketingCampaignReceipt> {
    const skill = selectAiSkill("marketing", "marketing.performance_analyst");
    if (!skill || (skill.status !== "PILOT" && skill.status !== "ACTIVE")) {
      throw new ForbiddenException("The Marketing explanation skill is not active.");
    }
    if (process.env.BASEER_BASIRA_MARKETING_PILOT_ENABLED !== "true") {
      throw new ForbiddenException("The Basira Marketing explanation pilot is not enabled.");
    }
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: Array.from(new Set([AI_USE_CAPABILITY, ...skill.requiredCapabilities])),
    });
    const context: TrustedCompanyActorContext = {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };

    let begun;
    try {
      begun = await this.idempotency.begin(context, {
        operation: "platform.ai.runtime.marketing_campaign_explain",
        key: input.request.idempotencyKey,
        request: { campaignId: input.request.campaignId, language: input.request.language, skillVersion: skill.version, policyVersion: skill.policyVersion },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    } catch (error) {
      if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was used with a different Marketing explanation request.");
      throw error;
    }
    if (begun.kind === "in-progress") throw new ConflictException("The AI explanation request is still in progress.");
    if (begun.kind === "replay") {
      if (begun.response.status !== 200) throw new HttpException("The previous AI explanation attempt was unavailable. Start a new request.", begun.response.status);
      return explainMarketingCampaignReceiptSchema.parse({ ...(begun.response.body as object), replayed: true });
    }

    const snapshot = await this.marketing.createCampaignEvidenceSnapshot(context, input.request.campaignId);
    const setup = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [provider, identity, systemIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({ where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true }, select: { id: true, provider: true, model: true, configurationVersion: true, dailyRequestLimit: true, encryptedCredential: true, credentialIv: true, credentialTag: true, credentialKeyVersion: true } }),
        transaction.aiCompanyIdentity.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, status: AiCompanyIdentityStatus.ACTIVE }, select: { id: true, version: true, toneInstructions: true, safetyInstructions: true } }),
        transaction.aiSystemIdentity.findFirst({ where: { tenantId: context.tenantId, status: AiCompanyIdentityStatus.ACTIVE }, select: { id: true, version: true, toneInstructions: true, safetyInstructions: true } }),
      ]);
      if (!provider || provider.provider !== "OPENAI_COMPATIBLE") throw new ConflictException("An active OpenAI provider configuration is required for this pilot.");
      const startOfUtcDay = new Date(); startOfUtcDay.setUTCHours(0, 0, 0, 0);
      const usedToday = await transaction.aiExecutionReceipt.count({ where: { tenantId: context.tenantId, providerConfigurationId: provider.id, createdAt: { gte: startOfUtcDay }, outcome: AiExecutionOutcome.SUCCEEDED } });
      if (usedToday >= provider.dailyRequestLimit) throw new HttpException("The configured daily AI request limit has been reached.", HttpStatus.TOO_MANY_REQUESTS);
      return { provider, identity, systemIdentity };
    });

    this.rateLimit.recordNewExecution(context);
    let explanation: MarketingCampaignExplanation;
    try {
      explanation = marketingCampaignExplanationSchema.parse(await this.adapters.explainMarketingCampaign({
        apiKey: this.vault.decryptApiKey(setup.provider), model: setup.provider.model,
        brief: snapshot.payload as Record<string, unknown>, language: input.request.language,
        actorFingerprint: `${context.tenantId}:${context.companyId}:${context.actorUserId}`,
        toneInstructions: [setup.systemIdentity?.toneInstructions, setup.identity?.toneInstructions].filter((value): value is string => !!value).join("\n"),
        safetyInstructions: [setup.systemIdentity?.safetyInstructions, setup.identity?.safetyInstructions].filter((value): value is string => !!value).join("\n"),
      }));
    } catch (error) {
      const failureKind = error instanceof HttpException ? "provider_request_failed" : error instanceof Error && /credential|decrypt|authenticate data|unsupported state/i.test(error.message) ? "credential_decryption_failed" : "runtime_failed";
      this.logger.warn(JSON.stringify({ event: "basira.marketing_campaign_explanation_failed", failureKind }));
      const receiptId = randomUUID(); const createdAt = new Date();
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        await transaction.aiExecutionReceipt.create({ data: { id: receiptId, tenantId: context.tenantId, companyId: context.companyId, providerConfigurationId: setup.provider.id, identityId: setup.identity?.id ?? null, systemIdentityId: setup.systemIdentity?.id ?? null, moduleKey: "marketing", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, outcome: AiExecutionOutcome.FAILED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion, identityVersion: setup.identity?.version ?? null, systemIdentityVersion: setup.systemIdentity?.version ?? null, inputCharacters: JSON.stringify(snapshot.payload).length, outputCharacters: 0, safeErrorCode: failureKind, requestId: RequestContext.correlationId() ?? randomUUID(), createdAt } });
        await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.marketing_campaign_explanation_failed", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { campaignId: input.request.campaignId, snapshotId: snapshot.id, checksum: snapshot.checksum, skillKey: skill.key, model: setup.provider.model } } });
        await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 503, headers: null, body: { error: "AI_PROVIDER_UNAVAILABLE" } } });
      });
      if (error instanceof HttpException) throw error;
      throw new HttpException("The AI explanation provider is temporarily unavailable.", HttpStatus.SERVICE_UNAVAILABLE);
    }

    const receiptId = randomUUID(); const createdAt = new Date();
    const receipt = explainMarketingCampaignReceiptSchema.parse({ receiptId, campaignId: input.request.campaignId, evidenceSnapshotId: snapshot.id, skillKey: "marketing.performance_analyst", model: setup.provider.model, explanation, createdAt, replayed: false });
    await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.aiExecutionReceipt.create({ data: { id: receiptId, tenantId: context.tenantId, companyId: context.companyId, providerConfigurationId: setup.provider.id, identityId: setup.identity?.id ?? null, systemIdentityId: setup.systemIdentity?.id ?? null, moduleKey: "marketing", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, outcome: AiExecutionOutcome.SUCCEEDED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion, identityVersion: setup.identity?.version ?? null, systemIdentityVersion: setup.systemIdentity?.version ?? null, inputCharacters: JSON.stringify(snapshot.payload).length, outputCharacters: JSON.stringify(explanation).length, requestId: RequestContext.correlationId() ?? randomUUID(), createdAt } });
      await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.marketing_campaign_explained", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { campaignId: input.request.campaignId, snapshotId: snapshot.id, checksum: snapshot.checksum, skillKey: skill.key, model: setup.provider.model } } });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: { ...receipt, createdAt: receipt.createdAt.toISOString() } } });
    });
    return receipt;
  }
}
