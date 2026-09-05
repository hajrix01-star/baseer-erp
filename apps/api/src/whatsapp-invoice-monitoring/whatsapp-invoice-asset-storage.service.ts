import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { Prisma } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";

const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const STORAGE_KIND = "ORIGINAL";

export type WhatsappInvoiceAssetContent = Readonly<{
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  fileName: string;
}>;

type AssetMetadata = Readonly<{
  id: string; tenantId: string; companyId: string; originalFileName: string; actualMimeType: string | null;
  storageState: "PENDING" | "READY" | "QUARANTINED" | "FAILED"; storageReference: string | null;
  encryptionIv: string | null; encryptionKeyVersion: number | null; storedByteSize: bigint | null;
  sha256: string | null; byteSize: bigint | null; scanStatus: "NOT_REQUESTED" | "PENDING" | "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED";
}>;

/**
 * Private receipt storage boundary. Callers must already have received bytes
 * through a trusted internal source; this class deliberately exposes neither
 * a public upload nor a storage URL. With no scanner registered, stored bytes
 * remain QUARANTINED and cannot be streamed.
 */
@Injectable()
export class WhatsappInvoiceAssetStorageService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Read-only preflight for the live connector. A receiver must never pair a
   * personal WhatsApp account when it cannot immediately retain every allowed
   * receipt privately and send it through the configured scanner boundary.
   */
  assertIngestionReady(): void {
    if (process.env.BASEER_WAI_ASSET_STORAGE_ENABLED !== "true") {
      throw new ServiceUnavailableException("WhatsApp invoice private asset storage is disabled.");
    }
    this.configuration();
    const endpoint = process.env.BASEER_DOCUMENT_SCANNER_ENDPOINT?.trim();
    if (!endpoint) throw new ServiceUnavailableException("WhatsApp invoice document scanning is not configured.");
    try {
      const url = new URL(endpoint);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) throw new Error("unsafe-scanner-url");
    } catch {
      throw new ServiceUnavailableException("WhatsApp invoice document scanning is not configured.");
    }
  }

  async storeTrustedOriginal(input: Readonly<{ context: TrustedCompanyActorContext; assetId: string; bytes: Buffer }>): Promise<Readonly<{ assetId: string; storageState: "READY" | "QUARANTINED"; scanStatus: "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED" }>> {
    const detectedMimeType = this.detectMimeType(input.bytes);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const configuration = this.configuration();

    try {
      const asset = await this.loadMetadata(input.context, input.assetId);
      if (asset.storageReference || asset.encryptionIv || asset.encryptionKeyVersion || asset.storedByteSize !== null) {
        await this.assertExistingArtifactMatches(asset, input.bytes, sha256, configuration);
        if (asset.storageState === "READY") throw new ConflictException("A cleared asset cannot be replaced.");
        return this.scanAndRecord(input.context, asset.id, input.bytes);
      }

      const reference = this.reference(asset.tenantId, asset.companyId, asset.id);
      const iv = randomBytes(12);
      const ciphertext = this.encrypt(input.bytes, iv, asset.tenantId, asset.companyId, asset.id, configuration);
      await this.writeOnce(reference, ciphertext);
      const stored = await this.database.inTenantTransaction(input.context.tenantId, async (tx) => tx.whatsappInvoiceAsset.updateMany({
        where: { id: asset.id, tenantId: input.context.tenantId, companyId: input.context.companyId, storageReference: null, storageState: "PENDING" },
        data: {
          byteSize: BigInt(input.bytes.byteLength), sha256, actualMimeType: detectedMimeType,
          storageReference: reference, encryptionIv: iv.toString("base64"), encryptionKeyVersion: configuration.keyVersion,
          storedByteSize: BigInt(input.bytes.byteLength), storageState: "QUARANTINED", scanStatus: "UNAVAILABLE",
          scannedAt: null, storageFailureReason: null,
        },
      }));
      if (stored.count === 0) {
        const latest = await this.loadMetadata(input.context, asset.id);
        await this.assertExistingArtifactMatches(latest, input.bytes, sha256, configuration);
        if (latest.storageState === "READY") throw new ConflictException("A cleared asset cannot be replaced.");
        return this.scanAndRecord(input.context, asset.id, input.bytes);
      }
      return this.scanAndRecord(input.context, asset.id, input.bytes);
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof ConflictException || error instanceof NotFoundException) throw error;
      await this.markFailed(input.context, input.assetId, error);
      throw error;
    }
  }

  /**
   * Internal-only scanner callback. There is intentionally no HTTP route for
   * it in this slice. READY is reachable only from a supplied CLEAN result.
   */
  async recordTrustedScan(input: Readonly<{ context: TrustedCompanyActorContext; assetId: string; scannerReference: string; outcome: "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED" }>): Promise<void> {
    if (!/^[A-Za-z0-9._:-]{3,200}$/.test(input.scannerReference)) throw new ConflictException("The scanner receipt reference is invalid.");
    await this.database.inTenantTransaction(input.context.tenantId, async (tx) => {
      const asset = await tx.whatsappInvoiceAsset.findFirst({ where: { id: input.assetId, tenantId: input.context.tenantId, companyId: input.context.companyId }, select: { id: true, storageReference: true, encryptionIv: true, encryptionKeyVersion: true, storedByteSize: true } });
      if (!asset) throw new NotFoundException("The WhatsApp invoice asset was not found.");
      if (!asset.storageReference || !asset.encryptionIv || !asset.encryptionKeyVersion || asset.storedByteSize === null) throw new ConflictException("The WhatsApp invoice asset has no complete stored original.");
      await tx.whatsappInvoiceAsset.update({
        where: { id: asset.id },
        data: {
          storageState: input.outcome === "CLEAN" ? "READY" : "QUARANTINED",
          scanStatus: input.outcome,
          scannedAt: new Date(),
          storageFailureReason: input.outcome === "CLEAN" ? null : `Scanner result: ${input.scannerReference}`,
        },
      });
    });
  }

  async readAuthorized(context: TrustedCompanyActorContext, assetId: string): Promise<WhatsappInvoiceAssetContent> {
    const asset = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.whatsappInvoiceAsset.findFirst({
      where: { id: assetId, tenantId: context.tenantId, companyId: context.companyId, storageState: "READY", scanStatus: "CLEAN" },
      select: this.metadataSelect,
    }));
    if (!asset) throw new NotFoundException("A cleared WhatsApp invoice asset was not found.");
    return this.readMetadata(asset);
  }

  private readonly metadataSelect = { id: true, tenantId: true, companyId: true, originalFileName: true, actualMimeType: true, storageState: true, storageReference: true, encryptionIv: true, encryptionKeyVersion: true, storedByteSize: true, sha256: true, byteSize: true, scanStatus: true } satisfies Prisma.WhatsappInvoiceAssetSelect;
  private async loadMetadata(context: TrustedCompanyActorContext, assetId: string): Promise<AssetMetadata> {
    const asset = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.whatsappInvoiceAsset.findFirst({ where: { id: assetId, tenantId: context.tenantId, companyId: context.companyId }, select: this.metadataSelect }));
    if (!asset) throw new NotFoundException("The WhatsApp invoice asset was not found.");
    return asset;
  }
  private async scanAndRecord(context: TrustedCompanyActorContext, assetId: string, bytes: Buffer): Promise<Readonly<{ assetId: string; storageState: "READY" | "QUARANTINED"; scanStatus: "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED" }>> {
    const scan = await this.scanTrustedBytes(bytes);
    await this.recordTrustedScan({ context, assetId, scannerReference: scan.reference, outcome: scan.outcome });
    return { assetId, storageState: scan.outcome === "CLEAN" ? "READY" : "QUARANTINED", scanStatus: scan.outcome };
  }

  /**
   * Uses the same private scanner contract as the other document boundaries.
   * A missing, failing, or malformed scanner response deliberately fails
   * closed: the encrypted original stays quarantined and is never streamed.
   */
  private async scanTrustedBytes(bytes: Buffer): Promise<Readonly<{ outcome: "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED"; reference: string }>> {
    const endpoint = process.env.BASEER_DOCUMENT_SCANNER_ENDPOINT?.trim();
    if (!endpoint) return { outcome: "UNAVAILABLE", reference: "scanner-unavailable" };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json() as { status?: string };
      if (!response.ok || (result.status !== "READY" && result.status !== "QUARANTINED")) {
        return { outcome: "FAILED", reference: "configured-scanner-invalid-response" };
      }
      return result.status === "READY"
        ? { outcome: "CLEAN", reference: "configured-http-scanner" }
        // The shared scanner contract reports only READY or QUARANTINED. A
        // quarantine is not proof of malware, so WAI preserves it as a failed
        // scan rather than falsely labelling a supplier document malicious.
        : { outcome: "FAILED", reference: "configured-http-scanner-quarantine" };
    } catch {
      return { outcome: "FAILED", reference: "configured-scanner-unavailable" };
    }
  }
  private async readMetadata(asset: AssetMetadata): Promise<WhatsappInvoiceAssetContent> {
    if (!asset.actualMimeType || !asset.storageReference || !asset.encryptionIv || !asset.encryptionKeyVersion || asset.storedByteSize === null || !asset.sha256 || asset.byteSize === null) throw new ConflictException("The WhatsApp invoice asset storage metadata is incomplete.");
    const configuration = this.configuration();
    if (asset.encryptionKeyVersion !== configuration.keyVersion) throw new ServiceUnavailableException("The WhatsApp invoice asset encryption key version is unavailable.");
    const bytes = this.decrypt(await readFile(this.path(asset.storageReference)), asset.encryptionIv, asset.tenantId, asset.companyId, asset.id, configuration);
    this.assertPlaintext(bytes, asset.sha256, asset.byteSize);
    const detectedMimeType = this.detectMimeType(bytes);
    if (detectedMimeType !== asset.actualMimeType) throw new ConflictException("The WhatsApp invoice asset MIME evidence does not match its bytes.");
    return { bytes, mimeType: detectedMimeType, fileName: this.safeFileName(asset.originalFileName, detectedMimeType) };
  }

  private configuration(): Readonly<{ root: string; key: Buffer; keyVersion: number }> {
    if (process.env.NODE_ENV === "production" && process.env.BASEER_WAI_ASSET_STORAGE_ENABLED !== "true") {
      throw new ServiceUnavailableException("WhatsApp invoice private asset storage is disabled.");
    }
    const configuredRoot = process.env.BASEER_WAI_ASSET_STORAGE_ROOT?.trim();
    if (!configuredRoot) throw new ServiceUnavailableException("WhatsApp invoice private asset storage is not configured.");
    const rawKey = process.env.BASEER_WAI_ASSET_ENCRYPTION_KEY;
    const key = rawKey ? Buffer.from(rawKey, "base64") : null;
    if (!key || key.length !== 32 || key.toString("base64") !== rawKey) throw new ServiceUnavailableException("WhatsApp invoice private asset encryption is not configured.");
    const keyVersion = Number.parseInt(process.env.BASEER_WAI_ASSET_ENCRYPTION_KEY_VERSION ?? "1", 10);
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > 32_767) throw new ServiceUnavailableException("WhatsApp invoice private asset key version is invalid.");
    return { root: resolve(configuredRoot), key, keyVersion };
  }

  private detectMimeType(bytes: Buffer): "image/jpeg" | "image/png" | "application/pdf" {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ORIGINAL_BYTES) throw new ConflictException("WhatsApp invoice originals must be between 1 byte and 10 MiB.");
    if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return "application/pdf";
    throw new ConflictException("Only JPEG, PNG, and PDF originals are supported.");
  }

  private encrypt(bytes: Buffer, iv: Buffer, tenantId: string, companyId: string, assetId: string, configuration: Readonly<{ key: Buffer; keyVersion: number }>): Buffer {
    const cipher = createCipheriv("aes-256-gcm", configuration.key, iv);
    cipher.setAAD(this.aad(tenantId, companyId, assetId, configuration.keyVersion));
    return Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  }

  private decrypt(ciphertextWithTag: Buffer, ivValue: string, tenantId: string, companyId: string, assetId: string, configuration: Readonly<{ key: Buffer; keyVersion: number }>): Buffer {
    const iv = Buffer.from(ivValue, "base64");
    if (iv.length !== 12 || ciphertextWithTag.length < 17) throw new ConflictException("The WhatsApp invoice encrypted asset is invalid.");
    const decipher = createDecipheriv("aes-256-gcm", configuration.key, iv);
    decipher.setAAD(this.aad(tenantId, companyId, assetId, configuration.keyVersion));
    decipher.setAuthTag(ciphertextWithTag.subarray(-16));
    try { return Buffer.concat([decipher.update(ciphertextWithTag.subarray(0, -16)), decipher.final()]); }
    catch { throw new ConflictException("The WhatsApp invoice encrypted asset cannot be decrypted."); }
  }

  private aad(tenantId: string, companyId: string, assetId: string, keyVersion: number): Buffer {
    return Buffer.from(JSON.stringify({ kind: STORAGE_KIND, tenantId, companyId, assetId, keyVersion }));
  }

  private async writeOnce(reference: string, ciphertext: Buffer): Promise<void> {
    const target = this.path(reference);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(ciphertext); await handle.sync(); }
      finally { await handle.close(); }
      try { await link(temporary, target); }
      catch (error) {
        // A concurrent trusted ingestion may have published this immutable
        // canonical reference. Keep DB state PENDING and let a retry verify
        // the winner's metadata rather than marking its asset as failed.
        if (isAlreadyExists(error)) throw new ConflictException("The WhatsApp invoice asset is being stored by another trusted worker.");
        throw error;
      }
    } finally { await rm(temporary, { force: true }); }
  }

  private async assertExistingArtifactMatches(asset: Readonly<{ storageReference: string | null; encryptionIv: string | null; encryptionKeyVersion: number | null; storedByteSize: bigint | null; tenantId: string; companyId: string; id: string; sha256: string | null; byteSize: bigint | null }>, bytes: Buffer, sha256: string, configuration: Readonly<{ key: Buffer; keyVersion: number }>): Promise<void> {
    if (!asset.storageReference || !asset.encryptionIv || !asset.encryptionKeyVersion || asset.storedByteSize === null || !asset.sha256 || asset.byteSize === null) throw new ConflictException("The WhatsApp invoice asset storage metadata is incomplete.");
    if (asset.encryptionKeyVersion !== configuration.keyVersion) throw new ServiceUnavailableException("The WhatsApp invoice asset encryption key version is unavailable.");
    const restored = this.decrypt(await readFile(this.path(asset.storageReference)), asset.encryptionIv, asset.tenantId, asset.companyId, asset.id, configuration);
    this.assertPlaintext(restored, asset.sha256, asset.byteSize);
    if (restored.byteLength !== bytes.byteLength || !timingSafeEqual(createHash("sha256").update(restored).digest(), Buffer.from(sha256, "hex"))) throw new ConflictException("The WhatsApp invoice asset already has different original bytes.");
  }

  private assertPlaintext(bytes: Buffer, sha256: string, byteSize: bigint): void {
    if (BigInt(bytes.byteLength) !== byteSize || !/^[a-f0-9]{64}$/.test(sha256)) throw new ConflictException("The WhatsApp invoice asset plaintext metadata is invalid.");
    const actual = createHash("sha256").update(bytes).digest(); const expected = Buffer.from(sha256, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ConflictException("The WhatsApp invoice asset plaintext checksum does not match.");
  }

  private reference(tenantId: string, companyId: string, assetId: string): string { return `wai-assets/${tenantId}/${companyId}/${assetId}.bin`; }
  private path(reference: string): string {
    if (!/^wai-assets\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/.test(reference)) throw new ConflictException("The WhatsApp invoice storage reference is invalid.");
    const configuration = this.configuration(); const target = resolve(configuration.root, ...reference.split("/"));
    if (!target.startsWith(`${configuration.root}${sep}`)) throw new ConflictException("The WhatsApp invoice storage reference is unsafe.");
    return target;
  }
  private safeFileName(value: string, mimeType: string): string { const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 180) || "invoice"; return cleaned.includes(".") ? cleaned : `${cleaned}${mimeType === "application/pdf" ? ".pdf" : mimeType === "image/png" ? ".png" : ".jpg"}`; }
  private async markFailed(context: TrustedCompanyActorContext, assetId: string, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "Private asset storage failed.";
    await this.database.inTenantTransaction(context.tenantId, async (tx) => { await tx.whatsappInvoiceAsset.updateMany({ where: { id: assetId, tenantId: context.tenantId, companyId: context.companyId, storageState: "PENDING" }, data: { storageState: "FAILED", scanStatus: "FAILED", storageFailureReason: reason } }); });
  }
}

function isAlreadyExists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST"; }
