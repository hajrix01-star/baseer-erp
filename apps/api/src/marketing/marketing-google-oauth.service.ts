import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { MarketingGooglePlatformService } from "./marketing-google-platform.service.js";

@Injectable()
export class MarketingGoogleOAuthService {
  constructor(private readonly database: DatabaseService, private readonly platform: MarketingGooglePlatformService) {}

  async begin(context: TrustedCompanyActorContext, provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS") {
    const config = this.platform.authorizationConfiguration(provider);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await tx.marketingProviderOAuthState.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, provider, initiatedByUserId: context.actorUserId, stateHash: MarketingGooglePlatformService.hash(state), ...this.platform.encryptEphemeral(verifier), expiresAt } });
      await tx.marketingProviderConnection.upsert({ where: { tenantId_companyId_provider: { tenantId: context.tenantId, companyId: context.companyId, provider } }, create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, provider, status: "AUTHORIZING" }, update: { status: "AUTHORIZING" } });
    });
    const scope = provider === "GOOGLE_ADS" ? "https://www.googleapis.com/auth/adwords" : "https://www.googleapis.com/auth/business.manage";
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope, state, code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent", include_granted_scopes: "true" }).toString();
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }
}
