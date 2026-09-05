import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export type EncryptedAiCredentialEnvelope = Readonly<{
  encryptedCredential: string;
  credentialIv: string;
  credentialTag: string;
  credentialKeyVersion: number;
}>;

/**
 * Durable AI outputs use a distinct envelope from provider credentials. This
 * prevents callers from treating a model answer as a credential and makes the
 * storage purpose explicit in the schema and audit review.
 */
export type EncryptedAiOutputEnvelope = Readonly<{
  encryptedOutput: string;
  outputIv: string;
  outputTag: string;
  outputKeyVersion: number;
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

  encryptOutput(value: unknown, associatedData: string): EncryptedAiOutputEnvelope {
    const plaintext = JSON.stringify(value);
    if (!plaintext || plaintext === "undefined") {
      throw new Error("AI output must be serializable JSON.");
    }
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      encryptedOutput: encrypted.toString("base64"),
      outputIv: iv.toString("base64"),
      outputTag: cipher.getAuthTag().toString("base64"),
      outputKeyVersion: 1,
    };
  }

  decryptOutput<T>(envelope: EncryptedAiOutputEnvelope, associatedData: string): T {
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(envelope.outputIv, "base64"));
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.outputTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.encryptedOutput, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  }

  private key(): Buffer {
    const encoded = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    if (!encoded) {
      throw new ServiceUnavailableException(
        "AI_CREDENTIAL_ENCRYPTION_KEY must be configured before storing an AI credential.",
      );
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw new ServiceUnavailableException(
        "AI_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte value.",
      );
    }
    return key;
  }
}
