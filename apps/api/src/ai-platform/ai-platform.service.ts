import { randomUUID } from "node:crypto";

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ConfigureAiProviderRequest,
  CreateAiIdentityRequest,
  CreateAiSystemIdentityRequest,
} from "@baseer-erp/contracts";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { IdempotencyService } from "../core-controls/idempotency.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiCompanyIdentityStatus,
  AiProviderConfigurationStatus,
  Prisma,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { AiCredentialVault } from "./ai-credential-vault.js";

const PROVIDER_READ = "platform.ai.configuration.read";
const IDENTITY_READ = "platform.ai.identity.read";
const SYSTEM_IDENTITY_READ = "platform.ai.system_identity.read";
const PROVIDER_WRITE = "platform.ai.configuration.write";
const IDENTITY_WRITE = "platform.ai.identity.write";
const SYSTEM_IDENTITY_WRITE = "platform.ai.system_identity.write";
const PROVIDER_OPERATION = "platform.ai.provider.configure";
const IDENTITY_OPERATION = "platform.ai.identity.create_version";
const SYSTEM_IDENTITY_OPERATION = "platform.ai.system_identity.create_version";

@Injectable()
export class AiPlatformService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
    private readonly vault: AiCredentialVault,
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
    const envelope = this.vault.encryptApiKey(input.apiKey);
    const configurationId = await this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        await this.lockTenantProviderConfiguration(transaction, context);
        const begun = await this.idempotency.beginInTransaction(
          transaction,
          context,
          {
            operation: PROVIDER_OPERATION,
            key: input.idempotencyKey,
            request: {
              provider: input.provider,
              model: input.model,
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

        await transaction.aiProviderConfiguration.updateMany({
          where: {
            tenantId: context.tenantId,
            status: AiProviderConfigurationStatus.ACTIVE,
            isDefault: true,
          },
          data: { isDefault: false },
        });
        const id = randomUUID();
        await transaction.aiProviderConfiguration.create({
          data: {
            id,
            tenantId: context.tenantId,
            provider: input.provider,
            model: input.model.trim(),
            status: AiProviderConfigurationStatus.ACTIVE,
            isDefault: true,
            dailyRequestLimit: input.dailyRequestLimit,
            dailyCostLimit: input.dailyCostLimit ?? null,
            ...envelope,
          },
        });
        await this.audit(transaction, context, "platform.ai.provider_configured", id, {
          provider: input.provider,
          model: input.model.trim(),
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

  async createIdentity(
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

  async authorizeProviderWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, PROVIDER_WRITE);
  }

  async authorizeSystemIdentityWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, SYSTEM_IDENTITY_WRITE);
  }

  async authorizeIdentityWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, IDENTITY_WRITE);
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

  private async readForContext(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [activeProvider, activeSystemIdentity, activeIdentity] = await Promise.all([
        transaction.aiProviderConfiguration.findFirst({
          where: {
            tenantId: context.tenantId,
            status: AiProviderConfigurationStatus.ACTIVE,
            isDefault: true,
          },
          orderBy: { createdAt: "desc" },
          select: this.providerSelect(),
        }),
        transaction.aiSystemIdentity.findFirst({
          where: {
            tenantId: context.tenantId,
            status: AiCompanyIdentityStatus.ACTIVE,
          },
          orderBy: { version: "desc" },
          select: this.systemIdentitySelect(),
        }),
        transaction.aiCompanyIdentity.findFirst({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            status: AiCompanyIdentityStatus.ACTIVE,
          },
          orderBy: { version: "desc" },
          select: this.identitySelect(),
        }),
      ]);
      return {
        companyId: context.companyId,
        activeProvider: activeProvider ? this.providerReceipt(activeProvider) : null,
        activeSystemIdentity,
        activeIdentity,
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

  private providerReceipt(value: {
    id: string;
    provider: string;
    model: string;
    status: string;
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
      dailyRequestLimit: true,
      dailyCostLimit: true,
      configurationVersion: true,
      createdAt: true,
      updatedAt: true,
    } as const;
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