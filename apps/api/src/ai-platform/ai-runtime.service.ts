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
  type BasiraDecisionAlertBrief,
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
  hashCanonicalJson,
} from "../core-controls/idempotency.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiCompanyContextStatus,
  AiCompanyIdentityStatus,
  AiExecutionOutcome,
  AiProviderConfigurationStatus,
  AiSkillActivationStatus,
  Prisma,
  type AiProviderKind,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { AiProviderAdapterRegistry } from "./ai-provider-adapter-registry.js";
import { AiCredentialVault } from "./ai-credential-vault.js";
import {
  AiConsumptionGuardService,
  type AiCostReservation,
} from "./ai-consumption-guard.service.js";
import { AiCompanyPolicyService } from "./ai-company-policy.service.js";
import { startOfRiyadhMonth } from "./ai-consumption-time.js";
import { AiInterpretationService, interpretationAad } from "./ai-interpretation.service.js";
import type { AiProviderUsage } from "./ai-provider-usage.js";
import { decisionAlertProviderPrompt, marketingCampaignProviderPrompt, promptTextForLocalTokenCount } from "./ai-provider-prompts.js";
import { AiRuntimeRateLimitService } from "./ai-runtime-rate-limit.service.js";
import { AnalysisReadinessService } from "./analysis-readiness.service.js";
import { evaluationSuiteForAiSkill, runOfflineAiSkillEvaluation } from "./ai-skill-evaluation-suites.js";
import { liveAiModelProfileForSkill } from "./ai-provider-capability-registry.js";
import { DecisionIntelligenceService } from "../decision-intelligence/decision-intelligence.service.js";
import { MarketingService } from "../marketing/marketing.service.js";
import { AI_SKILL_CATALOG, listAiSkills, selectAiSkill } from "./ai-skills.js";

