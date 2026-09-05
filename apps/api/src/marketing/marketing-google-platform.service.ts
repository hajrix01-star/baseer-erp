import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";

export type GooglePlatformReadiness = Readonly<{
  ready: boolean;
  missing: readonly string[];
}>;

/**
 * Central, server-only Google configuration.  It is deliberately shared by
 * all companies: a company grants its own OAuth consent later, while this
 * service owns no company credential and never exposes a secret to a client.
 */
@Injectable()
export class MarketingGooglePlatformService {
  /** A fail-closed server allowlist used before any OAuth configuration or state is read. */
  googleBusinessPilotCompanyId(): string {
    const companyId = process.env.BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_COMPANY_ID?.trim() ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
      throw new ForbiddenException("Google Business pilot is not available for this company.");
    }
    return companyId;
  }

  googleBusinessPilotConfiguration() {
    const required = [
      "BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED",
      "BASEER_GOOGLE_OAUTH_ENABLED",
      "BASEER_GOOGLE_OAUTH_CLIENT_ID",
      "BASEER_GOOGLE_OAUTH_CLIENT_SECRET",
      "BASEER_GOOGLE_OAUTH_REDIRECT_URI",
      "BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY",
    ];
    const missing = required.filter((name) => name.endsWith("_ENABLED") ? process.env[name] !== "true" : !process.env[name]?.trim());
    if (missing.length) throw new ServiceUnavailableException("Google Business pilot configuration is incomplete.");
    const redirectUri = process.env.BASEER_GOOGLE_OAUTH_REDIRECT_URI!.trim();
    try { const parsed = new URL(redirectUri); if (parsed.protocol !== "https:") throw new Error("not https"); }
    catch { throw new ServiceUnavailableException("Google Business pilot redirect configuration is invalid."); }
    return {
      clientId: process.env.BASEER_GOOGLE_OAUTH_CLIENT_ID!.trim(),
      clientSecret: process.env.BASEER_GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
      redirectUri,
    };
  }

  /**
   * Safe, read-only capability signal for the company control plane.  The
   * actual authorization endpoint repeats its allowlist and configuration
   * checks; this method must never expose configuration values to a client.
   */
  googleBusinessPilotAuthorizationAvailable(companyId: string): boolean {
    try {
      if (this.googleBusinessPilotCompanyId() !== companyId) return false;
      this.googleBusinessPilotConfiguration();
      return true;
    } catch {
      return false;
    }
  }

  readiness(provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS"): GooglePlatformReadiness {
    const required = [
      "BASEER_GOOGLE_OAUTH_CLIENT_ID",
      "BASEER_GOOGLE_OAUTH_CLIENT_SECRET",
      "BASEER_GOOGLE_OAUTH_REDIRECT_URI",
      "BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY",
      ...(provider === "GOOGLE_ADS" ? ["BASEER_GOOGLE_ADS_DEVELOPER_TOKEN"] : []),
    ];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (process.env.BASEER_GOOGLE_OAUTH_ENABLED !== "true") missing.push("BASEER_GOOGLE_OAUTH_ENABLED");
    return { ready: missing.length === 0, missing };
  }

  authorizationConfiguration(provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS") {
    const readiness = this.readiness(provider);
    if (!readiness.ready) throw new ServiceUnavailableException("Google platform configuration is incomplete.");
    return { clientId: process.env.BASEER_GOOGLE_OAUTH_CLIENT_ID!.trim(), redirectUri: process.env.BASEER_GOOGLE_OAUTH_REDIRECT_URI!.trim() };
  }

  encryptEphemeral(value: string) {
    const key = Buffer.from(process.env.BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY!, "base64");
    if (key.length !== 32) throw new ServiceUnavailableException("Google credential encryption configuration is invalid.");
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { verifierEncrypted: encrypted.toString("base64"), verifierIv: iv.toString("base64"), verifierTag: cipher.getAuthTag().toString("base64") };
  }

  static hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
}
