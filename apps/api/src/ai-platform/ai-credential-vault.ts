import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";

export type EncryptedAiCredentialEnvelope = Readonly<{
  encryptedCredential: string;
  credentialIv: string;
  credentialTag: string;
  credentialKeyVersion: number;
}>;

@Injectable()
export class AiCredentialVault {
  encryptApiKey(apiKey: string): EncryptedAiCredentialEnvelope {
    const normalized = apiKey.trim();
    if (!normalized) throw new Error("AI credential must not be blank.");
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(normalized, "utf8"),
      cipher.final(),
    ]);
    return {
      encryptedCredential: encrypted.toString("base64"),
      credentialIv: iv.toString("base64"),
      credentialTag: cipher.getAuthTag().toString("base64"),
      credentialKeyVersion: 1,
    };
  }

  /** Decrypts a provider credential only inside a server-side adapter call. */
  decryptApiKey(envelope: EncryptedAiCredentialEnvelope): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(envelope.credentialIv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.credentialTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.encryptedCredential, "base64")),
      decipher.final(),
    ]).toString("utf8").trim();
    if (!decrypted) throw new Error("AI credential could not be decrypted.");
    return decrypted;
  }

  private key(): Buffer {
    const encoded = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    if (!encoded) {
      throw new Error(
        "AI_CREDENTIAL_ENCRYPTION_KEY must be configured before storing an AI credential.",
      );
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) {
      throw new Error(
        "AI_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte value.",
      );
    }
    return key;
  }
}