const AI_USE_CAPABILITY = "platform.ai.use";
const PREFLIGHT_OPERATION = "platform.ai.runtime.preflight";
const INTERPRETATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const INTERPRETATION_PROMPT_VERSION = 1;

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
    private readonly interpretations: AiInterpretationService,
    private readonly consumption: AiConsumptionGuardService,
    private readonly companyPolicy: AiCompanyPolicyService,
    private readonly rateLimit: AiRuntimeRateLimitService,
    private readonly decisions: DecisionIntelligenceService,
    private readonly marketing: MarketingService,
    private readonly analysisReadiness: AnalysisReadinessService,
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
      const [provider, companyContexts, systemIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({
          where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true },
          select: { id: true, provider: true, model: true, configurationVersion: true },
        }),
        transaction.aiCompanyContext.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, status: AiCompanyContextStatus.APPROVED, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { id: true, presentationStyle: true, approvedTermsJson: true, policyReferencesJson: true },
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
          identityId: null,
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
          identityVersion: null,
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
            companyContextCount: companyContexts.length,
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
    const readiness = await this.analysisReadiness.decisionAlert(context, input.request.alertId);
    if (readiness.status !== "READY") throw new ConflictException("The decision evidence is not ready for Basira explanation.");
    const brief = await this.decisions.readBasiraDecisionAlertBrief(context, input.request.alertId);
    if (!brief.evidence.checksumValid) throw new ConflictException("The frozen alert evidence cannot be explained because its checksum is invalid.");
    this.assertDecisionEvidenceEligible(brief);

    const setup = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [provider, companyContexts, systemIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({
          where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true },
          select: { id: true, provider: true, model: true, configurationVersion: true, dailyRequestLimit: true, dailyCostLimit: true, encryptedCredential: true, credentialIv: true, credentialTag: true, credentialKeyVersion: true },
        }),
        transaction.aiCompanyContext.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, status: AiCompanyContextStatus.APPROVED, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { id: true, presentationStyle: true, approvedTermsJson: true, policyReferencesJson: true },
        }),
        transaction.aiSystemIdentity.findFirst({
          where: { tenantId: context.tenantId, status: AiCompanyIdentityStatus.ACTIVE },
          select: { id: true, version: true, toneInstructions: true, safetyInstructions: true },
        }),
      ]);
      if (!provider || provider.provider !== "OPENAI_COMPATIBLE") throw new ConflictException("An active OpenAI provider configuration is required for this pilot.");
      return { provider, companyContexts, systemIdentity };
    });
    const companyPolicy = await this.companyPolicy.requireLivePolicy(context, {
      skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, catalogueStatus: skill.status, provider: setup.provider,
    });
    const activation = companyPolicy?.activation ?? await this.requireLiveSkillActivation(context, skill.key, skill.version, skill.policyVersion, skill.status);

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

    const companyContextDigest = this.companyContextDigest(setup.companyContexts);
    const modelProfile = this.requireLiveModelProfile(
      setup.provider.provider,
      setup.provider.model,
      skill.key,
    );
    const modelProfileDigest = this.modelProfileDigest(
      setup.provider.provider,
      setup.provider.model,
      modelProfile,
    );
    const reuseKey = this.interpretationReuseKey({
      subjectKind: "DECISION_ALERT",
      subjectId: input.request.alertId,
      skillKey: skill.key,
      skillVersion: skill.version,
      policyVersion: skill.policyVersion,
      language: input.request.language,
      evidenceChecksum: brief.evidence.checksum,
      companyContextDigest,
      systemIdentityVersion: setup.systemIdentity?.version ?? null,
      modelProfileDigest,
    });
    const claim = await this.interpretations.claim<DecisionAlertExplanation>(context, reuseKey);
    if (claim.kind === "reused") {
      const explanation = decisionAlertExplanationSchema.parse(claim.interpretation.output);
      const receiptId = randomUUID();
      const createdAt = new Date();
      const receipt = explainDecisionAlertReceiptSchema.parse({
        receiptId,
        interpretationId: claim.interpretation.id,
        disposition: "REUSED",
        alertId: input.request.alertId,
        skillKey: "decision.command_center_analyst",
        model: setup.provider.model,
        explanation,
        createdAt,
        replayed: false,
      });
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        await transaction.aiExecutionReceipt.create({ data: {
          id: receiptId, tenantId: context.tenantId, companyId: context.companyId,
          providerConfigurationId: setup.provider.id, identityId: null, systemIdentityId: setup.systemIdentity?.id ?? null,
          skillActivationId: activation.id, evidenceSnapshotId: brief.evidence.snapshotId,
          promptVersion: INTERPRETATION_PROMPT_VERSION, inputChecksum: brief.evidence.checksum,
          outputChecksum: claim.interpretation.outputChecksum,
          moduleKey: "decision-intelligence", capability: AI_USE_CAPABILITY,
          skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
          companyPolicyRevisionId: companyPolicy?.policyRevisionId ?? null, billingPeriodStartAt: companyPolicy ? startOfRiyadhMonth(createdAt) : null,
          outcome: AiExecutionOutcome.SUCCEEDED, providerSnapshot: setup.provider.provider,
          modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion,
          identityVersion: null, systemIdentityVersion: setup.systemIdentity?.version ?? null,
          inputCharacters: JSON.stringify(brief).length, outputCharacters: JSON.stringify(explanation).length,
          safeErrorCode: "INTERPRETATION_REUSED", requestId: RequestContext.correlationId() ?? randomUUID(), createdAt,
        } });
        await transaction.auditEvent.create({ data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
          actorUserId: context.actorUserId, action: "platform.ai.decision_alert_interpretation_reused",
          entityType: "AiInterpretation", entityId: claim.interpretation.id,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          afterJson: { alertId: input.request.alertId, snapshotId: brief.evidence.snapshotId, reuseKey, sourceReceiptId: claim.interpretation.sourceExecutionReceiptId },
        } });
        await this.idempotency.completeInTransaction(transaction, context, {
          receiptId: begun.receiptId,
          response: { status: 200, headers: null, body: { ...receipt, createdAt: receipt.createdAt.toISOString() } },
        });
      });
      return receipt;
    }
    if (claim.kind === "in-progress") {
      await this.completeInProgressInterpretationRequest(context, begun.receiptId);
      throw new ConflictException("An identical Basira interpretation is already being prepared. Try again shortly.");
    }

    let explanation: DecisionAlertExplanation;
    let providerUsage: AiProviderUsage | null = null;
    let reservation: AiCostReservation | null = null;
    let chargedCostUsd: Prisma.Decimal | null = null;
    let reservationSettled = false;
    try {
      const apiKey = this.vault.decryptApiKey(setup.provider);
      const companyContext = this.companyContextData(setup.companyContexts);
      const providerPrompt = decisionAlertProviderPrompt({
        brief,
        language: input.request.language,
        toneInstructions: setup.systemIdentity?.toneInstructions ?? "",
        safetyInstructions: setup.systemIdentity?.safetyInstructions ?? "",
        companyContext,
      });
      // This lightweight local limiter is only an extra anti-burst control.
      // The database reservation below is the authoritative cross-instance
      // request and cost limit.
      this.rateLimit.recordNewExecution(context);
      reservation = await this.consumption.reserve({
        context,
        provider: setup.provider,
        activation,
        companyPolicy: companyPolicy ? {
          policyRevisionId: companyPolicy.policyRevisionId,
          monthlyBudgetUsdCents: companyPolicy.monthlyBudgetUsdCents,
        } : null,
        interpretationRunId: claim.runId,
        profile: modelProfile,
        inputText: promptTextForLocalTokenCount(providerPrompt),
      });
      const generated = await this.consumption.dispatchProviderCall({
        context,
        activation,
        companyPolicy: companyPolicy ? { policyRevisionId: companyPolicy.policyRevisionId, monthlyBudgetUsdCents: companyPolicy.monthlyBudgetUsdCents } : null,
        dispatch: () => this.adapters.explainDecisionAlert({
          apiKey,
          model: setup.provider.model,
          brief,
          language: input.request.language,
          actorFingerprint: `${context.tenantId}:${context.companyId}:${context.actorUserId}`,
          toneInstructions: setup.systemIdentity?.toneInstructions ?? "",
          safetyInstructions: setup.systemIdentity?.safetyInstructions ?? "",
          companyContext,
          maxOutputTokens: modelProfile.maxOutputTokens,
        }),
      });
      providerUsage = generated.usage;
      explanation = decisionAlertExplanationSchema.parse(generated.output);
    } catch (error) {
      const failureKind = error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
        ? "consumption_limit_blocked"
        : error instanceof HttpException
          ? "provider_request_failed"
        : error instanceof Error && /credential|decrypt|authenticate data|unsupported state/i.test(error.message)
          ? "credential_decryption_failed"
          : "runtime_failed";
      if (reservation) {
        try {
          chargedCostUsd = await this.consumption.settleAfterProviderFailure({
            context,
            reservation,
            usage: providerUsage,
            safeReasonCode: `FAILED_${failureKind.toUpperCase()}`,
          });
        } catch (settlementError) {
          this.logger.error(JSON.stringify({ event: "basira.decision_explanation_cost_settlement_failed", failureKind, error: settlementError instanceof Error ? settlementError.name : "unknown" }));
        }
      }
      try {
        await this.interpretations.markRunFailed(context, { runId: claim.runId, safeFailureCode: failureKind });
      } catch (markError) {
        this.logger.error(JSON.stringify({ event: "basira.decision_explanation_claim_release_failed", failureKind, error: markError instanceof Error ? markError.name : "unknown" }));
      }
      this.logger.warn(JSON.stringify({ event: "basira.decision_explanation_failed", failureKind }));
      const receiptId = randomUUID();
      const createdAt = new Date();
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        await transaction.aiExecutionReceipt.create({ data: {
          id: receiptId, tenantId: context.tenantId, companyId: context.companyId,
          providerConfigurationId: setup.provider.id, identityId: null, systemIdentityId: setup.systemIdentity?.id ?? null, skillActivationId: activation.id, evidenceSnapshotId: brief.evidence.snapshotId, promptVersion: INTERPRETATION_PROMPT_VERSION, inputChecksum: brief.evidence.checksum,
          moduleKey: "decision-intelligence", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
          companyPolicyRevisionId: companyPolicy?.policyRevisionId ?? null, billingPeriodStartAt: companyPolicy ? startOfRiyadhMonth(createdAt) : null,
          outcome: AiExecutionOutcome.FAILED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion,
          identityVersion: null, systemIdentityVersion: setup.systemIdentity?.version ?? null,
          inputCharacters: JSON.stringify(brief).length, outputCharacters: 0,
          modelPriceRevisionId: reservation?.modelPriceRevisionId ?? null,
          estimatedCostUsd: reservation?.estimatedCostUsd ?? null,
          actualCostUsd: chargedCostUsd,
          safeErrorCode: failureKind, requestId: RequestContext.correlationId() ?? randomUUID(), createdAt,
        } });
        await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.decision_alert_explanation_failed", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { alertId: input.request.alertId, snapshotId: brief.evidence.snapshotId, checksum: brief.evidence.checksum, skillKey: skill.key, model: setup.provider.model } } });
        await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: {
          status: error instanceof HttpException ? error.getStatus() : 503,
          headers: null,
          body: { error: failureKind === "consumption_limit_blocked" ? "AI_CONSUMPTION_LIMIT_REACHED" : "AI_PROVIDER_UNAVAILABLE" },
        } });
      });
      if (error instanceof HttpException) throw error;
      throw new HttpException("The AI explanation provider is temporarily unavailable.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    try {
      if (!reservation) throw new ConflictException("The Basira cost reservation was not created.");
      const receiptId = randomUUID();
      const interpretationId = randomUUID();
      const createdAt = new Date();
      const outputChecksum = hashCanonicalJson(explanation);
      const encryptedOutput = this.vault.encryptOutput(
        explanation,
        interpretationAad(context, reuseKey, outputChecksum),
      );
      const receipt = explainDecisionAlertReceiptSchema.parse({
        receiptId,
        interpretationId,
        disposition: "GENERATED",
        alertId: input.request.alertId,
        skillKey: "decision.command_center_analyst",
        model: setup.provider.model,
        explanation,
        createdAt,
        replayed: false,
      });
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await this.interpretations.lockReuseKeyInTransaction(transaction, context, reuseKey);
      const actualCostUsd = await this.consumption.settleInTransaction(transaction, context, {
        reservation,
        usage: providerUsage,
        executionReceiptId: null,
      });
      await transaction.aiExecutionReceipt.create({ data: {
        id: receiptId, tenantId: context.tenantId, companyId: context.companyId,
        providerConfigurationId: setup.provider.id, identityId: null, systemIdentityId: setup.systemIdentity?.id ?? null, skillActivationId: activation.id, evidenceSnapshotId: brief.evidence.snapshotId, promptVersion: INTERPRETATION_PROMPT_VERSION, inputChecksum: brief.evidence.checksum, outputChecksum,
        moduleKey: "decision-intelligence", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
        companyPolicyRevisionId: companyPolicy?.policyRevisionId ?? null, billingPeriodStartAt: companyPolicy ? startOfRiyadhMonth(createdAt) : null,
        outcome: AiExecutionOutcome.SUCCEEDED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion,
        identityVersion: null, systemIdentityVersion: setup.systemIdentity?.version ?? null,
        inputCharacters: JSON.stringify(brief).length, outputCharacters: JSON.stringify(explanation).length,
        inputTokens: providerUsage?.inputTokens ?? null,
        cachedInputTokens: providerUsage?.cachedInputTokens ?? null,
        outputTokens: providerUsage?.outputTokens ?? null,
        reasoningTokens: providerUsage?.reasoningTokens ?? null,
        modelPriceRevisionId: reservation.modelPriceRevisionId,
        estimatedCostUsd: reservation.estimatedCostUsd,
        actualCostUsd,
        providerRequestId: providerUsage?.providerRequestId ?? null,
        requestId: RequestContext.correlationId() ?? randomUUID(), createdAt,
      } });
      await transaction.aiInterpretation.create({ data: {
        id: interpretationId, tenantId: context.tenantId, companyId: context.companyId,
        subjectKind: "DECISION_ALERT", subjectId: input.request.alertId,
        evidenceSnapshotId: brief.evidence.snapshotId, evidenceChecksum: brief.evidence.checksum,
        reuseKey, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
        promptVersion: INTERPRETATION_PROMPT_VERSION, language: input.request.language,
        systemIdentityVersion: setup.systemIdentity?.version ?? null, companyContextDigest, modelProfileDigest,
        providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model,
        sourceExecutionReceiptId: receiptId, ...encryptedOutput, outputChecksum,
        expiresAt: new Date(createdAt.valueOf() + INTERPRETATION_RETENTION_MS),
        createdByUserId: context.actorUserId,
      } });
      await transaction.aiInterpretationPlacement.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
        interpretationId, kind: "DECISION_ALERT", subjectId: input.request.alertId,
        moduleKey: "decision-intelligence", createdByUserId: context.actorUserId,
      } });
      await this.interpretations.markRunCompleted(transaction, context, { runId: claim.runId, interpretationId });
      await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.decision_alert_explained", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { alertId: input.request.alertId, snapshotId: brief.evidence.snapshotId, checksum: brief.evidence.checksum, skillKey: skill.key, model: setup.provider.model } } });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: { ...receipt, createdAt: receipt.createdAt.toISOString() } } });
      });
      reservationSettled = true;
      return receipt;
    } catch (error) {
      if (reservation && !reservationSettled) {
        try {
          await this.consumption.settleAfterProviderFailure({
            context,
            reservation,
            usage: providerUsage,
            safeReasonCode: "PERSISTENCE_FAILED_AFTER_PROVIDER_CALL",
          });
        } catch (settlementError) {
          this.logger.error(JSON.stringify({ event: "basira.decision_explanation_persistence_cost_settlement_failed", error: settlementError instanceof Error ? settlementError.name : "unknown" }));
        }
      }
      await this.completeClaimAfterPersistenceFailure(context, claim.runId, begun.receiptId);
      this.logger.error(JSON.stringify({ event: "basira.decision_explanation_persistence_failed", error: error instanceof Error ? error.name : "unknown" }));
      throw new HttpException("The AI explanation could not be stored safely. No result was published.", HttpStatus.SERVICE_UNAVAILABLE);
    }
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
    const readiness = await this.analysisReadiness.marketingCampaign(context, input.request.campaignId);
    if (readiness.status !== "READY") throw new ConflictException("The campaign evidence is not ready for Basira explanation.");
    // Build or reuse the frozen evidence before reserving the request key. A
    // rejected/invalid campaign cannot leave an idempotency receipt hanging.
    const snapshot = await this.marketing.createCampaignEvidenceSnapshot(context, input.request.campaignId);
    const setup = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [provider, companyContexts, systemIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({ where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true }, select: { id: true, provider: true, model: true, configurationVersion: true, dailyRequestLimit: true, dailyCostLimit: true, encryptedCredential: true, credentialIv: true, credentialTag: true, credentialKeyVersion: true } }),
        transaction.aiCompanyContext.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: AiCompanyContextStatus.APPROVED, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, presentationStyle: true, approvedTermsJson: true, policyReferencesJson: true } }),
        transaction.aiSystemIdentity.findFirst({ where: { tenantId: context.tenantId, status: AiCompanyIdentityStatus.ACTIVE }, select: { id: true, version: true, toneInstructions: true, safetyInstructions: true } }),
      ]);
      if (!provider || provider.provider !== "OPENAI_COMPATIBLE") throw new ConflictException("An active OpenAI provider configuration is required for this pilot.");
      return { provider, companyContexts, systemIdentity };
    });
    const companyPolicy = await this.companyPolicy.requireLivePolicy(context, {
      skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, catalogueStatus: skill.status, provider: setup.provider,
    });
    const activation = companyPolicy?.activation ?? await this.requireLiveSkillActivation(context, skill.key, skill.version, skill.policyVersion, skill.status);

    let begun;
    try {
      begun = await this.idempotency.begin(context, {
        operation: "platform.ai.runtime.marketing_campaign_explain",
        key: input.request.idempotencyKey,
        request: { campaignId: input.request.campaignId, language: input.request.language, skillVersion: skill.version, policyVersion: skill.policyVersion, snapshotId: snapshot.id, checksum: snapshot.checksum },
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

    const companyContextDigest = this.companyContextDigest(setup.companyContexts);
    const modelProfile = this.requireLiveModelProfile(
      setup.provider.provider,
      setup.provider.model,
      skill.key,
    );
    const modelProfileDigest = this.modelProfileDigest(
      setup.provider.provider,
      setup.provider.model,
      modelProfile,
    );
    const reuseKey = this.interpretationReuseKey({
      subjectKind: "MARKETING_CAMPAIGN",
      subjectId: input.request.campaignId,
      skillKey: skill.key,
      skillVersion: skill.version,
      policyVersion: skill.policyVersion,
      language: input.request.language,
      evidenceChecksum: snapshot.checksum,
      companyContextDigest,
      systemIdentityVersion: setup.systemIdentity?.version ?? null,
      modelProfileDigest,
    });
    const claim = await this.interpretations.claim<MarketingCampaignExplanation>(context, reuseKey);
    if (claim.kind === "reused") {
      const explanation = marketingCampaignExplanationSchema.parse(claim.interpretation.output);
      const receiptId = randomUUID();
      const createdAt = new Date();
      const receipt = explainMarketingCampaignReceiptSchema.parse({
        receiptId,
        interpretationId: claim.interpretation.id,
        disposition: "REUSED",
        campaignId: input.request.campaignId,
        evidenceSnapshotId: snapshot.id,
        skillKey: "marketing.performance_analyst",
        model: setup.provider.model,
        explanation,
        createdAt,
        replayed: false,
      });
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        await transaction.aiExecutionReceipt.create({ data: {
          id: receiptId, tenantId: context.tenantId, companyId: context.companyId,
          providerConfigurationId: setup.provider.id, identityId: null, systemIdentityId: setup.systemIdentity?.id ?? null,
          skillActivationId: activation.id, evidenceSnapshotId: snapshot.id,
          promptVersion: INTERPRETATION_PROMPT_VERSION, inputChecksum: snapshot.checksum,
          outputChecksum: claim.interpretation.outputChecksum,
          moduleKey: "marketing", capability: AI_USE_CAPABILITY,
          skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
          companyPolicyRevisionId: companyPolicy?.policyRevisionId ?? null, billingPeriodStartAt: companyPolicy ? startOfRiyadhMonth(createdAt) : null,
          outcome: AiExecutionOutcome.SUCCEEDED, providerSnapshot: setup.provider.provider,
          modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion,
          identityVersion: null, systemIdentityVersion: setup.systemIdentity?.version ?? null,
          inputCharacters: JSON.stringify(snapshot.payload).length, outputCharacters: JSON.stringify(explanation).length,
          safeErrorCode: "INTERPRETATION_REUSED", requestId: RequestContext.correlationId() ?? randomUUID(), createdAt,
        } });
        await transaction.auditEvent.create({ data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
          actorUserId: context.actorUserId, action: "platform.ai.marketing_campaign_interpretation_reused",
          entityType: "AiInterpretation", entityId: claim.interpretation.id,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          afterJson: { campaignId: input.request.campaignId, snapshotId: snapshot.id, reuseKey, sourceReceiptId: claim.interpretation.sourceExecutionReceiptId },
        } });
        await this.idempotency.completeInTransaction(transaction, context, {
          receiptId: begun.receiptId,
          response: { status: 200, headers: null, body: { ...receipt, createdAt: receipt.createdAt.toISOString() } },
        });
      });
      return receipt;
    }
    if (claim.kind === "in-progress") {
      await this.completeInProgressInterpretationRequest(context, begun.receiptId);
      throw new ConflictException("An identical Basira interpretation is already being prepared. Try again shortly.");
    }

    let explanation: MarketingCampaignExplanation;
    let providerUsage: AiProviderUsage | null = null;
    let reservation: AiCostReservation | null = null;
    let chargedCostUsd: Prisma.Decimal | null = null;
    let reservationSettled = false;
    try {
      const apiKey = this.vault.decryptApiKey(setup.provider);
      const companyContext = this.companyContextData(setup.companyContexts);
      const providerPrompt = marketingCampaignProviderPrompt({
        brief: snapshot.payload as Record<string, unknown>,
        language: input.request.language,
        toneInstructions: setup.systemIdentity?.toneInstructions ?? "",
        safetyInstructions: setup.systemIdentity?.safetyInstructions ?? "",
        companyContext,
      });
      this.rateLimit.recordNewExecution(context);
      reservation = await this.consumption.reserve({
        context,
        provider: setup.provider,
        activation,
        companyPolicy: companyPolicy ? {
          policyRevisionId: companyPolicy.policyRevisionId,
          monthlyBudgetUsdCents: companyPolicy.monthlyBudgetUsdCents,
        } : null,
        interpretationRunId: claim.runId,
        profile: modelProfile,
        inputText: promptTextForLocalTokenCount(providerPrompt),
      });
      const generated = await this.consumption.dispatchProviderCall({
        context,
        activation,
        companyPolicy: companyPolicy ? { policyRevisionId: companyPolicy.policyRevisionId, monthlyBudgetUsdCents: companyPolicy.monthlyBudgetUsdCents } : null,
        dispatch: () => this.adapters.explainMarketingCampaign({
          apiKey, model: setup.provider.model,
          brief: snapshot.payload as Record<string, unknown>, language: input.request.language,
          actorFingerprint: `${context.tenantId}:${context.companyId}:${context.actorUserId}`,
          toneInstructions: setup.systemIdentity?.toneInstructions ?? "",
          safetyInstructions: setup.systemIdentity?.safetyInstructions ?? "",
          companyContext,
          maxOutputTokens: modelProfile.maxOutputTokens,
        }),
      });
      providerUsage = generated.usage;
      explanation = marketingCampaignExplanationSchema.parse(generated.output);
    } catch (error) {
      const failureKind = error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
        ? "consumption_limit_blocked"
        : error instanceof HttpException
          ? "provider_request_failed"
          : error instanceof Error && /credential|decrypt|authenticate data|unsupported state/i.test(error.message)
            ? "credential_decryption_failed"
            : "runtime_failed";
      if (reservation) {
        try {
          chargedCostUsd = await this.consumption.settleAfterProviderFailure({
            context,
            reservation,
            usage: providerUsage,
            safeReasonCode: `FAILED_${failureKind.toUpperCase()}`,
          });
        } catch (settlementError) {
          this.logger.error(JSON.stringify({ event: "basira.marketing_campaign_cost_settlement_failed", failureKind, error: settlementError instanceof Error ? settlementError.name : "unknown" }));
        }
      }
      try {
        await this.interpretations.markRunFailed(context, { runId: claim.runId, safeFailureCode: failureKind });
      } catch (markError) {
        this.logger.error(JSON.stringify({ event: "basira.marketing_campaign_explanation_claim_release_failed", failureKind, error: markError instanceof Error ? markError.name : "unknown" }));
      }
      this.logger.warn(JSON.stringify({ event: "basira.marketing_campaign_explanation_failed", failureKind }));
      const receiptId = randomUUID(); const createdAt = new Date();
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        await transaction.aiExecutionReceipt.create({ data: { id: receiptId, tenantId: context.tenantId, companyId: context.companyId, providerConfigurationId: setup.provider.id, identityId: null, systemIdentityId: setup.systemIdentity?.id ?? null, skillActivationId: activation.id, evidenceSnapshotId: snapshot.id, promptVersion: INTERPRETATION_PROMPT_VERSION, inputChecksum: snapshot.checksum, moduleKey: "marketing", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, companyPolicyRevisionId: companyPolicy?.policyRevisionId ?? null, billingPeriodStartAt: companyPolicy ? startOfRiyadhMonth(createdAt) : null, outcome: AiExecutionOutcome.FAILED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion, identityVersion: null, systemIdentityVersion: setup.systemIdentity?.version ?? null, inputCharacters: JSON.stringify(snapshot.payload).length, outputCharacters: 0, modelPriceRevisionId: reservation?.modelPriceRevisionId ?? null, estimatedCostUsd: reservation?.estimatedCostUsd ?? null, actualCostUsd: chargedCostUsd, safeErrorCode: failureKind, requestId: RequestContext.correlationId() ?? randomUUID(), createdAt } });
        await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.marketing_campaign_explanation_failed", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { campaignId: input.request.campaignId, snapshotId: snapshot.id, checksum: snapshot.checksum, skillKey: skill.key, model: setup.provider.model } } });
        await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: {
          status: error instanceof HttpException ? error.getStatus() : 503,
          headers: null,
          body: { error: failureKind === "consumption_limit_blocked" ? "AI_CONSUMPTION_LIMIT_REACHED" : "AI_PROVIDER_UNAVAILABLE" },
        } });
      });
      if (error instanceof HttpException) throw error;
      throw new HttpException("The AI explanation provider is temporarily unavailable.", HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      if (!reservation) throw new ConflictException("The Basira cost reservation was not created.");
      const receiptId = randomUUID();
      const interpretationId = randomUUID();
      const createdAt = new Date();
      const outputChecksum = hashCanonicalJson(explanation);
      const encryptedOutput = this.vault.encryptOutput(
        explanation,
        interpretationAad(context, reuseKey, outputChecksum),
      );
      const receipt = explainMarketingCampaignReceiptSchema.parse({
        receiptId,
        interpretationId,
        disposition: "GENERATED",
        campaignId: input.request.campaignId,
        evidenceSnapshotId: snapshot.id,
        skillKey: "marketing.performance_analyst",
        model: setup.provider.model,
        explanation,
        createdAt,
        replayed: false,
      });
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await this.interpretations.lockReuseKeyInTransaction(transaction, context, reuseKey);
      const actualCostUsd = await this.consumption.settleInTransaction(transaction, context, {
        reservation,
        usage: providerUsage,
        executionReceiptId: null,
      });
      await transaction.aiExecutionReceipt.create({ data: { id: receiptId, tenantId: context.tenantId, companyId: context.companyId, providerConfigurationId: setup.provider.id, identityId: null, systemIdentityId: setup.systemIdentity?.id ?? null, skillActivationId: activation.id, evidenceSnapshotId: snapshot.id, promptVersion: INTERPRETATION_PROMPT_VERSION, inputChecksum: snapshot.checksum, outputChecksum, moduleKey: "marketing", capability: AI_USE_CAPABILITY, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, companyPolicyRevisionId: companyPolicy?.policyRevisionId ?? null, billingPeriodStartAt: companyPolicy ? startOfRiyadhMonth(createdAt) : null, outcome: AiExecutionOutcome.SUCCEEDED, providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model, configurationVersion: setup.provider.configurationVersion, identityVersion: null, systemIdentityVersion: setup.systemIdentity?.version ?? null, inputCharacters: JSON.stringify(snapshot.payload).length, outputCharacters: JSON.stringify(explanation).length, inputTokens: providerUsage?.inputTokens ?? null, cachedInputTokens: providerUsage?.cachedInputTokens ?? null, outputTokens: providerUsage?.outputTokens ?? null, reasoningTokens: providerUsage?.reasoningTokens ?? null, modelPriceRevisionId: reservation.modelPriceRevisionId, estimatedCostUsd: reservation.estimatedCostUsd, actualCostUsd, providerRequestId: providerUsage?.providerRequestId ?? null, requestId: RequestContext.correlationId() ?? randomUUID(), createdAt } });
      await transaction.aiInterpretation.create({ data: {
        id: interpretationId, tenantId: context.tenantId, companyId: context.companyId,
        subjectKind: "MARKETING_CAMPAIGN", subjectId: input.request.campaignId,
        evidenceSnapshotId: snapshot.id, evidenceChecksum: snapshot.checksum,
        reuseKey, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
        promptVersion: INTERPRETATION_PROMPT_VERSION, language: input.request.language,
        systemIdentityVersion: setup.systemIdentity?.version ?? null, companyContextDigest, modelProfileDigest,
        providerSnapshot: setup.provider.provider, modelSnapshot: setup.provider.model,
        sourceExecutionReceiptId: receiptId, ...encryptedOutput, outputChecksum,
        expiresAt: new Date(createdAt.valueOf() + INTERPRETATION_RETENTION_MS),
        createdByUserId: context.actorUserId,
      } });
      await transaction.aiInterpretationPlacement.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
        interpretationId, kind: "MARKETING_CAMPAIGN", subjectId: input.request.campaignId,
        moduleKey: "marketing", createdByUserId: context.actorUserId,
      } });
      await this.interpretations.markRunCompleted(transaction, context, { runId: claim.runId, interpretationId });
      await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "platform.ai.marketing_campaign_explained", entityType: "AiExecutionReceipt", entityId: receiptId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { campaignId: input.request.campaignId, snapshotId: snapshot.id, checksum: snapshot.checksum, skillKey: skill.key, model: setup.provider.model } } });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: { ...receipt, createdAt: receipt.createdAt.toISOString() } } });
      });
      reservationSettled = true;
      return receipt;
    } catch (error) {
      if (reservation && !reservationSettled) {
        try {
          await this.consumption.settleAfterProviderFailure({
            context,
            reservation,
            usage: providerUsage,
            safeReasonCode: "PERSISTENCE_FAILED_AFTER_PROVIDER_CALL",
          });
        } catch (settlementError) {
          this.logger.error(JSON.stringify({ event: "basira.marketing_campaign_persistence_cost_settlement_failed", error: settlementError instanceof Error ? settlementError.name : "unknown" }));
        }
      }
      await this.completeClaimAfterPersistenceFailure(context, claim.runId, begun.receiptId);
      this.logger.error(JSON.stringify({ event: "basira.marketing_campaign_explanation_persistence_failed", error: error instanceof Error ? error.name : "unknown" }));
      throw new HttpException("The AI explanation could not be stored safely. No result was published.", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async requireLiveSkillActivation(
    context: TrustedCompanyActorContext,
    skillKey: string,
    skillVersion: number,
    policyVersion: number,
    catalogueStatus: "PILOT" | "ACTIVE" | "PLANNED" | "VALIDATED" | "SUSPENDED",
  ) {
    const expectedStatus = catalogueStatus === "ACTIVE" ? AiSkillActivationStatus.ACTIVE : AiSkillActivationStatus.PILOT;
    const activation = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.aiSkillActivation.findFirst({
      where: {
        tenantId: context.tenantId, companyId: context.companyId, skillKey, skillVersion, policyVersion,
        status: expectedStatus, validFrom: { lte: new Date() }, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      select: { id: true, dailyRequestLimit: true, dailyCostLimit: true },
    }));
    if (!activation) throw new ForbiddenException("This Basira skill is not activated for the active company.");
    const suite = evaluationSuiteForAiSkill(skillKey, skillVersion, policyVersion);
    if (!suite) throw new ForbiddenException("This Basira skill has no current offline evaluation suite.");
    const catalogue = AI_SKILL_CATALOG.find((skill) => skill.key === skillKey && skill.version === skillVersion && skill.policyVersion === policyVersion);
    if (!catalogue) throw new ForbiddenException("This Basira skill is not in the current catalogue.");
    const passedEvaluation = await this.database.inTenantTransaction(context.tenantId, (transaction) =>
      transaction.aiSkillEvaluationRun.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          skillKey,
          skillVersion,
          policyVersion,
          suiteKey: suite.key,
          suiteVersion: suite.version,
          suiteChecksum: runOfflineAiSkillEvaluation(catalogue).suiteChecksum,
          mode: "OFFLINE",
          status: "PASSED",
        },
        select: { id: true },
      }),
    );
    if (!passedEvaluation) throw new ForbiddenException("The current Basira offline evaluation gate has not passed for this company.");
    return activation;
  }

  /** The planner fails closed before it claims a provider slot or writes an
   * idempotency receipt. A frozen checksum alone is not enough: a decision
   * explanation needs a fair, complete comparison behind the alert. */
  private assertDecisionEvidenceEligible(brief: BasiraDecisionAlertBrief): void {
    if (!brief.salesChange || brief.salesChange.dataQuality !== "READY") {
      throw new ConflictException("The alert evidence is not ready for Basira explanation because the sales comparison is incomplete, stale, unavailable, or conflicted.");
    }
  }

  /** A post-provider persistence failure must release the single-flight claim
   * and settle the request key. It must never strand a PENDING run that would
   * make the next manual attempt appear permanently in progress. */
  private async completeClaimAfterPersistenceFailure(
    context: TrustedCompanyActorContext,
    runId: string,
    idempotencyReceiptId: string,
  ): Promise<void> {
    try {
      await this.interpretations.markRunFailed(context, {
        runId,
        safeFailureCode: "interpretation_persistence_failed",
      });
    } catch (error) {
      this.logger.error(JSON.stringify({ event: "basira.interpretation_claim_release_failed", error: error instanceof Error ? error.name : "unknown" }));
    }
    await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: context.tenantId,
          companyId: context.companyId,
          actorUserId: context.actorUserId,
          action: "platform.ai.interpretation_persistence_failed",
          entityType: "AiInterpretationRun",
          entityId: runId,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          afterJson: { safeFailureCode: "interpretation_persistence_failed" },
        },
      });
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: idempotencyReceiptId,
        response: { status: 503, headers: null, body: { error: "AI_INTERPRETATION_PERSISTENCE_FAILED" } },
      });
    });
  }

  /**
   * Approved company context is reference data, not a prompt extension. The
   * adapter keeps it out of provider instructions and sends it only inside
   * the frozen user payload under an explicit untrusted-data boundary.
   */
  private companyContextData(contexts: readonly { presentationStyle: "CONCISE" | "DETAILED"; approvedTermsJson: unknown; policyReferencesJson: unknown }[]): readonly Record<string, unknown>[] {
    return contexts.map((context) => ({
      presentationStyle: context.presentationStyle,
      terms: context.approvedTermsJson,
      policyReferences: context.policyReferencesJson,
    }));
  }

  private companyContextDigest(contexts: readonly { id: string; presentationStyle: "CONCISE" | "DETAILED"; approvedTermsJson: unknown; policyReferencesJson: unknown }[]): string {
    return hashCanonicalJson(contexts.map((context) => ({
      id: context.id,
      presentationStyle: context.presentationStyle,
      terms: context.approvedTermsJson,
      policyReferences: context.policyReferencesJson,
    })).sort((left, right) => left.id.localeCompare(right.id)) as import("../core-controls/idempotency.service.js").CanonicalJsonValue);
  }

  private requireLiveModelProfile(
    provider: AiProviderKind,
    model: string,
    skillKey: string,
  ) {
    const profile = liveAiModelProfileForSkill({ provider, model, skillKey });
    if (!profile) {
      throw new ConflictException(
        "The active AI provider/model is not an approved live Basira capability for this skill.",
      );
    }
    return profile;
  }

  private modelProfileDigest(
    provider: string,
    model: string,
    profile: NonNullable<ReturnType<typeof liveAiModelProfileForSkill>>,
  ): string {
    return hashCanonicalJson({ provider, model, ...profile });
  }

  private interpretationReuseKey(input: Readonly<{
    subjectKind: "DECISION_ALERT" | "MARKETING_CAMPAIGN";
    subjectId: string;
    skillKey: string;
    skillVersion: number;
    policyVersion: number;
    language: "ar" | "en";
    evidenceChecksum: string;
    companyContextDigest: string;
    systemIdentityVersion: number | null;
    modelProfileDigest: string;
  }>): string {
    return hashCanonicalJson({ ...input, promptVersion: INTERPRETATION_PROMPT_VERSION });
  }

  private async completeInProgressInterpretationRequest(
    context: TrustedCompanyActorContext,
    idempotencyReceiptId: string,
  ): Promise<void> {
    await this.database.inTenantTransaction(context.tenantId, (transaction) =>
      this.idempotency.completeInTransaction(transaction, context, {
        receiptId: idempotencyReceiptId,
        response: { status: 409, headers: null, body: { error: "AI_INTERPRETATION_IN_PROGRESS" } },
      }),
    );
  }
}
