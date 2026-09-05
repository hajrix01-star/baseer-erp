import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export type EncryptedMarketingGoogleCredential = Readonly<{
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}>;

export type MarketingGoogleCredentialScope = Readonly<{
  tenantId: string;
  companyId: string;
  provider: "GOOGLE_BUSINESS";
}>;

/** Server-only envelope. The caller must never serialize it into an API or audit payload. */
@Injectable()
export class MarketingGoogleCredentialVault {
  encrypt(value: string, scope: MarketingGoogleCredentialScope): EncryptedMarketingGoogleCredential {
    const plaintext = value.trim();
    if (!plaintext) throw new Error("Google credential must not be blank.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(this.aad(scope), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), keyVersion: 1 };
  }

  decrypt(envelope: EncryptedMarketingGoogleCredential, scope: MarketingGoogleCredentialScope): string {
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    if (envelope.keyVersion !== 1 || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new ServiceUnavailableException("Google credential envelope is invalid.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key(), iv);
      decipher.setAAD(Buffer.from(this.aad(scope), "utf8"));
      decipher.setAuthTag(tag);
      const value = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8").trim();
      if (!value) throw new Error("blank");
      return value;
    } catch {
      throw new ServiceUnavailableException("Google credential envelope cannot be decrypted.");
    }
  }

  private aad(scope: MarketingGoogleCredentialScope) {
    return `baseer.marketing-provider-credential.v1:${scope.tenantId}:${scope.companyId}:${scope.provider}`;
  }

  private key() {
    const encoded = process.env.BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY;
    if (!encoded) throw new ServiceUnavailableException("Google credential encryption is not configured.");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) throw new ServiceUnavailableException("Google credential encryption configuration is invalid.");
    return key;
  }
}
