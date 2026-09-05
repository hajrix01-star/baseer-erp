import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Prisma, WhatsappInvoiceConnectionStatus } from "../generated/prisma/client.js";
import { DatabaseService } from "../database/database.service.js";

const AES_256_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_ENCRYPTED_JSON_BYTES = 256 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const OWNER_TOKEN = /^[A-Za-z0-9._:-]{16,128}$/;

type JsonObject = Readonly<Record<string, unknown>>;

export type WhatsappInvoiceConnectionScope = Readonly<{
  tenantId: string;
  connectionId: string;
}>;

export type WhatsappInvoiceConnectionLease = Readonly<{
  acquired: boolean;
  fence?: bigint;
  expiresAt?: Date;
  /** Only a deliberate user start may replace a confirmed logged-out session. */
  requiresFreshPairing?: boolean;
}>;

export type WhatsappInvoiceMediaReceipt = Readonly<{
  tenantId: string;
  connectionId: string;
  groupJid: string;
  whatsappMessageId: string;
  receivedAt: Date;
  attachmentIndex: number;
  originalFileName: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  /**
   * Technical download material only (for example a media key or direct path).
   * Conversation text, captions, sender names, and message bodies are rejected.
   */
  transportMetadata: JsonObject;
}>;

export type WhatsappInvoiceMediaReservation = Readonly<{
  accepted: boolean;
  inboundMessageId?: string;
  assetId?: string;
  mediaWorkItemId?: string;
}>;

export type ClaimedWhatsappInvoiceMediaWorkItem = Readonly<{
  id: string;
  companyId: string;
  assetId: string;
}>;

export type WhatsappInvoiceMediaWorkCompletion = "STORED" | "QUARANTINED" | "RETRYABLE_FAILURE" | "FINAL_FAILURE";
export type WhatsappInvoicePilotConnectionStatus = "CONNECTED" | "GAP_DETECTED" | "REAUTH_REQUIRED" | "DISCONNECTED";

/**
 * Database-only primitives for the single-owner Baileys pilot.  This class
 * deliberately has no Baileys socket, QR, network, media download, OCR, or
 * HTTP responsibility. A later connector may register it as a provider and
 * must acquire a lease before using its returned fence for any side effect.
 */
@Injectable()
export class WhatsappInvoiceBaileysPilotFoundationService {
  constructor(private readonly database: DatabaseService) {}

  async saveAuthState(scope: WhatsappInvoiceConnectionScope, state: JsonObject, expectedRowVersion?: number): Promise<Readonly<{ rowVersion: number }>> {
    this.assertScope(scope);
    const configuration = this.configuration();
    const encrypted = this.encryptJson(state, this.sessionAad(scope, configuration.keyVersion), configuration.key);

    return this.database.inTenantTransaction(scope.tenantId, async (tx) => {
      await this.assertConnection(tx, scope);
      return this.saveEncryptedAuthState(tx, scope, encrypted, configuration.keyVersion, expectedRowVersion);
    });
  }

  /** A live connector may write credentials only while it owns the current lease fence. */
  async saveAuthStateOwned(input: Readonly<WhatsappInvoiceConnectionScope & { ownerToken: string; fence: bigint; state: JsonObject; expectedRowVersion: number }>): Promise<Readonly<{ rowVersion: number }>> {
    this.assertScope(input);
    this.assertOwnerToken(input.ownerToken);
    if (input.fence < 1n || !Number.isSafeInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) throw new ConflictException("The WhatsApp session write fence is invalid.");
    const configuration = this.configuration();
    const encrypted = this.encryptJson(input.state, this.sessionAad(input, configuration.keyVersion), configuration.key);
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      await this.assertConnection(tx, input);
      const now = new Date();
      const lease = await tx.whatsappInvoiceConnectionLease.findFirst({
        where: { tenantId: input.tenantId, connectionId: input.connectionId, ownerToken: input.ownerToken, fence: input.fence, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!lease) throw new ConflictException("The WhatsApp connection lease was lost before session persistence.");
      return this.saveEncryptedAuthState(tx, input, encrypted, configuration.keyVersion, input.expectedRowVersion);
    });
  }

