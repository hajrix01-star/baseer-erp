import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AiProviderConnectionReceipt,
  ActivateAiProviderConfigurationRequest,
  ApproveAiCompanyContextRequest,
  ConfigureAiProviderRequest,
  CreateAiCompanyContextDraftRequest,
  CreateAiEvaluationFeedbackRequest,
  RunAiSkillOfflineEvaluationRequest,
  AiSkillEvaluationRunReceipt,
  CreateAiIdentityRequest,
  CreateAiSkillActivationRequest,
  CreateAiSystemIdentityRequest,
  RevokeAiCompanyContextRequest,
  SuspendAiSkillActivationRequest,
  PutAiCompanyPolicyRequest,
} from "@baseer-erp/contracts";
import { aiProviderConnectionReceiptSchema } from "@baseer-erp/contracts";
import OpenAI from "openai";

import { TenantAdministrationContextService } from "../administration/tenant-administration-context.service.js";
import { CompanyContextService } from "../company-context/company-context.service.js";
import { IdempotencyService } from "../core-controls/idempotency.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiCompanyContextStatus,
  AiCompanyIdentityStatus,
  AiBudgetReservationStatus,
  AiEvaluationFeedbackKind,
  AiSkillEvaluationRunMode,
  AiSkillEvaluationRunStatus,
  AiProviderConfigurationStatus,
  AiCompanySkillOverrideState,
  AiSkillActivationOrigin,
  AiSkillActivationStatus,
  CompanyStatus,
  Prisma,
  type AiProviderKind,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { AiCredentialVault } from "./ai-credential-vault.js";
import { AiCompanyPolicyService } from "./ai-company-policy.service.js";
import { startOfRiyadhDay } from "./ai-consumption-time.js";
import { AiProviderAdapterRegistry } from "./ai-provider-adapter-registry.js";
import {
  canConfigureAiProviderModel,
  listAiProviderModelCapabilities,
} from "./ai-provider-capability-registry.js";
import type { InterpretationSubjectAccess } from "./ai-interpretation-center.service.js";
import { AI_SKILL_CATALOG, runtimeAvailabilityForAiSkill, selectAiSkill } from "./ai-skills.js";
import { evaluationSuiteForAiSkill, runOfflineAiSkillEvaluation } from "./ai-skill-evaluation-suites.js";

const PROVIDER_READ = "platform.ai.configuration.read";
const AI_USE = "platform.ai.use";
const IDENTITY_READ = "platform.ai.identity.read";
const SYSTEM_IDENTITY_READ = "platform.ai.system_identity.read";
const PROVIDER_WRITE = "platform.ai.configuration.write";
const IDENTITY_WRITE = "platform.ai.identity.write";
const SYSTEM_IDENTITY_WRITE = "platform.ai.system_identity.write";
const PROVIDER_OPERATION = "platform.ai.provider.configure";
const PROVIDER_ACTIVATE_OPERATION = "platform.ai.provider.activate";
const IDENTITY_OPERATION = "platform.ai.identity.create_version";
const SYSTEM_IDENTITY_OPERATION = "platform.ai.system_identity.create_version";
const CONTEXT_READ = "platform.ai.context.read";
const CONTEXT_WRITE = "platform.ai.context.write";
const SKILLS_READ = "platform.ai.skills.read";
const SKILLS_ACTIVATE = "platform.ai.skills.activate";
const POLICY_READ = "platform.ai.policy.read";
const POLICY_MANAGE = "platform.ai.policy.manage";
const RECEIPTS_READ = "platform.ai.receipts.read";
const EVALUATIONS_READ = "platform.ai.evaluations.read";
const EVALUATIONS_WRITE = "platform.ai.evaluations.write";
const HUMAN_INSIGHTS_READ = "decision.human_insights.read";
const HUMAN_INSIGHTS_WRITE = "decision.human_insights.write";
const ALERTS_READ = "decision.alerts.read";
const MARKETING_INSIGHTS_READ = "marketing.insights.read";
const CONTEXT_DRAFT_OPERATION = "platform.ai.context.create_draft";
const CONTEXT_APPROVE_OPERATION = "platform.ai.context.approve";
const CONTEXT_REVOKE_OPERATION = "platform.ai.context.revoke";
const SKILL_ACTIVATE_OPERATION = "platform.ai.skills.activate";
const SKILL_SUSPEND_OPERATION = "platform.ai.skills.suspend";
const EVALUATION_OPERATION = "platform.ai.evaluations.create";
const OFFLINE_EVALUATION_OPERATION = "platform.ai.evaluations.run_offline";

