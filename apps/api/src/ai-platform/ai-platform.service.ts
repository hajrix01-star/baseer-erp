import { randomUUID } from "node:crypto";

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AiProviderConnectionReceipt,
  ActivateAiProviderConfigurationRequest,
  ConfigureAiProviderRequest,
  CreateAiIdentityRequest,
  CreateAiSystemIdentityRequest,
} from "@baseer-erp/contracts";

import { TenantAdministrationContextService } from "../administration/tenant-administration-context.service.js";
import { CompanyContextService } from "../company-context/company-context.service.js";
import { IdempotencyService } from "../core-controls/idempotency.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  AiCompanyIdentityStatus,
  AiProviderConfigurationStatus,
  CompanyStatus,
  Prisma,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { AiCredentialVault } from "./ai-credential-vault.js";
import { AiProviderAdapterRegistry } from "./ai-provider-adapter-registry.js";

const PROVIDER_READ = "platform.ai.configuration.read";
const IDENTITY_READ = "platform.ai.identity.read";
const SYSTEM_IDENTITY_READ = "platform.ai.system_identity.read";
const PROVIDER_WRITE = "platform.ai.configuration.write";
const IDENTITY_WRITE = "platform.ai.identity.write";
const SYSTEM_IDENTITY_WRITE = "platform.ai.system_identity.write";
const PROVIDER_OPERATION = "platform.ai.provider.configure";
const PROVIDER_ACTIVATE_OPERATION = "platform.ai.provider.activate";
const IDENTITY_OPERATION = "platform.ai.identity.create_version";
const SYSTEM_IDENTITY_OPERATION = "platform.ai.system_identity.create_version";

@Injectable()
export class AiPlatformService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
    private readonly vault: AiCredentialVault,
    private readonly tenantAdministration: TenantAdministrationContextService,
    private readonly adapters: AiProviderAdapterRegistry,
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
          where: { id: configurationId, tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE },
          select: { id: true, provider: true, model: true },
        });
        if (!configuration) throw new NotFoundException("The AI provider configuration was not found.");
        if (configuration.provider !== "OPENAI_COMPATIBLE") {
          throw new ConflictException("This AI provider is not implemented yet and cannot be activated.");
        }
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
        await transaction.aiProviderConfiguration.update({ where: { id: configuration.id }, data: { isDefault: true } });
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
            status: AiProviderConfigurationStatus.ACTIVE,
            isDefault: true,
          },
          orderBy: { createdAt: "desc" },
          select: {
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
        state: "UNCONFIGURED",
        reason: "PROVIDER_NOT_CONFIGURED",
        provider: null,
        model: null,
        checkedAt,
      };
    }

    let apiKey: string;
    try {
      apiKey = this.vault.decryptApiKey(provider);
    } catch {
      return {
        state: "ERROR",
        reason: "CREDENTIAL_DECRYPTION_FAILED",
        provider: provider.provider,
        model: provider.model,
        checkedAt,
      };
    }
    try {
      await this.adapters.probeOpenAiProvider({ apiKey, model: provider.model });
      return {
        state: "READY",
        reason: null,
        provider: provider.provider,
        model: provider.model,
        checkedAt,
      };
    } catch (error) {
      return {
        state: "ERROR",
        reason: providerProbeFailureReason(error),
        provider: provider.provider,
        model: provider.model,
        checkedAt,
      };
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
    return this.authorizeTenantOwner(accessToken, companyId);
  }

  async authorizeSystemIdentityWrite(accessToken: string, companyId: string) {
    return this.authorizeTenantOwner(accessToken, companyId);
  }

  async authorizeIdentityWrite(accessToken: string, companyId: string) {
    return this.authorize(accessToken, companyId, IDENTITY_WRITE);
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

  private async readForContext(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [activeProvider, providerConfigurations, activeSystemIdentity, activeIdentity] = await Promise.all([
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
          where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE },
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
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
        providerConfigurations: providerConfigurations.map((provider) => this.providerReceipt(provider)),
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

function providerProbeFailureReason(error: unknown): AiProviderConnectionReceipt["reason"] {
  const value = error as { status?: unknown; name?: unknown };
  if (value?.status === 401) return "CREDENTIAL_REJECTED";
  if (value?.status === 404) return "MODEL_UNAVAILABLE";
  if (value?.status === 429) return "PROVIDER_RATE_LIMITED";
  if (value?.name === "APIConnectionError" || value?.name === "APIConnectionTimeoutError") {
    return "PROVIDER_UNREACHABLE";
  }
  return "PROVIDER_UNAVAILABLE";
}
