import { randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type { PutAiCompanyPolicyRequest } from "@baseer-erp/contracts";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { hashCanonicalJson, IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiCompanyPolicyMode,
  AiCompanySkillOverrideState,
  AiProviderConfigurationStatus,
  AiSkillActivationOrigin,
  AiSkillActivationStatus,
  AiSkillEvaluationRunMode,
  AiSkillEvaluationRunStatus,
  Prisma,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { evaluationSuiteForAiSkill, runOfflineAiSkillEvaluation } from "./ai-skill-evaluation-suites.js";
import { AI_SKILL_CATALOG, runtimeAvailabilityForAiSkill } from "./ai-skills.js";

export type AiCompanyPolicyLiveSnapshot = Readonly<{
  policyRevisionId: string;
  policyVersion: number;
  monthlyBudgetUsdCents: Prisma.Decimal;
  activation: { id: string; dailyRequestLimit: number | null; dailyCostLimit: Prisma.Decimal | null; origin: AiSkillActivationOrigin };
}>;

const POLICY_OPERATION = "platform.ai.company_policy.put";

/** Central company policy boundary. It owns automatic enrolment but never
 * authorises a provider credential, a business source, or an external action. */
@Injectable()
export class AiCompanyPolicyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async read(context: TrustedCompanyActorContext, canManage: boolean) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const policy = await transaction.aiCompanyPolicy.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        include: { revisions: { where: { version: { gt: 0 } }, orderBy: { version: "desc" }, take: 1, include: { providerAllowlists: true, pilotAllowlists: true } } },
      });
      const revision = policy?.revisions[0] ?? null;
      return {
        companyId: context.companyId,
        policyId: policy?.id ?? null,
        version: revision?.version ?? 0,
        mode: revision?.mode ?? AiCompanyPolicyMode.DISABLED,
        monthlyBudgetUsdCents: revision?.monthlyBudgetUsdCents?.toString() ?? null,
        billingTimeZone: "Asia/Riyadh" as const,
        providerConfigurationIds: revision?.providerAllowlists.map((item) => item.providerConfigurationId) ?? [],
        pilotSkills: revision?.pilotAllowlists.map((item) => ({ skillKey: item.skillKey, skillVersion: item.skillVersion, policyVersion: item.policyVersion })) ?? [],
        autoEnrollStable: revision?.autoEnrollStable ?? false,
        canManage,
        updatedAt: policy?.updatedAt ?? null,
      };
    });
  }

  async put(context: TrustedCompanyActorContext, input: PutAiCompanyPolicyRequest) {
    await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await this.lockPolicy(transaction, context);
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: POLICY_OPERATION,
        key: input.idempotencyKey,
        request: input as never,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return { policyId: (begun.response.body as { policyId: string }).policyId, replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The Basira company-policy update is still in progress.");

      const current = await transaction.aiCompanyPolicy.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      });
      const currentVersion = current?.revisions[0]?.version ?? 0;
      if (input.expectedVersion !== currentVersion) throw new ConflictException("The Basira company policy changed. Refresh it before saving.");

      const allowlistedProviders = await transaction.aiProviderConfiguration.findMany({
        where: { id: { in: input.providerConfigurationIds }, tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE },
        select: { id: true, provider: true, model: true },
      });
      if (input.mode === "ENABLED" && allowlistedProviders.length !== input.providerConfigurationIds.length) {
        throw new ConflictException("Every Basira provider chosen by this company must be active and approved for the tenant.");
      }
      const id = current?.id ?? randomUUID();
      const version = currentVersion + 1;
      if (!current) await transaction.aiCompanyPolicy.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, currentVersion: 0 } });
      const digest = hashCanonicalJson({ mode: input.mode, monthlyBudgetUsdCents: input.monthlyBudgetUsdCents ?? null, providerConfigurationIds: [...input.providerConfigurationIds].sort(), pilotSkills: [...input.pilotSkills].sort((a, b) => a.skillKey.localeCompare(b.skillKey)), autoEnrollStable: input.autoEnrollStable } as never);
      const revisionId = randomUUID();
      await transaction.aiCompanyPolicyRevision.create({
        data: {
          id: revisionId, tenantId: context.tenantId, companyId: context.companyId, policyId: id, version,
          mode: input.mode, monthlyBudgetUsdCents: input.mode === "ENABLED" ? new Prisma.Decimal(input.monthlyBudgetUsdCents!) : null,
          billingTimeZone: "Asia/Riyadh", autoEnrollStable: input.autoEnrollStable, changedByUserId: context.actorUserId,
          changeReason: input.changeReason, policyDigest: digest,
          providerAllowlists: { create: allowlistedProviders.map((provider) => ({ id: randomUUID(), providerConfigurationId: provider.id, providerSnapshot: provider.provider, modelSnapshot: provider.model })) },
          pilotAllowlists: { create: input.pilotSkills.map((skill) => ({ id: randomUUID(), skillKey: skill.skillKey, skillVersion: skill.skillVersion, policyVersion: skill.policyVersion })) },
        },
      });
      await transaction.aiCompanyPolicy.update({ where: { id }, data: { currentVersion: version, updatedAt: new Date() } });
      await this.reconcileInTransaction(transaction, context, revisionId, input.mode, input.pilotSkills, input.autoEnrollStable);
      await this.audit(transaction, context, "platform.ai.company_policy_changed", revisionId, { version, mode: input.mode, providerConfigurationCount: allowlistedProviders.length, pilotSkillCount: input.pilotSkills.length });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: { policyId: id } } });
      return { policyId: id, replayed: false };
    });
    // The public receipt deliberately does not expose idempotency internals.
    // A replay resolves to the same current policy view as the first write.
    return this.read(context, true);
  }

  async requireLivePolicy(
    context: TrustedCompanyActorContext,
    input: { skillKey: string; skillVersion: number; policyVersion: number; catalogueStatus: "PILOT" | "ACTIVE" | "PLANNED" | "VALIDATED" | "SUSPENDED"; provider: { id: string; provider: string; model: string } },
  ): Promise<AiCompanyPolicyLiveSnapshot | null> {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const policy = await transaction.aiCompanyPolicy.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        include: { revisions: { orderBy: { version: "desc" }, take: 1, include: { providerAllowlists: true, pilotAllowlists: true } } },
      });
      const revision = policy?.revisions[0];
      if (!revision) return null; // Legacy company: existing activation path remains intact until opt-in.
      if (revision.mode !== AiCompanyPolicyMode.ENABLED) throw new ForbiddenException("Basira is paused for this company.");
      const providerAllowed = revision.providerAllowlists.some((item) => item.providerConfigurationId === input.provider.id && item.providerSnapshot === input.provider.provider && item.modelSnapshot === input.provider.model);
      if (!providerAllowed) throw new ForbiddenException("The active AI provider is not approved by this company Basira policy.");
      const override = await transaction.aiCompanySkillOverride.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, skillKey: input.skillKey, state: AiCompanySkillOverrideState.BLOCKED }, select: { id: true } });
      if (override) throw new ForbiddenException("This Basira capability is paused for the active company.");
      const expectedStatus = input.catalogueStatus === "ACTIVE" ? AiSkillActivationStatus.ACTIVE : AiSkillActivationStatus.PILOT;
      if (input.catalogueStatus === "PILOT") {
        const pilotAllowed = revision.pilotAllowlists.some((item) => item.skillKey === input.skillKey && item.skillVersion === input.skillVersion && item.policyVersion === input.policyVersion);
        if (!pilotAllowed) throw new ForbiddenException("This Basira pilot was not enabled for the active company.");
      }
      const activation = await transaction.aiSkillActivation.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, skillKey: input.skillKey, skillVersion: input.skillVersion, policyVersion: input.policyVersion, status: expectedStatus, validFrom: { lte: new Date() }, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
        select: { id: true, dailyRequestLimit: true, dailyCostLimit: true, origin: true },
      });
      if (!activation) throw new ForbiddenException("This Basira capability is not ready for the active company.");
      if (!revision.monthlyBudgetUsdCents) throw new ForbiddenException("The company Basira monthly limit is unavailable.");
      return { policyRevisionId: revision.id, policyVersion: revision.version, monthlyBudgetUsdCents: revision.monthlyBudgetUsdCents, activation };
    });
  }

  /** Invoked by the scheduler so newly released, READY stable catalogue skills
   * join opted-in company policies without requiring an administrator to save
   * the policy again. It never enrolls pilots beyond their explicit allowlist. */
  async reconcileAutomaticEnrollmentsForTenant(tenantId: string): Promise<{ reconciledPolicies: number }> {
    return this.database.inTenantTransaction(tenantId, async (transaction) => {
      const policies = await transaction.aiCompanyPolicy.findMany({
        where: { tenantId },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      });
      let reconciledPolicies = 0;
      for (const candidate of policies) {
        const revision = candidate.revisions[0];
        if (!revision || candidate.currentVersion !== revision.version || revision.mode !== AiCompanyPolicyMode.ENABLED || !revision.autoEnrollStable) continue;
        const context: TrustedCompanyActorContext = { tenantId, companyId: candidate.companyId, actorUserId: revision.changedByUserId };
        await this.lockPolicy(transaction, context);
        const current = await transaction.aiCompanyPolicy.findFirst({
          where: { id: candidate.id, tenantId, companyId: candidate.companyId },
          include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        });
        const currentRevision = current?.revisions[0];
        if (!currentRevision || current?.currentVersion !== currentRevision.version || currentRevision.mode !== AiCompanyPolicyMode.ENABLED || !currentRevision.autoEnrollStable) continue;
        const pilots = await transaction.aiCompanyPolicyPilotAllowlist.findMany({
          where: { policyRevisionId: currentRevision.id, tenantId, companyId: candidate.companyId },
          select: { skillKey: true, skillVersion: true, policyVersion: true },
        });
        await this.reconcileInTransaction(transaction, context, currentRevision.id, currentRevision.mode, pilots, true);
        reconciledPolicies += 1;
      }
      return { reconciledPolicies };
    });
  }

  private async reconcileInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    revisionId: string,
    mode: AiCompanyPolicyMode,
    pilots: readonly { skillKey: string; skillVersion: number; policyVersion: number }[],
    autoEnrollStable: boolean,
  ) {
    if (mode !== AiCompanyPolicyMode.ENABLED) return;
    const configuredSkills = [
      ...pilots,
      ...(autoEnrollStable
        ? AI_SKILL_CATALOG.filter((skill) => skill.status === "ACTIVE").map((skill) => ({ skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion }))
        : []),
    ];
    for (const item of configuredSkills) {
      const skill = AI_SKILL_CATALOG.find((candidate) => candidate.key === item.skillKey && candidate.version === item.skillVersion && candidate.policyVersion === item.policyVersion);
      if (!skill || (skill.status !== "PILOT" && skill.status !== "ACTIVE") || runtimeAvailabilityForAiSkill(skill.key).state !== "READY") continue;
      const evaluation = runOfflineAiSkillEvaluation(skill);
      const suite = evaluationSuiteForAiSkill(skill.key, skill.version, skill.policyVersion);
      if (!suite || !evaluation.passed) continue;
      const passed = await transaction.aiSkillEvaluationRun.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, suiteKey: suite.key, suiteVersion: suite.version, suiteChecksum: evaluation.suiteChecksum, mode: AiSkillEvaluationRunMode.OFFLINE, status: AiSkillEvaluationRunStatus.PASSED }, select: { id: true } });
      if (!passed) {
        await transaction.aiSkillEvaluationRun.create({
          data: {
            id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
            skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion,
            suiteKey: suite.key, suiteVersion: suite.version, suiteChecksum: evaluation.suiteChecksum,
            mode: AiSkillEvaluationRunMode.OFFLINE, status: AiSkillEvaluationRunStatus.PASSED,
            totalCaseCount: evaluation.totalCaseCount, passedCaseCount: evaluation.passedCaseCount,
            failedCaseCount: evaluation.failedCaseCount,
            resultSummaryJson: { source: "company_policy", cases: evaluation.results },
            createdByUserId: context.actorUserId,
          },
        });
      }
      const blocked = await transaction.aiCompanySkillOverride.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, skillKey: skill.key, state: AiCompanySkillOverrideState.BLOCKED }, select: { id: true } });
      if (blocked) continue;
      await transaction.aiSkillActivation.upsert({
        where: { companyId_skillKey_skillVersion_policyVersion: { companyId: context.companyId, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion } },
        create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, status: skill.status === "ACTIVE" ? AiSkillActivationStatus.ACTIVE : AiSkillActivationStatus.PILOT, dailyRequestLimit: null, dailyCostLimit: null, approvedByUserId: context.actorUserId, origin: AiSkillActivationOrigin.COMPANY_POLICY, companyPolicyRevisionId: revisionId },
        update: {},
      });
    }
  }

  private async lockPolicy(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-company-policy:${context.tenantId}:${context.companyId}`}))`;
  }

  private async audit(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, afterJson: Prisma.InputJsonValue) {
    await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: "AiCompanyPolicy", entityId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson } });
  }
}
