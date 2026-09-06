import { BadGatewayException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { MarketingGoogleCredentialVault } from "./marketing-google-credential-vault.js";
import { MarketingGooglePlatformService } from "./marketing-google-platform.service.js";
import { MarketingGoogleBusinessResourceSelectionService } from "./marketing-google-business-resource-selection.service.js";

const GOOGLE_BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";
const CALLBACK_TTL_MS = 10 * 60_000;

type CallbackQuery = Readonly<{ state: string | undefined; code: string | undefined; error: string | undefined }>;
type ClaimedState = Readonly<{
  id: string;
  tenantId: string;
  companyId: string;
  connectionId: string;
  initiatedByUserId: string;
  verifierEncrypted: string;
  verifierIv: string;
  verifierTag: string;
}>;

/**
 * A deliberately narrow MKT-02A boundary. Generic Google authorization stays
 * hard-off; only the ARZ Google Business pilot can reach this service.
 */
@Injectable()
export class MarketingGoogleBusinessOAuthPilotService {
  constructor(
    private readonly database: DatabaseService,
    private readonly platform: MarketingGooglePlatformService,
    private readonly vault: MarketingGoogleCredentialVault,
    private readonly resourceSelection: MarketingGoogleBusinessResourceSelectionService,
  ) {}

  async begin(context: TrustedCompanyActorContext) {
    this.requirePilotCompany(context.companyId);
    const config = this.platform.googleBusinessPilotConfiguration();
    const stateSecret = randomBytes(32).toString("base64url");
    const state = `${context.tenantId}.${stateSecret}`;
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const expiresAt = new Date(Date.now() + CALLBACK_TTL_MS);
    const encrypted = this.vault.encrypt(verifier, { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" });

    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.lockCompanyPilot(tx, context.tenantId, context.companyId);
      const now = new Date();
      const existing = await tx.marketingProviderConnection.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" },
        select: { id: true },
      });
      const connection = existing
        ? await tx.marketingProviderConnection.update({ where: { id: existing.id }, data: { status: "AUTHORIZING" } })
        : await tx.marketingProviderConnection.create({
          data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: "AUTHORIZING" },
        });
      await tx.marketingGoogleBusinessOAuthState.updateMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.marketingGoogleBusinessOAuthState.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, connectionId: connection.id,
          provider: "GOOGLE_BUSINESS", initiatedByUserId: context.actorUserId, stateHash: this.hash(state),
          verifierEncrypted: encrypted.ciphertext, verifierIv: encrypted.iv, verifierTag: encrypted.tag, expiresAt,
        },
      });
      await this.audit(tx, context, "marketing.google_business_pilot.authorization_started", connection.id, { status: "AUTHORIZING", expiresAt: expiresAt.toISOString() });
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: GOOGLE_BUSINESS_SCOPE,
      state, code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent", include_granted_scopes: "true",
    }).toString();
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  /**
   * Local credential removal only. Google is not called here: removing the
   * sealed refresh credential and selected resource is immediate, while Google
   * account-consent remains controlled by the account owner at Google.
   */
  async disconnect(context: TrustedCompanyActorContext) {
    this.requirePilotCompany(context.companyId);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.lockCompanyPilot(tx, context.tenantId, context.companyId);
      const connection = await tx.marketingProviderConnection.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" },
        select: { id: true },
      });
      if (!connection) return { status: "NOT_CONNECTED" as const };
      const now = new Date();
      await tx.marketingGoogleBusinessOAuthState.updateMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", consumedAt: null },
        data: { consumedAt: now },
      });
      // Provider facts and sync receipts belong to the selected resource. They
      // must leave Baseer together with a local disconnect, before its mapping
      // can be removed. No Google delete or reply operation is performed.
      const reviewFacts = await tx.marketingGoogleBusinessReviewFact.deleteMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
      });
      const syncRuns = await tx.marketingProviderSyncRun.deleteMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" },
      });
      const mappings = await tx.marketingGoogleBusinessLocationMapping.deleteMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, connectionId: connection.id, provider: "GOOGLE_BUSINESS" },
      });
      const credentials = await tx.marketingProviderCredentialEnvelope.deleteMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, connectionId: connection.id, provider: "GOOGLE_BUSINESS" },
      });
      await tx.marketingProviderConnection.update({
        where: { id: connection.id },
        data: { status: "NOT_CONNECTED", setupRequestedAt: null, setupRequestedByUserId: null },
      });
      await this.audit(tx, context, "marketing.google_business_pilot.disconnected", connection.id, {
        status: "NOT_CONNECTED", credentialDeleted: String(credentials.count > 0), locationMappingDeleted: String(mappings.count > 0), reviewFactsDeleted: String(reviewFacts.count), syncRunsDeleted: String(syncRuns.count),
      });
      return { status: "NOT_CONNECTED" as const };
    });
  }

  async complete(query: CallbackQuery): Promise<"AUTHORIZED" | "BLOCKED"> {
    const state = this.validateState(query.state);
    const claimed = await this.claim(state);
    if (!claimed) throw new ForbiddenException("Google Business authorization was not completed.");
    if (query.error || !query.code) {
      await this.block(claimed, "GOOGLE_OAUTH_DENIED");
      return "BLOCKED";
    }

    try {
      // This is intentionally repeated after the atomic state claim and directly
      // before egress. Disabling the pilot cannot leave a path to token exchange.
      this.requirePilotCompany(claimed.companyId);
      const config = this.platform.googleBusinessPilotConfiguration();
      const verifier = this.vault.decrypt({ ciphertext: claimed.verifierEncrypted, iv: claimed.verifierIv, tag: claimed.verifierTag, keyVersion: 1 }, {
        tenantId: claimed.tenantId, companyId: claimed.companyId, provider: "GOOGLE_BUSINESS",
      });
      const refreshToken = await this.exchangeCode(config, query.code, verifier);
      const encrypted = this.vault.encrypt(JSON.stringify({ kind: "google-business-refresh-token.v1", refreshToken }), {
        tenantId: claimed.tenantId, companyId: claimed.companyId, provider: "GOOGLE_BUSINESS",
      });
      const persisted = await this.database.inTenantTransaction(claimed.tenantId, async (tx) => {
        await this.lockCompanyPilot(tx, claimed.tenantId, claimed.companyId);
        // `begin` consumes every preceding state while holding this same lock.
        // A callback may have already claimed an older state before a new consent
        // journey starts, so status AUTHORIZING alone is not a sufficient fence.
        // Only the most recently created authorization state may persist or alter
        // this connection's credential lifecycle.
        const latest = await tx.marketingGoogleBusinessOAuthState.findFirst({
          where: {
            tenantId: claimed.tenantId,
            companyId: claimed.companyId,
            connectionId: claimed.connectionId,
            provider: "GOOGLE_BUSINESS",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (latest?.id !== claimed.id) return false;
        const current = await tx.marketingProviderConnection.updateMany({
          where: { id: claimed.connectionId, tenantId: claimed.tenantId, companyId: claimed.companyId, provider: "GOOGLE_BUSINESS", status: "AUTHORIZING" },
          data: { status: "AUTHORIZED_AWAITING_SELECTION" },
        });
        if (current.count !== 1) return false;
        await tx.marketingProviderCredentialEnvelope.upsert({
          where: { connectionId_tenantId_companyId_provider: { connectionId: claimed.connectionId, tenantId: claimed.tenantId, companyId: claimed.companyId, provider: "GOOGLE_BUSINESS" } },
          create: { id: randomUUID(), tenantId: claimed.tenantId, companyId: claimed.companyId, connectionId: claimed.connectionId, provider: "GOOGLE_BUSINESS", ...encrypted, status: "ACTIVE", revokedAt: null },
          update: { ...encrypted, status: "ACTIVE", revokedAt: null },
        });
        await this.audit(tx, claimed, "marketing.google_business_pilot.authorized", claimed.connectionId, { status: "AUTHORIZED_AWAITING_SELECTION" });
        return true;
      });
      if (!persisted) return "BLOCKED";
      // A consent callback is the only user action after Google. Complete the
      // company mapping only for an unambiguous resource; discovery failure or
      // plurality must preserve authorized consent rather than revoke it.
      try {
        await this.resourceSelection.selectOnlyAvailableResource({ tenantId: claimed.tenantId, companyId: claimed.companyId, actorUserId: claimed.initiatedByUserId });
      } catch {
        // The authorized credential remains safely stored. The public status
        // stays awaiting selection until an administrator resolves ambiguity.
      }
      return "AUTHORIZED";
    } catch {
      await this.block(claimed, "GOOGLE_OAUTH_EXCHANGE_FAILED");
      return "BLOCKED";
    }
  }

  private requirePilotCompany(companyId: string) {
    if (this.platform.googleBusinessPilotCompanyId() !== companyId) throw new ForbiddenException("Google Business pilot is not available for this company.");
  }

  private validateState(value: string | undefined) {
    const [tenantId, secret, ...rest] = (value ?? "").split(".");
    if (!tenantId || !secret || rest.length || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
      throw new ForbiddenException("Google Business authorization was not completed.");
    }
    return { tenantId, raw: `${tenantId}.${secret}` };
  }

  private async claim(state: { tenantId: string; raw: string }): Promise<ClaimedState | null> {
    return this.database.inTenantTransaction(state.tenantId, async (tx) => {
      const now = new Date();
      const saved = await tx.marketingGoogleBusinessOAuthState.findFirst({
        where: { tenantId: state.tenantId, stateHash: this.hash(state.raw), consumedAt: null, expiresAt: { gt: now } },
      });
      if (!saved) return null;
      const updated = await tx.marketingGoogleBusinessOAuthState.updateMany({
        where: { id: saved.id, tenantId: state.tenantId, stateHash: this.hash(state.raw), consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      return updated.count === 1 ? saved : null;
    });
  }

  private async exchangeCode(config: ReturnType<MarketingGooglePlatformService["googleBusinessPilotConfiguration"]>, code: string, verifier: string): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
    });
    const body = await response.json().catch(() => ({})) as { refresh_token?: unknown };
    if (!response.ok || typeof body.refresh_token !== "string" || !body.refresh_token.trim()) throw new BadGatewayException("Google Business authorization was not completed.");
    return body.refresh_token.trim();
  }

  private async block(state: ClaimedState, safeCode: string) {
    await this.database.inTenantTransaction(state.tenantId, async (tx) => {
      await this.lockCompanyPilot(tx, state.tenantId, state.companyId);
      // Do not let an old denied/failed callback block a later authorization
      // that has already replaced it.
      const latest = await tx.marketingGoogleBusinessOAuthState.findFirst({
        where: {
          tenantId: state.tenantId,
          companyId: state.companyId,
          connectionId: state.connectionId,
          provider: "GOOGLE_BUSINESS",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latest?.id !== state.id) return;
      const current = await tx.marketingProviderConnection.updateMany({
        where: { id: state.connectionId, tenantId: state.tenantId, companyId: state.companyId, provider: "GOOGLE_BUSINESS", status: "AUTHORIZING" },
        data: { status: "BLOCKED" },
      });
      if (current.count !== 1) return;
      await tx.marketingProviderCredentialEnvelope.updateMany({
        where: { connectionId: state.connectionId, tenantId: state.tenantId, companyId: state.companyId, provider: "GOOGLE_BUSINESS", status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      await this.audit(tx, state, "marketing.google_business_pilot.blocked", state.connectionId, { status: "BLOCKED", safeCode });
    });
  }

  private async lockCompanyPilot(tx: Prisma.TransactionClient, tenantId: string, companyId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-google-business-pilot:${tenantId}:${companyId}`}, 0))`;
  }

  private async audit(tx: Prisma.TransactionClient, context: Pick<ClaimedState, "tenantId" | "companyId" | "initiatedByUserId"> | TrustedCompanyActorContext, action: string, entityId: string, afterJson: Record<string, string>) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: "actorUserId" in context ? context.actorUserId : context.initiatedByUserId, action, entityType: "MarketingProviderConnection", entityId, requestId: randomUUID(), beforeJson: Prisma.JsonNull, afterJson } });
  }

  private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
}
