import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";

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