@Injectable()
export class AiPlatformService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
    private readonly vault: AiCredentialVault,
    private readonly tenantAdministration: TenantAdministrationContextService,
    private readonly adapters: AiProviderAdapterRegistry,
    private readonly companyPolicy: AiCompanyPolicyService,
  ) {}

  async read(input: { accessToken: string; companyId: string }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [
        PROVIDER_READ,
        IDENTITY_READ,
        SYSTEM_IDENTITY_READ,
      ],
    });
    return this.readForContext({
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    });
  }

  async configureProvider(
    context: TrustedCompanyActorContext,
    input: ConfigureAiProviderRequest,
  ) {
    const model = input.model.trim();
    this.assertConfigurableProviderModel(input.provider, model);
    const envelope = this.vault.encryptApiKey(input.apiKey);
    const configurationId = await this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        await this.lockTenantProviderConfiguration(transaction, context);
        await this.requireCurrentProviderPriceRevision(
          transaction,
          input.provider,
          model,
        );
        const begun = await this.idempotency.beginInTransaction(
          transaction,
          context,
          {
            operation: PROVIDER_OPERATION,
            key: input.idempotencyKey,
            request: {
              provider: input.provider,
              model,
              dailyRequestLimit: input.dailyRequestLimit,
              dailyCostLimit: input.dailyCostLimit ?? null,
            },
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        );
        if (begun.kind === "replay") {
          return (begun.response.body as { providerConfigurationId: string })
            .providerConfigurationId;
        }
        if (begun.kind === "in-progress") {
          throw new ConflictException("The AI provider request is still in progress.");
        }

        const id = randomUUID();
        await transaction.aiProviderConfiguration.create({
          data: {
            id,
            tenantId: context.tenantId,
            provider: input.provider,
            model,
            status: AiProviderConfigurationStatus.DRAFT,
            isDefault: false,
            dailyRequestLimit: input.dailyRequestLimit,
            dailyCostLimit: input.dailyCostLimit ?? null,
            ...envelope,
          },
        });
        await this.audit(transaction, context, "platform.ai.provider_configured", id, {
          provider: input.provider,
          model,
          dailyRequestLimit: input.dailyRequestLimit,
          dailyCostLimit: input.dailyCostLimit ?? null,
          configurationVersion: 1,
        });
        await this.idempotency.completeInTransaction(transaction, context, {
          receiptId: begun.receiptId,
          response: {
            status: 201,
            headers: null,
            body: { providerConfigurationId: id },
          },
        });
        return id;
      },
    );
    return this.requireProviderConfiguration(context, configurationId);
  }

  /**
   * Changes the single active AI profile for a tenant. Credentials never leave
   * the server; only profiles backed by an implemented adapter are selectable.
   */
  async activateProvider(
    context: TrustedCompanyActorContext,
    configurationId: string,
    input: ActivateAiProviderConfigurationRequest,
  ) {
    const activatedId = await this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        await this.lockTenantProviderConfiguration(transaction, context);
        const configuration = await transaction.aiProviderConfiguration.findFirst({
          where: { id: configurationId, tenantId: context.tenantId, status: AiProviderConfigurationStatus.VALIDATED },
          select: { id: true, provider: true, model: true },
        });
        if (!configuration) throw new NotFoundException("The AI provider configuration was not found.");
        this.assertConfigurableProviderModel(
          configuration.provider,
          configuration.model,
        );
        await this.requireCurrentProviderPriceRevision(
          transaction,
          configuration.provider,
          configuration.model,
        );
        const begun = await this.idempotency.beginInTransaction(transaction, context, {
          operation: PROVIDER_ACTIVATE_OPERATION,
          key: input.idempotencyKey,
          request: { providerConfigurationId: configuration.id },
          expiresAt: new Date(Date.now() + 86_400_000),
        });
        if (begun.kind === "replay") return (begun.response.body as { providerConfigurationId: string }).providerConfigurationId;
        if (begun.kind === "in-progress") throw new ConflictException("The AI provider activation is still in progress.");

        await transaction.aiProviderConfiguration.updateMany({
          where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true },
          data: { isDefault: false },
        });
        await transaction.aiProviderConfiguration.update({ where: { id: configuration.id }, data: { status: AiProviderConfigurationStatus.ACTIVE, isDefault: true } });
        await this.audit(transaction, context, "platform.ai.provider_activated", configuration.id, {
          provider: configuration.provider,
          model: configuration.model,
        });
        await this.idempotency.completeInTransaction(transaction, context, {
          receiptId: begun.receiptId,
          response: { status: 200, headers: null, body: { providerConfigurationId: configuration.id } },
        });
        return configuration.id;
      },
    );
    return this.requireProviderConfiguration(context, activatedId);
  }

  /**
   * A genuine provider probe for the owner-only configuration screen. It does
   * not send a prompt or any Baseer data; it only verifies the configured key
   * can reach and retrieve the selected model now.
   */
  async checkProviderConnection(
    context: TrustedCompanyActorContext,
  ): Promise<AiProviderConnectionReceipt> {
    const checkedAt = new Date();
    const provider = await this.database.inTenantTransaction(
      context.tenantId,
      (transaction) =>
        transaction.aiProviderConfiguration.findFirst({
          where: {
            tenantId: context.tenantId,
            status: { in: [AiProviderConfigurationStatus.DRAFT, AiProviderConfigurationStatus.VALIDATED, AiProviderConfigurationStatus.ACTIVE] },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            provider: true,
            model: true,
            encryptedCredential: true,
            credentialIv: true,
            credentialTag: true,
            credentialKeyVersion: true,
          },
        }),
    );
    if (!provider || provider.provider !== "OPENAI_COMPATIBLE") {
      return {
        configurationId: null,
        state: "UNCONFIGURED",
        reason: "PROVIDER_NOT_CONFIGURED",
        provider: null,
        model: null,
        upstreamStatus: null,
        checkedAt,
      };
    }
    if (!canConfigureAiProviderModel(provider.provider, provider.model)) {
      return this.persistProviderConnectionCheck(context, {
        configurationId: provider.id,
        state: "ERROR",
        reason: "MODEL_UNAVAILABLE",
        provider: provider.provider,
        model: provider.model,
        upstreamStatus: null,
        checkedAt,
      });
    }

    let apiKey: string;
    try {
      apiKey = this.vault.decryptApiKey(provider);
    } catch {
      return this.persistProviderConnectionCheck(context, {
        configurationId: provider.id,
        state: "ERROR",
        reason: "CREDENTIAL_DECRYPTION_FAILED",
        provider: provider.provider,
        model: provider.model,
        upstreamStatus: null,
        checkedAt,
      });
    }
    try {
      await this.adapters.probeOpenAiProvider({ apiKey, model: provider.model });
      await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        if (provider.status === AiProviderConfigurationStatus.DRAFT) {
          await transaction.aiProviderConfiguration.update({ where: { id: provider.id }, data: { status: AiProviderConfigurationStatus.VALIDATED } });
          await this.audit(transaction, context, "platform.ai.provider_validated", provider.id, { provider: provider.provider, model: provider.model });
        }
      });
      return this.persistProviderConnectionCheck(context, {
        configurationId: provider.id,
        state: "READY",
        reason: null,
        provider: provider.provider,
        model: provider.model,
        upstreamStatus: 200,
        checkedAt,
      });
    } catch (error) {
      const failure = classifyProviderProbeFailure(error);
      return this.persistProviderConnectionCheck(context, {
        configurationId: provider.id,
        state: "ERROR",
        reason: failure.reason,
        provider: provider.provider,
        model: provider.model,
        upstreamStatus: failure.upstreamStatus,
        checkedAt,
      });
    }
  }

  async createSystemIdentity(
    context: TrustedCompanyActorContext,
    input: CreateAiSystemIdentityRequest,
  ) {
    const identityId = await this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        await this.lockTenantSystemIdentity(transaction, context);
        const begun = await this.idempotency.beginInTransaction(
          transaction,
          context,
          {
            operation: SYSTEM_IDENTITY_OPERATION,
            key: input.idempotencyKey,
            request: {
              assistantNameAr: input.assistantNameAr,
              assistantNameEn: input.assistantNameEn,
              defaultLanguage: input.defaultLanguage,
              toneInstructions: input.toneInstructions,
              safetyInstructions: input.safetyInstructions,
            },
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        );
        if (begun.kind === "replay") {
          return (begun.response.body as { systemIdentityId: string })
            .systemIdentityId;
        }
        if (begun.kind === "in-progress") {
          throw new ConflictException("The system AI identity request is still in progress.");
        }

        const latest = await transaction.aiSystemIdentity.aggregate({
          where: { tenantId: context.tenantId },
          _max: { version: true },
        });
        await transaction.aiSystemIdentity.updateMany({
          where: {
            tenantId: context.tenantId,
            status: AiCompanyIdentityStatus.ACTIVE,
          },
          data: { status: AiCompanyIdentityStatus.ARCHIVED },
        });
        const id = randomUUID();
        const version = (latest._max.version ?? 0) + 1;
        await transaction.aiSystemIdentity.create({
          data: {
            id,
            tenantId: context.tenantId,
            version,
            status: AiCompanyIdentityStatus.ACTIVE,
            assistantNameAr: input.assistantNameAr.trim(),
            assistantNameEn: input.assistantNameEn.trim(),
            defaultLanguage: input.defaultLanguage,
            toneInstructions: input.toneInstructions.trim(),
            safetyInstructions: input.safetyInstructions.trim(),
          },
        });
        await this.audit(
          transaction,
          context,
          "platform.ai.system_identity_activated",
          id,
          {
            version,
            assistantNameAr: input.assistantNameAr.trim(),
            assistantNameEn: input.assistantNameEn.trim(),
            defaultLanguage: input.defaultLanguage,
          },
        );
        await this.idempotency.completeInTransaction(transaction, context, {
          receiptId: begun.receiptId,
          response: {
            status: 201,
            headers: null,
            body: { systemIdentityId: id },
          },
        });
        return id;
      },
    );
    return this.requireSystemIdentity(context, identityId);
  }

  private async createLegacyIdentity(
    context: TrustedCompanyActorContext,
    input: CreateAiIdentityRequest,
  ) {
    const identityId = await this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        await this.lockCompanyIdentity(transaction, context);
        const begun = await this.idempotency.beginInTransaction(
          transaction,
          context,
          {
            operation: IDENTITY_OPERATION,
            key: input.idempotencyKey,
            request: {
              displayNameAr: input.displayNameAr,
              displayNameEn: input.displayNameEn,
              defaultLanguage: input.defaultLanguage,
              toneInstructions: input.toneInstructions,
              safetyInstructions: input.safetyInstructions,
              policyReference: input.policyReference ?? null,
            },
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        );
        if (begun.kind === "replay") {
          return (begun.response.body as { identityId: string }).identityId;
        }
        if (begun.kind === "in-progress") {
          throw new ConflictException("The AI identity request is still in progress.");
        }

        const latest = await transaction.aiCompanyIdentity.aggregate({
          where: { tenantId: context.tenantId, companyId: context.companyId },
          _max: { version: true },
        });
        await transaction.aiCompanyIdentity.updateMany({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            status: AiCompanyIdentityStatus.ACTIVE,
          },
          data: { status: AiCompanyIdentityStatus.ARCHIVED },
        });
        const id = randomUUID();
        const version = (latest._max.version ?? 0) + 1;
        await transaction.aiCompanyIdentity.create({
          data: {
            id,
            tenantId: context.tenantId,
            companyId: context.companyId,
            version,
            status: AiCompanyIdentityStatus.ACTIVE,
            displayNameAr: input.displayNameAr.trim(),
            displayNameEn: input.displayNameEn.trim(),
            defaultLanguage: input.defaultLanguage,
            toneInstructions: input.toneInstructions.trim(),
            safetyInstructions: input.safetyInstructions.trim(),
            policyReference: input.policyReference?.trim() || null,
          },
        });
        await this.audit(transaction, context, "platform.ai.identity_activated", id, {
          version,
          defaultLanguage: input.defaultLanguage,
          policyReference: input.policyReference?.trim() || null,
        });
        await this.idempotency.completeInTransaction(transaction, context, {
          receiptId: begun.receiptId,
          response: { status: 201, headers: null, body: { identityId: id } },
        });
        return id;
      },
    );
    return this.requireIdentity(context, identityId);
  }

  /**
   * Company-owned prompt text is deliberately retired.  Older identity rows
   * remain auditable, but all new company knowledge must use the bounded,
   * approved context workflow below.
   */
  async createIdentity(
    _context: TrustedCompanyActorContext,
    _input: CreateAiIdentityRequest,
  ): Promise<never> {
    throw new ConflictException("Company AI identities were replaced by structured Basira company context. Free-form instructions are not accepted.");
  }

  async createCompanyContextDraft(
    context: TrustedCompanyActorContext,
    input: CreateAiCompanyContextDraftRequest,
  ) {
    const contextId = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: CONTEXT_DRAFT_OPERATION,
        key: input.idempotencyKey,
        request: { ...input, expiresAt: input.expiresAt?.toISOString() ?? null } as never,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return (begun.response.body as { contextId: string }).contextId;
      if (begun.kind === "in-progress") throw new ConflictException("The Basira company-context request is still in progress.");

      const latest = await transaction.aiCompanyContext.aggregate({
        where: { tenantId: context.tenantId, companyId: context.companyId, kind: input.kind, moduleScope: input.moduleScope },
        _max: { version: true },
      });
      const id = randomUUID();
      await transaction.aiCompanyContext.create({
        data: {
          id, tenantId: context.tenantId, companyId: context.companyId,
          version: (latest._max.version ?? 0) + 1, status: AiCompanyContextStatus.DRAFT,
          kind: input.kind, moduleScope: input.moduleScope,
          presentationStyle: input.presentationStyle,
          approvedTermsJson: { terms: input.terms, businessDomains: input.businessDomains },
          policyReferencesJson: input.policyReferences,
          sourceReference: input.sourceReference ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      });
      await this.audit(transaction, context, "platform.ai.company_context_drafted", id, {
        kind: input.kind, moduleScope: input.moduleScope, version: (latest._max.version ?? 0) + 1,
        termCount: input.terms.length, policyReferenceCount: input.policyReferences.length,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      });
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: begun.receiptId, response: { status: 201, headers: null, body: { contextId: id } },
      });
      return id;
    });
    return this.requireCompanyContext(context, contextId);
  }

  async approveCompanyContext(
    context: TrustedCompanyActorContext,
    contextId: string,
    input: ApproveAiCompanyContextRequest,
  ) {
    const approvedId = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const current = await transaction.aiCompanyContext.findFirst({
        where: { id: contextId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, kind: true, moduleScope: true, status: true },
      });
      if (!current) throw new NotFoundException("The Basira company context was not found.");
      if (current.status !== AiCompanyContextStatus.DRAFT) throw new ConflictException("Only a draft Basira company context can be approved.");
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: CONTEXT_APPROVE_OPERATION, key: input.idempotencyKey, request: { contextId },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return (begun.response.body as { contextId: string }).contextId;
      if (begun.kind === "in-progress") throw new ConflictException("The Basira company-context approval is still in progress.");
      const replaced = await transaction.aiCompanyContext.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, kind: current.kind, moduleScope: current.moduleScope, status: AiCompanyContextStatus.APPROVED },
        select: { id: true },
      });
      await transaction.aiCompanyContext.updateMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, kind: current.kind, moduleScope: current.moduleScope, status: AiCompanyContextStatus.APPROVED },
        data: { status: AiCompanyContextStatus.SUPERSEDED },
      });
      await transaction.aiCompanyContext.update({
        where: { id: current.id }, data: { status: AiCompanyContextStatus.APPROVED, supersedesContextId: replaced?.id ?? null, approvedByUserId: context.actorUserId, approvedAt: new Date() },
      });
      await this.audit(transaction, context, "platform.ai.company_context_approved", current.id, { kind: current.kind, moduleScope: current.moduleScope });
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: begun.receiptId, response: { status: 200, headers: null, body: { contextId: current.id } },
      });
      return current.id;
    });
    return this.requireCompanyContext(context, approvedId);
  }

  async revokeCompanyContext(
    context: TrustedCompanyActorContext,
    contextId: string,
    input: RevokeAiCompanyContextRequest,
  ) {
    const revokedId = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const current = await transaction.aiCompanyContext.findFirst({ where: { id: contextId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, status: true, approvedByUserId: true, approvedAt: true } });
      if (!current) throw new NotFoundException("The Basira company context was not found.");
      if (current.status !== AiCompanyContextStatus.DRAFT && current.status !== AiCompanyContextStatus.APPROVED) throw new ConflictException("This Basira company context cannot be revoked.");
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: CONTEXT_REVOKE_OPERATION, key: input.idempotencyKey, request: { contextId, reason: input.reason }, expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return (begun.response.body as { contextId: string }).contextId;
      if (begun.kind === "in-progress") throw new ConflictException("The Basira company-context revocation is still in progress.");
      await transaction.aiCompanyContext.update({ where: { id: current.id }, data: {
        status: AiCompanyContextStatus.REVOKED,
        approvedByUserId: current.approvedByUserId ?? context.actorUserId,
        approvedAt: current.approvedAt ?? new Date(),
        revocationReason: input.reason,
      } });
      await this.audit(transaction, context, "platform.ai.company_context_revoked", current.id, { reason: input.reason });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: { contextId: current.id } } });
      return current.id;
    });
    return this.requireCompanyContext(context, revokedId);
  }

  async createSkillActivation(context: TrustedCompanyActorContext, input: CreateAiSkillActivationRequest) {
    const skill = selectAiSkill(input.skillKey.split(".")[0] ?? "", input.skillKey) ?? undefined;
    const catalog = skill ?? (await import("./ai-skills.js")).AI_SKILL_CATALOG.find((item) => item.key === input.skillKey);
    if (!catalog || catalog.version !== input.skillVersion || catalog.policyVersion !== input.policyVersion) throw new ConflictException("The requested skill version is not in the code-owned Basira catalogue.");
    if (catalog.status !== "PILOT" && catalog.status !== "ACTIVE") throw new ConflictException("This Basira skill is not eligible for company activation.");
    if (catalog.riskTier === "S4") throw new ConflictException("S4 skills cannot be activated through company governance.");
    if (input.status === "ACTIVE" && catalog.status !== "ACTIVE") throw new ConflictException("A pilot catalogue skill can be activated for a company only as PILOT.");
    if (input.validUntil && input.validFrom && input.validUntil <= input.validFrom) throw new ConflictException("The skill activation end time must be after its start time.");
    const runtime = runtimeAvailabilityForAiSkill(catalog.key);
    if (runtime.state !== "READY") {
      throw new ConflictException(runtime.nextRequirement || "The governed runtime for this Basira skill is not ready.");
    }
    const suite = evaluationSuiteForAiSkill(catalog.key, catalog.version, catalog.policyVersion);
    if (!suite) throw new ConflictException("This Basira skill has no approved offline evaluation suite.");
    const passedEvaluation = await this.database.inTenantTransaction(context.tenantId, (transaction) =>
      transaction.aiSkillEvaluationRun.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          skillKey: catalog.key,
          skillVersion: catalog.version,
          policyVersion: catalog.policyVersion,
          suiteKey: suite.key,
          suiteVersion: suite.version,
          suiteChecksum: runOfflineAiSkillEvaluation(catalog).suiteChecksum,
          mode: AiSkillEvaluationRunMode.OFFLINE,
          status: AiSkillEvaluationRunStatus.PASSED,
        },
        select: { id: true },
      }),
    );
    if (!passedEvaluation) {
      throw new ConflictException("Run and pass the current offline Basira evaluation suite before starting a company pilot.");
    }

    const activationId = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: SKILL_ACTIVATE_OPERATION, key: input.idempotencyKey,
        request: { ...input, validFrom: input.validFrom?.toISOString() ?? null, validUntil: input.validUntil?.toISOString() ?? null } as never, expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return (begun.response.body as { activationId: string }).activationId;
      if (begun.kind === "in-progress") throw new ConflictException("The Basira skill activation request is still in progress.");
      const id = randomUUID();
      await transaction.aiSkillActivation.create({ data: {
        id, tenantId: context.tenantId, companyId: context.companyId,
        skillKey: catalog.key, skillVersion: catalog.version, policyVersion: catalog.policyVersion,
        status: input.status === "ACTIVE" ? AiSkillActivationStatus.ACTIVE : AiSkillActivationStatus.PILOT,
        validFrom: input.validFrom ?? new Date(), validUntil: input.validUntil ?? null,
        dailyRequestLimit: input.dailyRequestLimit ?? null, dailyCostLimit: input.dailyCostLimit ?? null,
        approvedByUserId: context.actorUserId, origin: AiSkillActivationOrigin.MANUAL,
      } });
      await this.audit(transaction, context, "platform.ai.skill_activated", id, { skillKey: catalog.key, skillVersion: catalog.version, policyVersion: catalog.policyVersion, status: input.status, evaluationRunId: passedEvaluation.id });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: { activationId: id } } });
      return id;
    });
    return this.requireSkillActivation(context, activationId);
  }

  async suspendSkillActivation(context: TrustedCompanyActorContext, activationId: string, input: SuspendAiSkillActivationRequest) {
    const suspendedId = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      // This is a provider-egress kill switch. It shares the reservation lock
      // so a request that began before suspension must re-check under the same
      // lock before it can reserve a cost or call the provider.
      await this.lockCompanyPolicyInTransaction(transaction, context);
      const activation = await transaction.aiSkillActivation.findFirst({ where: { id: activationId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, skillKey: true, status: true } });
      if (!activation) throw new NotFoundException("The Basira skill activation was not found.");
      if (activation.status === AiSkillActivationStatus.SUSPENDED) throw new ConflictException("The Basira skill is already suspended.");
      const begun = await this.idempotency.beginInTransaction(transaction, context, { operation: SKILL_SUSPEND_OPERATION, key: input.idempotencyKey, request: { activationId, reason: input.reason }, expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === "replay") return (begun.response.body as { activationId: string }).activationId;
      if (begun.kind === "in-progress") throw new ConflictException("The Basira skill suspension is still in progress.");
      await transaction.aiSkillActivation.update({ where: { id: activation.id }, data: { status: AiSkillActivationStatus.SUSPENDED, suspendedByUserId: context.actorUserId, suspendedAt: new Date(), suspensionReason: input.reason } });
      await transaction.aiCompanySkillOverride.upsert({
        where: { tenantId_companyId_skillKey: { tenantId: context.tenantId, companyId: context.companyId, skillKey: activation.skillKey } },
        create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, skillKey: activation.skillKey, state: AiCompanySkillOverrideState.BLOCKED, reason: input.reason, changedByUserId: context.actorUserId },
        update: { state: AiCompanySkillOverrideState.BLOCKED, reason: input.reason, changedByUserId: context.actorUserId, changedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await this.audit(transaction, context, "platform.ai.skill_suspended", activation.id, { reason: input.reason });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: { activationId: activation.id } } });
      return activation.id;
    });
    return this.requireSkillActivation(context, suspendedId);
  }

  async createEvaluationFeedback(context: TrustedCompanyActorContext, input: CreateAiEvaluationFeedbackRequest) {
    const feedbackId = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await transaction.aiExecutionReceipt.findFirst({ where: { id: input.executionReceiptId, tenantId: context.tenantId, companyId: context.companyId, outcome: "SUCCEEDED" }, select: { id: true } });
      if (!receipt) throw new NotFoundException("The Basira execution receipt was not found.");
      const begun = await this.idempotency.beginInTransaction(transaction, context, { operation: EVALUATION_OPERATION, key: input.idempotencyKey, request: { executionReceiptId: input.executionReceiptId, kind: input.kind, note: input.note ?? null }, expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === "replay") return (begun.response.body as { feedbackId: string }).feedbackId;
      if (begun.kind === "in-progress") throw new ConflictException("The Basira evaluation request is still in progress.");
      const id = randomUUID();
      await transaction.aiEvaluationFeedback.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, executionReceiptId: receipt.id, kind: input.kind as AiEvaluationFeedbackKind, note: input.note ?? null, createdByUserId: context.actorUserId } });
      await this.audit(transaction, context, "platform.ai.execution_evaluated", id, { executionReceiptId: receipt.id, kind: input.kind });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: { feedbackId: id } } });
      return id;
    });
    return { id: feedbackId };
  }

  /**
   * Runs only code-owned Arabic control cases. This is intentionally a
   * zero-egress readiness check: it does not read company facts, reserve a
   * provider budget, or produce a model answer. A limited pilot still needs
   * an explicit activation and the deployment's server gate.
   */
  async runOfflineSkillEvaluation(
    context: TrustedCompanyActorContext,
    input: RunAiSkillOfflineEvaluationRequest,
  ): Promise<AiSkillEvaluationRunReceipt> {
    const catalog = AI_SKILL_CATALOG.find((skill) => skill.key === input.skillKey);
    if (!catalog || catalog.version !== input.skillVersion || catalog.policyVersion !== input.policyVersion) {
      throw new ConflictException("The requested skill version is not in the code-owned Basira catalogue.");
    }
    if (catalog.status !== "PILOT" && catalog.status !== "ACTIVE") {
      throw new ConflictException("Only a pilot or active catalogue skill can run an offline evaluation.");
    }
    const evaluation = runOfflineAiSkillEvaluation(catalog);
    const runtime = runtimeAvailabilityForAiSkill(catalog.key);
    const status = evaluation.passed
      ? AiSkillEvaluationRunStatus.PASSED
      : runtime.state === "NOT_IMPLEMENTED" || evaluation.suite.key === "missing-suite"
        ? AiSkillEvaluationRunStatus.BLOCKED
        : AiSkillEvaluationRunStatus.FAILED;
    const runId = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: OFFLINE_EVALUATION_OPERATION,
        key: input.idempotencyKey,
        request: {
          skillKey: catalog.key,
          skillVersion: catalog.version,
          policyVersion: catalog.policyVersion,
          suiteKey: evaluation.suite.key,
          suiteVersion: evaluation.suite.version,
          suiteChecksum: evaluation.suiteChecksum,
        },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return { id: (begun.response.body as { evaluationRunId: string }).evaluationRunId, replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The offline Basira evaluation is still in progress.");

      const id = randomUUID();
      await transaction.aiSkillEvaluationRun.create({
        data: {
          id,
          tenantId: context.tenantId,
          companyId: context.companyId,
          skillKey: catalog.key,
          skillVersion: catalog.version,
          policyVersion: catalog.policyVersion,
          suiteKey: evaluation.suite.key,
          suiteVersion: evaluation.suite.version || 1,
          suiteChecksum: evaluation.suiteChecksum,
          mode: AiSkillEvaluationRunMode.OFFLINE,
          status,
          totalCaseCount: Math.max(1, evaluation.totalCaseCount),
          passedCaseCount: evaluation.totalCaseCount === 0 ? 0 : evaluation.passedCaseCount,
          failedCaseCount: evaluation.totalCaseCount === 0 ? 1 : evaluation.failedCaseCount,
          resultSummaryJson: {
            runtimeState: runtime.state,
            runtimeRequirement: runtime.nextRequirement || null,
            cases: evaluation.results.map((item) => ({
              caseKey: item.caseKey,
              passed: item.passed,
              expectedDisposition: item.expectedDisposition,
              controls: item.controls,
              failures: item.failures,
            })),
          },
          createdByUserId: context.actorUserId,
        },
      });
      await this.audit(transaction, context, "platform.ai.skill_offline_evaluated", id, {
        skillKey: catalog.key,
        skillVersion: catalog.version,
        policyVersion: catalog.policyVersion,
        suiteKey: evaluation.suite.key,
        suiteVersion: evaluation.suite.version || 1,
        suiteChecksum: evaluation.suiteChecksum,
        status,
        totalCaseCount: Math.max(1, evaluation.totalCaseCount),
        passedCaseCount: evaluation.totalCaseCount === 0 ? 0 : evaluation.passedCaseCount,
        failedCaseCount: evaluation.totalCaseCount === 0 ? 1 : evaluation.failedCaseCount,
      });
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: begun.receiptId,
        response: { status: 201, headers: null, body: { evaluationRunId: id } },
      });
      return { id, replayed: false };
    });
    return this.requireSkillEvaluationRun(context, runId.id, runId.replayed);
  }

  async authorizeProviderWrite(accessToken: string, companyId: string) {
    return this.authorizeTenantOwner(accessToken, companyId);
  }

  async authorizeSystemIdentityWrite(accessToken: string, companyId: string) {
    return this.authorizeTenantOwner(accessToken, companyId);
  }

  async authorizeIdentityWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, IDENTITY_WRITE);
  }

  async authorizeCompanyContextWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, CONTEXT_WRITE);
  }

  async authorizeSkillActivation(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, SKILLS_ACTIVATE);
  }

  async readCompanyPolicy(input: { accessToken: string; companyId: string }) {
    const context = await this.authorize(input.accessToken, input.companyId, POLICY_READ);
    return this.companyPolicy.read(context, await this.canManageCompanyPolicy(input.accessToken, input.companyId));
  }

  async putCompanyPolicy(context: TrustedCompanyActorContext, input: PutAiCompanyPolicyRequest) {
    return this.companyPolicy.put(context, input);
  }

  async authorizeCompanyPolicyWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, POLICY_MANAGE);
  }

  async authorizeEvaluationWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, EVALUATIONS_WRITE);
  }

  /** A saved explanation is still protected by the source-domain capability.
   * `platform.ai.use` alone never reveals a campaign or decision alert. */
  async authorizeInterpretationRead(accessToken: string, companyId: string): Promise<InterpretationSubjectAccess> {
    return this.authorizeInterpretationAccess(accessToken, companyId, [HUMAN_INSIGHTS_READ]);
  }

  async authorizeHumanInsightWrite(accessToken: string, companyId: string): Promise<InterpretationSubjectAccess> {
    // A human record always exposes its source interpretation.  Requiring the
    // read capability here prevents a narrow custom role from writing against
    // guessed interpretation IDs it is not authorised to inspect.
    return this.authorizeInterpretationAccess(accessToken, companyId, [HUMAN_INSIGHTS_READ, HUMAN_INSIGHTS_WRITE]);
  }

  async readGovernance(input: { accessToken: string; companyId: string }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [CONTEXT_READ, SKILLS_READ, RECEIPTS_READ, EVALUATIONS_READ],
    });
    const context: TrustedCompanyActorContext = {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const dayStartAt = startOfRiyadhDay(new Date());
      const [companyContexts, activations, receipts, evaluations, evaluationRuns, consumption] = await Promise.all([
        transaction.aiCompanyContext.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId },
          orderBy: [{ createdAt: "desc" }], take: 100,
          select: { id: true, version: true, status: true, kind: true, moduleScope: true, presentationStyle: true, approvedTermsJson: true, policyReferencesJson: true, sourceReference: true, expiresAt: true, revocationReason: true, approvedAt: true, createdAt: true },
        }),
        transaction.aiSkillActivation.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ updatedAt: "desc" }], take: 100,
          select: { id: true, skillKey: true, skillVersion: true, policyVersion: true, status: true, validFrom: true, validUntil: true, dailyRequestLimit: true, dailyCostLimit: true, approvedAt: true, suspendedAt: true, suspensionReason: true, createdAt: true, updatedAt: true },
        }),
        transaction.aiExecutionReceipt.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ createdAt: "desc" }], take: 100,
          select: { id: true, moduleKey: true, capability: true, skillKey: true, skillVersion: true, policyVersion: true, outcome: true, providerSnapshot: true, modelSnapshot: true, configurationVersion: true, identityVersion: true, systemIdentityVersion: true, promptVersion: true, evidenceSnapshotId: true, skillActivationId: true, inputChecksum: true, outputChecksum: true, safeErrorCode: true, requestId: true, createdAt: true },
        }),
        transaction.aiEvaluationFeedback.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ createdAt: "desc" }], take: 100,
          select: { id: true, executionReceiptId: true, kind: true, note: true, createdAt: true },
        }),
        transaction.aiSkillEvaluationRun.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ createdAt: "desc" }], take: 100,
          select: { id: true, skillKey: true, skillVersion: true, policyVersion: true, suiteKey: true, suiteVersion: true, suiteChecksum: true, mode: true, status: true, totalCaseCount: true, passedCaseCount: true, failedCaseCount: true, createdAt: true },
        }),
        transaction.aiBudgetReservation.aggregate({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            dayStartAt,
            status: { in: [AiBudgetReservationStatus.RESERVED, AiBudgetReservationStatus.SETTLED, AiBudgetReservationStatus.UNKNOWN_PROVIDER_OUTCOME] },
          },
          _sum: { chargeCostUsd: true },
          _count: { _all: true },
        }),
      ]);
      const latestEvaluationBySkill = new Map<string, (typeof evaluationRuns)[number]>();
      for (const run of evaluationRuns) {
        const key = `${run.skillKey}:${run.skillVersion}:${run.policyVersion}`;
        if (!latestEvaluationBySkill.has(key)) latestEvaluationBySkill.set(key, run);
      }
      return {
        companyId: context.companyId,
        catalogue: AI_SKILL_CATALOG.map((skill) => ({
          key: skill.key,
          version: skill.version,
          policyVersion: skill.policyVersion,
          nameAr: skill.nameAr,
          nameEn: skill.nameEn,
          riskTier: skill.riskTier,
          status: skill.status,
          purpose: skill.purpose,
          activationCondition: skill.activationCondition,
          requiredCapabilities: skill.requiredCapabilities,
          nonNegotiableRules: skill.nonNegotiableRules,
          runtime: runtimeAvailabilityForAiSkill(skill.key),
          latestOfflineEvaluation: latestEvaluationBySkill.get(`${skill.key}:${skill.version}:${skill.policyVersion}`) ?? null,
        })),
        companyContexts,
        activations,
        receipts,
        evaluations,
        evaluationRuns,
        consumption: {
          dayStartAt,
          currency: "USD" as const,
          chargedCostUsd: consumption._sum.chargeCostUsd?.toString() ?? "0",
          providerCalls: consumption._count._all,
        },
      };
    });
  }

  private async authorizeTenantOwner(accessToken: string, companyId: string): Promise<TrustedCompanyActorContext> {
    const owner = await this.tenantAdministration.authorizeOwner(accessToken);
    return this.database.inTenantTransaction(owner.tenantId, async (transaction) => {
      const company = await transaction.company.findFirst({
        where: { id: companyId, tenantId: owner.tenantId, status: CompanyStatus.ACTIVE },
        select: { id: true },
      });
      if (!company) throw new NotFoundException("The tenant audit company was not found.");
      return { tenantId: owner.tenantId, companyId: company.id, actorUserId: owner.actorUserId };
    });
  }
  private async authorize(accessToken: string, companyId: string, capability: string) {
    const authorized = await this.companyContext.authorize({
      accessToken,
      companyId,
      requiredCapabilities: [capability],
    });
    return {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
  }

  private async canManageCompanyPolicy(accessToken: string, companyId: string): Promise<boolean> {
    const inspected = await this.companyContext.authorizeAvailable({ accessToken, companyId, requestedCapabilities: [POLICY_MANAGE] });
    return inspected.capabilities.includes(POLICY_MANAGE);
  }

  private async authorizeInterpretationAccess(
    accessToken: string,
    companyId: string,
    humanInsightCapabilities: readonly string[],
  ): Promise<InterpretationSubjectAccess> {
    const inspected = await this.companyContext.authorizeAvailable({
      accessToken,
      companyId,
      requestedCapabilities: [AI_USE, ...humanInsightCapabilities, ALERTS_READ, MARKETING_INSIGHTS_READ],
    });
    const capabilities = new Set(inspected.capabilities);
    if (!capabilities.has(AI_USE) || humanInsightCapabilities.some((capability) => !capabilities.has(capability))) {
      throw new ForbiddenException("Basira interpretation access is not permitted.");
    }
    const allowedSubjects: Array<"DECISION_ALERT" | "MARKETING_CAMPAIGN"> = [];
    if (capabilities.has(ALERTS_READ)) allowedSubjects.push("DECISION_ALERT");
    if (capabilities.has(MARKETING_INSIGHTS_READ)) allowedSubjects.push("MARKETING_CAMPAIGN");
    if (!allowedSubjects.length) throw new ForbiddenException("No permitted Basira interpretation source is available.");
    return {
      context: { tenantId: inspected.principal.tenantId, companyId: inspected.company.id, actorUserId: inspected.principal.userId },
      allowedSubjects,
    };
  }

  private async readForContext(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [activeProvider, providerConfigurations, latestProviderConnectionCheck, activeSystemIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({
          where: {
            tenantId: context.tenantId,
            status: AiProviderConfigurationStatus.ACTIVE,
            isDefault: true,
          },
          orderBy: { createdAt: "desc" },
          select: this.providerSelect(),
        }),
        transaction.aiProviderConfiguration.findMany({
          where: { tenantId: context.tenantId },
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
          select: this.providerSelect(),
        }),
        transaction.auditEvent.findFirst({
          where: {
            tenantId: context.tenantId,
            action: "platform.ai.provider_connection_checked",
            entityType: "AiPlatform",
          },
          orderBy: { createdAt: "desc" },
          select: { afterJson: true },
        }),
        transaction.aiSystemIdentity.findFirst({
          where: {
            tenantId: context.tenantId,
            status: AiCompanyIdentityStatus.ACTIVE,
          },
          orderBy: { version: "desc" },
          select: this.systemIdentitySelect(),
        }),
      ]);
      return {
        companyId: context.companyId,
        providerCapabilities: listAiProviderModelCapabilities(),
        activeProvider: activeProvider ? this.providerReceipt(activeProvider) : null,
        providerConfigurations: providerConfigurations.map((provider) => this.providerReceipt(provider)),
        latestProviderConnectionCheck: this.providerConnectionReceiptFromAudit(latestProviderConnectionCheck?.afterJson),
        activeSystemIdentity,
        // Legacy company identity rows are intentionally not exposed or used.
        // Structured AiCompanyContext is the only supported company input.
        activeIdentity: null,
      };
    });
  }

  private async requireProviderConfiguration(
    context: TrustedCompanyActorContext,
    id: string,
  ) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const configuration = await transaction.aiProviderConfiguration.findFirst({
        where: { id, tenantId: context.tenantId },
        select: this.providerSelect(),
      });
      if (!configuration) {
        throw new NotFoundException("The AI provider configuration was not found.");
      }
      return this.providerReceipt(configuration);
    });
  }

  /**
   * A provider key proves only that an account exists. The provider/model
   * pairing must also have a reviewed adapter, local token counter and skill
   * policy in the code-owned registry before it can be persisted or activated.
   */
  private assertConfigurableProviderModel(provider: AiProviderKind, model: string) {
    if (!canConfigureAiProviderModel(provider, model)) {
      throw new ConflictException(
        "The selected AI provider/model is not an approved Basira capability.",
      );
    }
  }

  /** Price revisions are immutable and inserted by a reviewed migration. */
  private async requireCurrentProviderPriceRevision(
    transaction: Prisma.TransactionClient,
    provider: AiProviderKind,
    model: string,
  ) {
    const price = await transaction.aiModelPriceRevision.findFirst({
      where: {
        provider,
        model,
        effectiveFrom: { lte: new Date() },
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
      select: { id: true },
    });
    if (!price) {
      throw new ConflictException(
        "No approved price revision exists for the selected Basira model.",
      );
    }
  }

  private async requireSystemIdentity(
    context: TrustedCompanyActorContext,
    id: string,
  ) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const identity = await transaction.aiSystemIdentity.findFirst({
        where: { id, tenantId: context.tenantId },
        select: this.systemIdentitySelect(),
      });
      if (!identity) {
        throw new NotFoundException("The system AI identity was not found.");
      }
      return identity;
    });
  }

  private async requireIdentity(context: TrustedCompanyActorContext, id: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const identity = await transaction.aiCompanyIdentity.findFirst({
        where: { id, tenantId: context.tenantId, companyId: context.companyId },
        select: this.identitySelect(),
      });
      if (!identity) {
        throw new NotFoundException("The AI company identity was not found.");
      }
      return identity;
    });
  }

  private async requireCompanyContext(context: TrustedCompanyActorContext, id: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const value = await transaction.aiCompanyContext.findFirst({
        where: { id, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, version: true, status: true, kind: true, moduleScope: true, presentationStyle: true, approvedTermsJson: true, policyReferencesJson: true, sourceReference: true, expiresAt: true, revocationReason: true, approvedAt: true, createdAt: true },
      });
      if (!value) throw new NotFoundException("The Basira company context was not found.");
      return value;
    });
  }

  private async requireSkillActivation(context: TrustedCompanyActorContext, id: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const value = await transaction.aiSkillActivation.findFirst({
        where: { id, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, skillKey: true, skillVersion: true, policyVersion: true, status: true, validFrom: true, validUntil: true, dailyRequestLimit: true, dailyCostLimit: true, approvedAt: true, suspendedAt: true, suspensionReason: true, createdAt: true, updatedAt: true },
      });
      if (!value) throw new NotFoundException("The Basira skill activation was not found.");
      return value;
    });
  }

  private async requireSkillEvaluationRun(
    context: TrustedCompanyActorContext,
    id: string,
    replayed: boolean,
  ): Promise<AiSkillEvaluationRunReceipt> {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const value = await transaction.aiSkillEvaluationRun.findFirst({
        where: { id, tenantId: context.tenantId, companyId: context.companyId },
        select: {
          id: true,
          skillKey: true,
          skillVersion: true,
          policyVersion: true,
          suiteKey: true,
          suiteVersion: true,
          suiteChecksum: true,
          mode: true,
          status: true,
          totalCaseCount: true,
          passedCaseCount: true,
          failedCaseCount: true,
          createdAt: true,
        },
      });
      if (!value) throw new NotFoundException("The Basira skill evaluation run was not found.");
      return { ...value, replayed };
    });
  }

  private providerReceipt(value: {
    id: string;
    provider: string;
    model: string;
    status: string;
    isDefault: boolean;
    dailyRequestLimit: number;
    dailyCostLimit: { toString(): string } | null;
    configurationVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...value,
      dailyCostLimit: value.dailyCostLimit?.toString() ?? null,
    };
  }

  private providerSelect() {
    return {
      id: true,
      provider: true,
      model: true,
      status: true,
      isDefault: true,
      dailyRequestLimit: true,
      dailyCostLimit: true,
      configurationVersion: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  /**
   * The provider probe has no ERP payload, but it is still an external request.
   * Store only a typed, safe receipt so a later owner sees the real outcome
   * without repeating probes or exposing a provider error body.
   */
  private async persistProviderConnectionCheck(
    context: TrustedCompanyActorContext,
    receipt: AiProviderConnectionReceipt,
  ): Promise<AiProviderConnectionReceipt> {
    if (!receipt.configurationId) return receipt;
    await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await this.audit(transaction, context, "platform.ai.provider_connection_checked", receipt.configurationId!, {
        configurationId: receipt.configurationId,
        state: receipt.state,
        reason: receipt.reason,
        provider: receipt.provider,
        model: receipt.model,
        upstreamStatus: receipt.upstreamStatus,
        checkedAt: receipt.checkedAt.toISOString(),
      });
    });
    return receipt;
  }

  private providerConnectionReceiptFromAudit(value: Prisma.JsonValue | null | undefined): AiProviderConnectionReceipt | null {
    const parsed = aiProviderConnectionReceiptSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private systemIdentitySelect() {
    return {
      id: true,
      version: true,
      status: true,
      assistantNameAr: true,
      assistantNameEn: true,
      defaultLanguage: true,
      toneInstructions: true,
      safetyInstructions: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private identitySelect() {
    return {
      id: true,
      version: true,
      status: true,
      displayNameAr: true,
      displayNameEn: true,
      defaultLanguage: true,
      toneInstructions: true,
      safetyInstructions: true,
      policyReference: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private async lockTenantProviderConfiguration(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
  ) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-platform-provider:${context.tenantId}`}))`;
  }

  private async lockTenantSystemIdentity(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
  ) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-system-identity:${context.tenantId}`}))`;
  }

  private async lockCompanyIdentity(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
  ) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-company-identity:${context.tenantId}:${context.companyId}`}))`;
  }

  private async lockCompanyPolicyInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
  ) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-company-policy:${context.tenantId}:${context.companyId}`}))`;
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    action: string,
    entityId: string,
    afterJson: Prisma.InputJsonValue,
  ) {
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action,
        entityType: "AiPlatform",
        entityId,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson,
      },
    });
  }
}