  async loadAuthState<T extends JsonObject>(scope: WhatsappInvoiceConnectionScope): Promise<Readonly<{ state: T; rowVersion: number }> | null> {
    this.assertScope(scope);
    return this.database.inTenantTransaction(scope.tenantId, async (tx) => {
      const session = await tx.whatsappInvoiceConnectionSession.findFirst({
        where: { tenantId: scope.tenantId, connectionId: scope.connectionId },
        select: { ciphertext: true, iv: true, keyVersion: true, rowVersion: true },
      });
      if (!session) return null;
      const configuration = this.configuration();
      if (session.keyVersion !== configuration.keyVersion) throw new ServiceUnavailableException("The WhatsApp session encryption key version is unavailable.");
      const state = this.decryptJson(session.ciphertext, session.iv, this.sessionAad(scope, session.keyVersion), configuration.key);
      return { state: state as T, rowVersion: session.rowVersion };
    });
  }

  async acquireConnectionLease(input: Readonly<WhatsappInvoiceConnectionScope & { ownerToken: string; ttlMs: number; resumeOnly?: boolean }>): Promise<WhatsappInvoiceConnectionLease> {
    this.assertScope(input);
    this.assertOwnerToken(input.ownerToken);
    const ttlMs = this.leaseDuration(input.ttlMs);
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      // Read the reauthorization intent in the same transaction that gives a
      // caller the lease.  A manual start after an explicit WhatsApp logout
      // must not boot the known-invalid encrypted credentials again; a
      // reconnect or a user stop must never take this path.
      const connection = await tx.whatsappInvoiceConnection.findFirst({
        where: { id: input.connectionId, tenantId: input.tenantId },
        select: { id: true, status: true },
      });
      if (!connection) throw new NotFoundException("The WhatsApp connection was not found.");
      const requiresFreshPairing = !input.resumeOnly && connection.status === WhatsappInvoiceConnectionStatus.REAUTH_REQUIRED;
      const now = new Date();
      const expiresAt = new Date(now.valueOf() + ttlMs);
      const current = await tx.whatsappInvoiceConnectionLease.findFirst({
        where: { tenantId: input.tenantId, connectionId: input.connectionId },
        select: { id: true, ownerToken: true, fence: true, expiresAt: true },
      });
      if (!current) {
        // An automatic recovery must never create a lease. A successful manual
        // start always creates the durable row first; retaining it lets the
        // conditional claim below bind recovery to the current stop intent.
        if (input.resumeOnly) return { acquired: false };
        try {
          const created = await tx.whatsappInvoiceConnectionLease.create({
            data: { tenantId: input.tenantId, connectionId: input.connectionId, ownerToken: input.ownerToken, fence: 1n, heartbeatAt: now, expiresAt },
            select: { fence: true, expiresAt: true },
          });
          return { acquired: true, fence: created.fence, expiresAt: created.expiresAt, requiresFreshPairing };
        } catch (error) {
          if (isUniqueConstraint(error)) return { acquired: false };
          throw error;
        }
      }
      if (current.expiresAt <= now) {
        const claimed = await tx.whatsappInvoiceConnectionLease.updateMany({
          where: {
            id: current.id, tenantId: input.tenantId, connectionId: input.connectionId, expiresAt: { lte: now },
            ...(input.resumeOnly ? { connection: { is: { status: WhatsappInvoiceConnectionStatus.GAP_DETECTED } } } : {}),
          },
          data: { ownerToken: input.ownerToken, fence: { increment: 1 }, heartbeatAt: now, expiresAt },
        });
        if (claimed.count !== 1) return { acquired: false };
        const lease = await tx.whatsappInvoiceConnectionLease.findFirst({ where: { id: current.id, tenantId: input.tenantId, connectionId: input.connectionId }, select: { fence: true, expiresAt: true } });
        if (!lease) throw new ConflictException("The WhatsApp connection lease was released during acquisition.");
        return { acquired: true, fence: lease.fence, expiresAt: lease.expiresAt, requiresFreshPairing };
      }
      if (current.ownerToken !== input.ownerToken) return { acquired: false };
      const renewed = await tx.whatsappInvoiceConnectionLease.updateMany({
        where: { id: current.id, tenantId: input.tenantId, connectionId: input.connectionId, ownerToken: input.ownerToken, fence: current.fence, expiresAt: { gt: now } },
        data: { heartbeatAt: now, expiresAt },
      });
      return renewed.count === 1 ? { acquired: true, fence: current.fence, expiresAt, requiresFreshPairing } : { acquired: false };
    });
  }

  async heartbeatConnectionLease(input: Readonly<WhatsappInvoiceConnectionScope & { ownerToken: string; fence: bigint; ttlMs: number }>): Promise<WhatsappInvoiceConnectionLease> {
    this.assertScope(input);
    this.assertOwnerToken(input.ownerToken);
    if (input.fence < 1n) throw new ConflictException("The WhatsApp connection lease fence is invalid.");
    const now = new Date();
    const expiresAt = new Date(now.valueOf() + this.leaseDuration(input.ttlMs));
    const result = await this.database.inTenantTransaction(input.tenantId, async (tx) => tx.whatsappInvoiceConnectionLease.updateMany({
      where: { tenantId: input.tenantId, connectionId: input.connectionId, ownerToken: input.ownerToken, fence: input.fence, expiresAt: { gt: now } },
      data: { heartbeatAt: now, expiresAt },
    }));
    return result.count === 1 ? { acquired: true, fence: input.fence, expiresAt } : { acquired: false };
  }

  async releaseConnectionLease(input: Readonly<WhatsappInvoiceConnectionScope & { ownerToken: string; fence: bigint }>): Promise<boolean> {
    this.assertScope(input);
    this.assertOwnerToken(input.ownerToken);
    if (input.fence < 1n) return false;
    const releasedAt = new Date();
    // Keep the row: deleting it would reset the next owner to fence 1 and let
    // a delayed owner from an earlier lifetime appear current. The successor
    // acquires the expired row and increments its durable fence.
    const result = await this.database.inTenantTransaction(input.tenantId, async (tx) => tx.whatsappInvoiceConnectionLease.updateMany({
      where: { tenantId: input.tenantId, connectionId: input.connectionId, ownerToken: input.ownerToken, fence: input.fence },
      data: { expiresAt: releasedAt, heartbeatAt: new Date(releasedAt.valueOf() - 1) },
    }));
    return result.count === 1;
  }

  /** Durable stop intent is visible to the current owner on every API worker. */
  async requestConnectionStop(scope: WhatsappInvoiceConnectionScope): Promise<void> {
    this.assertScope(scope);
    await this.database.inTenantTransaction(scope.tenantId, async (tx) => {
      await this.assertConnection(tx, scope);
      const now = new Date();
      await tx.whatsappInvoiceConnection.updateMany({ where: { id: scope.connectionId, tenantId: scope.tenantId }, data: { status: WhatsappInvoiceConnectionStatus.DISCONNECTED } });
      await tx.whatsappInvoiceConnectionLease.updateMany({ where: { tenantId: scope.tenantId, connectionId: scope.connectionId }, data: { expiresAt: now, heartbeatAt: new Date(now.valueOf() - 1) } });
    });
  }

  /**
   * The connector alone writes these operational states, and only while it
   * owns the same fenced lease. This prevents an old socket from overwriting
   * a newer worker's connection health after it has lost ownership.
   */
  async setConnectionStatus(input: Readonly<WhatsappInvoiceConnectionScope & { ownerToken: string; fence: bigint; status: WhatsappInvoicePilotConnectionStatus }>): Promise<boolean> {
    this.assertScope(input);
    this.assertOwnerToken(input.ownerToken);
    if (input.fence < 1n) throw new ConflictException("The WhatsApp connection lease fence is invalid.");
    const now = new Date();
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      const lease = await tx.whatsappInvoiceConnectionLease.findFirst({
        where: { tenantId: input.tenantId, connectionId: input.connectionId, ownerToken: input.ownerToken, fence: input.fence, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!lease) return false;
      const status = WhatsappInvoiceConnectionStatus[input.status];
      const updated = await tx.whatsappInvoiceConnection.updateMany({
        where: { id: input.connectionId, tenantId: input.tenantId },
        data: { status, ...(input.status === "CONNECTED" ? { lastSyncedAt: now } : {}) },
      });
      return updated.count === 1;
    });
  }

  /**
   * Atomically reserves the receipt before a connector is permitted to fetch
   * media bytes. Only message identity, one pending asset, and one encrypted
   * work item may be created here. A replay returns the prior reservation.
   */
  async reserveMediaReceipt(input: WhatsappInvoiceMediaReceipt): Promise<WhatsappInvoiceMediaReservation> {
    this.assertReceipt(input);
    try {
      return await this.reserveMediaReceiptOnce(input);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      // A concurrent handler won receipt creation. Read/complete the same
      // immutable receipt rather than creating a duplicate on retry.
      return this.reserveMediaReceiptOnce(input);
    }
  }

  async loadMediaWorkItemMetadata<T extends JsonObject>(input: Readonly<{ tenantId: string; companyId: string; mediaWorkItemId: string }>): Promise<T> {
    if (!this.isIdentifier(input.tenantId) || !this.isIdentifier(input.companyId) || !this.isIdentifier(input.mediaWorkItemId)) throw new ConflictException("The WhatsApp media work item scope is invalid.");
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      const workItem = await tx.whatsappInvoiceMediaWorkItem.findFirst({
        where: { id: input.mediaWorkItemId, tenantId: input.tenantId, companyId: input.companyId },
        select: {
          metadataCiphertext: true, metadataIv: true, metadataKeyVersion: true,
          asset: { select: { id: true, inboundMessage: { select: { connectionId: true } } } },
        },
      });
      if (!workItem) throw new NotFoundException("The WhatsApp media work item was not found.");
      const configuration = this.configuration();
      if (workItem.metadataKeyVersion !== configuration.keyVersion) throw new ServiceUnavailableException("The WhatsApp media work item encryption key version is unavailable.");
      return this.decryptJson(workItem.metadataCiphertext, workItem.metadataIv, this.workItemAad({ tenantId: input.tenantId, companyId: input.companyId, connectionId: workItem.asset.inboundMessage.connectionId, assetId: workItem.asset.id }, workItem.metadataKeyVersion), configuration.key) as T;
    });
  }

  /**
   * Claims one receipt for the current fenced connection owner.  A receipt is
   * never downloaded before this claim succeeds, which makes replay and a
   * second API replica harmless.  Expired work is returned to the queue so a
   * crashed owner is recoverable without creating another receipt.
   */
  async claimNextMediaWorkItem(input: Readonly<WhatsappInvoiceConnectionScope & { ownerToken: string; fence: bigint; ttlMs: number }>): Promise<ClaimedWhatsappInvoiceMediaWorkItem | null> {
    this.assertScope(input);
    this.assertOwnerToken(input.ownerToken);
    if (input.fence < 1n) throw new ConflictException("The WhatsApp connection lease fence is invalid.");
    const leaseMs = this.leaseDuration(input.ttlMs);
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      const now = new Date();
      const lease = await tx.whatsappInvoiceConnectionLease.findFirst({
        where: { tenantId: input.tenantId, connectionId: input.connectionId, ownerToken: input.ownerToken, fence: input.fence, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!lease) return null;

      await tx.whatsappInvoiceMediaWorkItem.updateMany({
        where: {
          tenantId: input.tenantId, state: "RUNNING", jobLeaseExpiresAt: { lte: now },
          asset: { inboundMessage: { connectionId: input.connectionId } },
        },
        data: { state: "QUEUED", nextAttemptAt: now, jobOwnerToken: null, jobFence: null, jobLeaseExpiresAt: null, jobHeartbeatAt: null, lastErrorCode: "WORKER_LEASE_EXPIRED" },
      });

      const candidate = await tx.whatsappInvoiceMediaWorkItem.findFirst({
        where: {
          tenantId: input.tenantId, state: "QUEUED", nextAttemptAt: { lte: now },
          asset: { inboundMessage: { connectionId: input.connectionId } },
        },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
        select: { id: true, companyId: true, assetId: true },
      });
      if (!candidate) return null;
      const claimed = await tx.whatsappInvoiceMediaWorkItem.updateMany({
        where: { id: candidate.id, tenantId: input.tenantId, companyId: candidate.companyId, state: "QUEUED", nextAttemptAt: { lte: now } },
        data: {
          state: "RUNNING", attempts: { increment: 1 }, nextAttemptAt: null,
          jobOwnerToken: input.ownerToken, jobFence: input.fence,
          jobHeartbeatAt: now, jobLeaseExpiresAt: new Date(now.valueOf() + leaseMs), lastErrorCode: null,
        },
      });
      return claimed.count === 1 ? candidate : null;
    });
  }

  /** Completes a claimed item only while its connection and work leases are current. */
  async completeMediaWorkItem(input: Readonly<WhatsappInvoiceConnectionScope & { ownerToken: string; fence: bigint; mediaWorkItemId: string; completion: WhatsappInvoiceMediaWorkCompletion; errorCode?: string }>): Promise<boolean> {
    this.assertScope(input);
    this.assertOwnerToken(input.ownerToken);
    if (input.fence < 1n || !this.isIdentifier(input.mediaWorkItemId) || (input.errorCode !== undefined && !/^[A-Z0-9_:-]{3,80}$/.test(input.errorCode))) throw new ConflictException("The WhatsApp media work completion is invalid.");
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      const now = new Date();
      const item = await tx.whatsappInvoiceMediaWorkItem.findFirst({
        where: {
          id: input.mediaWorkItemId, tenantId: input.tenantId, state: "RUNNING", jobOwnerToken: input.ownerToken,
          jobFence: input.fence, jobLeaseExpiresAt: { gt: now }, asset: { inboundMessage: { connectionId: input.connectionId } },
        },
        select: { id: true, attempts: true },
      });
      if (!item) return false;
      const terminal = input.completion === "STORED" ? "STORED" : input.completion === "QUARANTINED" ? "QUARANTINED" : input.completion === "FINAL_FAILURE" || item.attempts >= 5 ? "FAILED" : "QUEUED";
      const retryAt = terminal === "QUEUED" ? new Date(now.valueOf() + retryDelayMs(item.attempts)) : null;
      const completed = await tx.whatsappInvoiceMediaWorkItem.updateMany({
        where: { id: item.id, tenantId: input.tenantId, state: "RUNNING", jobOwnerToken: input.ownerToken, jobFence: input.fence, jobLeaseExpiresAt: { gt: now } },
        data: {
          state: terminal, nextAttemptAt: retryAt,
          jobOwnerToken: null, jobFence: null, jobLeaseExpiresAt: null, jobHeartbeatAt: null,
          lastErrorCode: input.completion === "STORED" ? null : input.errorCode ?? (input.completion === "QUARANTINED" ? "ASSET_QUARANTINED" : "MEDIA_DOWNLOAD_FAILED"),
        },
      });
      return completed.count === 1;
    });
  }

  private async reserveMediaReceiptOnce(input: WhatsappInvoiceMediaReceipt): Promise<WhatsappInvoiceMediaReservation> {
    const configuration = this.configuration();
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      await this.assertConnection(tx, input);
      const binding = await tx.whatsappInvoiceGroupBinding.findFirst({
        where: { tenantId: input.tenantId, connectionId: input.connectionId, groupJid: input.groupJid, active: true },
        select: { id: true, companyId: true, bindingRevision: true },
      });
      // An unbound group is intentionally ignored by this persistence primitive.
      // The connector may count the event operationally, but never stores its chat.
      if (!binding) return { accepted: false };

      let message = await tx.whatsappInboundMessage.findFirst({
        where: { tenantId: input.tenantId, connectionId: input.connectionId, groupJidSnapshot: input.groupJid, whatsappMessageId: input.whatsappMessageId },
        select: { id: true, companyId: true },
      });
      if (!message) {
        message = await tx.whatsappInboundMessage.create({
          data: {
            tenantId: input.tenantId, companyId: binding.companyId, connectionId: input.connectionId,
            groupBindingId: binding.id, groupBindingRevision: binding.bindingRevision,
            whatsappMessageId: input.whatsappMessageId, groupJidSnapshot: input.groupJid, receivedAt: input.receivedAt,
          },
          select: { id: true, companyId: true },
        });
      }
      // The first accepted binding is historical truth; a later binding change
      // must not rewrite it, and cannot redirect a replay to another company.
      if (message.companyId !== binding.companyId) throw new ConflictException("The WhatsApp receipt is already bound to another company.");

      let asset = await tx.whatsappInvoiceAsset.findFirst({
        where: { tenantId: input.tenantId, companyId: binding.companyId, inboundMessageId: message.id, attachmentIndex: input.attachmentIndex },
        select: { id: true },
      });
      if (!asset) {
        asset = await tx.whatsappInvoiceAsset.create({
          data: {
            tenantId: input.tenantId, companyId: binding.companyId, inboundMessageId: message.id,
            attachmentIndex: input.attachmentIndex, originalFileName: input.originalFileName,
            mimeType: input.mimeType, receivedAt: input.receivedAt,
          },
          select: { id: true },
        });
      }

      let workItem = await tx.whatsappInvoiceMediaWorkItem.findFirst({
        where: { tenantId: input.tenantId, companyId: binding.companyId, assetId: asset.id },
        select: { id: true },
      });
      if (!workItem) {
        const encrypted = this.encryptJson(input.transportMetadata, this.workItemAad({ tenantId: input.tenantId, companyId: binding.companyId, connectionId: input.connectionId, assetId: asset.id }, configuration.keyVersion), configuration.key);
        workItem = await tx.whatsappInvoiceMediaWorkItem.create({
          data: {
            tenantId: input.tenantId, companyId: binding.companyId, assetId: asset.id, state: "QUEUED",
            metadataCiphertext: encrypted.ciphertext, metadataIv: encrypted.iv, metadataKeyVersion: configuration.keyVersion,
            nextAttemptAt: new Date(),
          },
          select: { id: true },
        });
      }
      return { accepted: true, inboundMessageId: message.id, assetId: asset.id, mediaWorkItemId: workItem.id };
    });
  }

  private async saveEncryptedAuthState(tx: Prisma.TransactionClient, scope: WhatsappInvoiceConnectionScope, encrypted: Readonly<{ ciphertext: string; iv: string }>, keyVersion: number, expectedRowVersion: number | undefined): Promise<Readonly<{ rowVersion: number }>> {
    const current = await tx.whatsappInvoiceConnectionSession.findFirst({
      where: { tenantId: scope.tenantId, connectionId: scope.connectionId },
      select: { id: true, rowVersion: true },
    });
    if (!current) {
      if (expectedRowVersion !== undefined && expectedRowVersion !== 0) throw new ConflictException("The WhatsApp session has changed.");
      try {
        const created = await tx.whatsappInvoiceConnectionSession.create({
          data: { tenantId: scope.tenantId, connectionId: scope.connectionId, ciphertext: encrypted.ciphertext, iv: encrypted.iv, keyVersion },
          select: { rowVersion: true },
        });
        return { rowVersion: created.rowVersion };
      } catch (error) {
        if (isUniqueConstraint(error)) throw new ConflictException("The WhatsApp session has changed.");
        throw error;
      }
    }
    if (expectedRowVersion !== undefined && current.rowVersion !== expectedRowVersion) throw new ConflictException("The WhatsApp session has changed.");
    const updated = await tx.whatsappInvoiceConnectionSession.updateMany({
      where: { id: current.id, tenantId: scope.tenantId, connectionId: scope.connectionId, rowVersion: current.rowVersion },
      data: { ciphertext: encrypted.ciphertext, iv: encrypted.iv, keyVersion, rowVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ConflictException("The WhatsApp session has changed.");
    return { rowVersion: current.rowVersion + 1 };
  }

  private async assertConnection(tx: Prisma.TransactionClient, scope: WhatsappInvoiceConnectionScope): Promise<void> {
    const connection = await tx.whatsappInvoiceConnection.findFirst({ where: { id: scope.connectionId, tenantId: scope.tenantId }, select: { id: true } });
    if (!connection) throw new NotFoundException("The WhatsApp connection was not found.");
  }

  private configuration(): Readonly<{ key: Buffer; keyVersion: number }> {
    const configured = process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY?.trim();
    const key = configured ? Buffer.from(configured, "base64") : null;
    if (!key || key.byteLength !== AES_256_KEY_BYTES || key.toString("base64") !== configured) throw new ServiceUnavailableException("WhatsApp session encryption is not configured.");
    const keyVersion = Number.parseInt(process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY_VERSION ?? "1", 10);
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > 32_767) throw new ServiceUnavailableException("WhatsApp session encryption key version is invalid.");
    return { key, keyVersion };
  }

  private encryptJson(value: JsonObject, aad: Buffer, key: Buffer): Readonly<{ ciphertext: string; iv: string }> {
    const plaintext = this.serializedJson(value);
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64") };
  }

  private decryptJson(ciphertext: string, ivValue: string, aad: Buffer, key: Buffer): JsonObject {
    const iv = Buffer.from(ivValue, "base64");
    const encrypted = Buffer.from(ciphertext, "base64");
    if (iv.byteLength !== GCM_IV_BYTES || encrypted.byteLength <= GCM_TAG_BYTES || iv.toString("base64") !== ivValue || encrypted.toString("base64") !== ciphertext) throw new ConflictException("The WhatsApp encrypted envelope is invalid.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
      decipher.setAAD(aad);
      decipher.setAuthTag(encrypted.subarray(-GCM_TAG_BYTES));
      const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -GCM_TAG_BYTES)), decipher.final()]).toString("utf8"));
      if (!isJsonObject(parsed)) throw new Error("invalid-json-object");
      return parsed;
    } catch {
      throw new ConflictException("The WhatsApp encrypted envelope cannot be decrypted.");
    }
  }

  private serializedJson(value: JsonObject): Buffer {
    if (!isJsonObject(value) || containsConversationText(value)) throw new ConflictException("WhatsApp transport metadata must not contain conversation text.");
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_ENCRYPTED_JSON_BYTES) throw new ConflictException("The WhatsApp encrypted envelope is invalid.");
    return Buffer.from(serialized, "utf8");
  }

  private sessionAad(scope: WhatsappInvoiceConnectionScope, keyVersion: number): Buffer {
    return Buffer.from(JSON.stringify({ kind: "baseer-wai-session-v1", tenantId: scope.tenantId, connectionId: scope.connectionId, keyVersion }), "utf8");
  }

  // Work-item AAD deliberately uses the immutable asset identity, not the
  // random work-item primary key. This lets receipt creation encrypt metadata
  // before the row is inserted while still binding it to one receipt asset.
  private workItemAad(scope: Readonly<{ tenantId: string; companyId: string; connectionId: string; assetId: string }>, keyVersion: number): Buffer {
    return Buffer.from(JSON.stringify({ kind: "baseer-wai-media-work-item-v1", tenantId: scope.tenantId, companyId: scope.companyId, connectionId: scope.connectionId, assetId: scope.assetId, keyVersion }), "utf8");
  }

  private assertReceipt(input: WhatsappInvoiceMediaReceipt): void {
    this.assertScope(input);
    if (!this.isIdentifier(input.groupJid) || !this.isIdentifier(input.whatsappMessageId) || !Number.isSafeInteger(input.attachmentIndex) || input.attachmentIndex < 0 || !(input.receivedAt instanceof Date) || !Number.isFinite(input.receivedAt.valueOf())) throw new ConflictException("The WhatsApp media receipt is invalid.");
    if (!SUPPORTED_MEDIA_TYPES.has(input.mimeType) || !input.originalFileName.trim() || input.originalFileName.length > 500) throw new ConflictException("The WhatsApp media type is not supported.");
    this.serializedJson(input.transportMetadata);
  }

  private assertScope(scope: WhatsappInvoiceConnectionScope): void {
    if (!this.isIdentifier(scope.tenantId) || !this.isIdentifier(scope.connectionId)) throw new ConflictException("The WhatsApp connection scope is invalid.");
  }

  private isIdentifier(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f]/.test(value); }
  private assertOwnerToken(value: string): void { if (!OWNER_TOKEN.test(value)) throw new ConflictException("The WhatsApp connection lease owner token is invalid."); }
  private leaseDuration(value: number): number { if (!Number.isSafeInteger(value) || value < 5_000 || value > 5 * 60_000) throw new ConflictException("The WhatsApp connection lease duration is invalid."); return value; }
}

function isUniqueConstraint(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"; }
function isJsonObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function retryDelayMs(attempts: number): number { return Math.min(15 * 60_000, 5_000 * (2 ** Math.max(0, Math.min(attempts - 1, 8)))); }
function containsConversationText(value: JsonObject): boolean {
  const forbiddenKeys = new Set(["caption", "conversation", "text", "body", "content", "message", "messagetext", "sendername", "pushname"]);
  const walk = (candidate: unknown): boolean => {
    if (Array.isArray(candidate)) return candidate.some(walk);
    if (!isJsonObject(candidate)) return false;
    return Object.entries(candidate).some(([key, nested]) => forbiddenKeys.has(key.toLocaleLowerCase("en-US")) || walk(nested));
  };
  return walk(value);
}
