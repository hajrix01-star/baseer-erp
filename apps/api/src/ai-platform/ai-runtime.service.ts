import { randomUUID } from "node:crypto";

import {
  aiRuntimePreflightReceiptSchema,
  type AiRuntimePreflightReceipt,
  type AiRuntimePreflightRequest,
} from "@baseer-erp/contracts";
import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";

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
import { listAiSkills, selectAiSkill } from "./ai-skills.js";

const AI_USE_CAPABILITY = "platform.ai.use";
const PREFLIGHT_OPERATION = "platform.ai.runtime.preflight";

/**
 * Gate B runtime boundary. It authorizes and records a selected skill, but it
 * intentionally does not invoke a provider, expose a prompt or run a tool.
 */
@Injectable()
export class AiRuntimeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
    private readonly adapters: AiProviderAdapterRegistry,
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
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [AI_USE_CAPABILITY],
    });
    const context: TrustedCompanyActorContext = {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
    const skill = selectAiSkill(input.request.moduleKey, input.request.skillKey);
    if (!skill) {
      throw new ForbiddenException("The selected AI skill is not available for this module.");
    }

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

      const [provider, identity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({
          where: {
            tenantId: context.tenantId,
            status: AiProviderConfigurationStatus.ACTIVE,
            isDefault: true,
          },
          select: {
            id: true,
            provider: true,
            model: true,
            configurationVersion: true,
          },
        }),
        transaction.aiCompanyIdentity.findFirst({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            status: AiCompanyIdentityStatus.ACTIVE,
          },
          select: { id: true, version: true },
        }),
      ]);
      const offline = this.adapters.offlineResult(provider?.provider ?? null);
      const safeReasonCode =
        skill.status === "PLANNED"
          ? "AI_SKILL_NOT_ACTIVATED"
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
          moduleKey: input.request.moduleKey,
          capability: AI_USE_CAPABILITY,
          skillKey: skill.key,
          skillVersion: skill.version,
          policyVersion: 1,
          outcome: AiExecutionOutcome.BLOCKED,
          providerSnapshot: provider?.provider ?? null,
          modelSnapshot: provider?.model ?? null,
          configurationVersion: provider?.configurationVersion ?? null,
          identityVersion: identity?.version ?? null,
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
        outcome: offline.outcome,
        safeReasonCode,
        companyId: context.companyId,
        requestId,
        createdAt,
        replayed: false,
      });
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: context.tenantId,
          companyId: context.companyId,
          actorUserId: context.actorUserId,
          action: "platform.ai.runtime_preflight_blocked",
          entityType: "AiExecutionReceipt",
          entityId: receiptId,
          requestId: receipt.requestId,
          afterJson: {
            moduleKey: input.request.moduleKey,
            skillKey: skill.key,
            skillVersion: skill.version,
            riskTier: skill.riskTier,
            status: skill.status,
            safeReasonCode,
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
}