export function classifyProviderProbeFailure(error: unknown): Readonly<{
  reason: NonNullable<AiProviderConnectionReceipt["reason"]>;
  upstreamStatus: number | null;
}> {
  // OpenAI SDK subclasses inherit Error's generic `name`; use the runtime
  // class rather than its display name so a failed Node transport is never
  // misreported as an unexplained provider rejection.
  if (error instanceof OpenAI.APIConnectionError) {
    return { reason: "PROVIDER_UNREACHABLE", upstreamStatus: null };
  }
  const value = error as { status?: unknown; name?: unknown; code?: unknown; type?: unknown };
  const upstreamStatus = typeof value?.status === "number" && value.status >= 100 && value.status <= 599
    ? value.status
    : null;
  const code = [value?.code, value?.type].filter((item): item is string => typeof item === "string").join(" ").toLowerCase();
  if (upstreamStatus === 401) return { reason: "CREDENTIAL_REJECTED", upstreamStatus };
  if (upstreamStatus === 402 || (upstreamStatus === 429 && /billing|quota|insufficient/.test(code))) {
    return { reason: "BILLING_OR_QUOTA_REQUIRED", upstreamStatus };
  }
  if (upstreamStatus === 403) return { reason: "PROJECT_ACCESS_DENIED", upstreamStatus };
  if (upstreamStatus === 400 || upstreamStatus === 404) return { reason: "MODEL_UNAVAILABLE", upstreamStatus };
  if (upstreamStatus === 429) return { reason: "PROVIDER_RATE_LIMITED", upstreamStatus };
  if (upstreamStatus !== null && upstreamStatus >= 500) return { reason: "PROVIDER_UNAVAILABLE", upstreamStatus };
  if (value?.name === "APIConnectionError" || value?.name === "APIConnectionTimeoutError") {
    return { reason: "PROVIDER_UNREACHABLE", upstreamStatus };
  }
  return { reason: "PROVIDER_RESPONSE_REJECTED", upstreamStatus };
}
