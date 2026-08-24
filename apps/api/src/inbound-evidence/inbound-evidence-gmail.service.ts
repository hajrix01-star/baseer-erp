import { BadGatewayException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";

import { Prisma } from "../generated/prisma/client.js";
import { DatabaseService } from "../database/database.service.js";
import { RequestContext } from "../observability/request-context.js";
import type { TrustedTenantAdministratorContext } from "../administration/tenant-administration-context.service.js";

type GmailToken = { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; error?: string };
type GmailList = { messages?: Array<{ id: string; threadId?: string }>; historyId?: string };
type GmailMessage = { id: string; threadId?: string; snippet?: string; internalDate?: string; historyId?: string; payload?: GmailPart };
type GmailPart = { partId?: string; mimeType?: string; filename?: string; headers?: Array<{ name?: string; value?: string }>; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GmailPart[] };
type GmailAttachment = { data?: string; size?: number };
type Credential = { accessToken: string; refreshToken: string };
type AttachmentPart = { attachmentId: string; partId: string; mimeType: string; fileName: string; size: number };

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const STORAGE_NAMESPACE = "inbound-evidence";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

@Injectable()
export class InboundEvidenceGmailService {
  private readonly root = resolve(process.env.BASEER_INBOUND_EVIDENCE_STORAGE_ROOT ?? "storage/inbound-evidence");
  constructor(private readonly database: DatabaseService) {}

  async connection(context: TrustedTenantAdministratorContext) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => this.publicConnection(context.tenantId, await tx.inboundEvidenceGmailConnection.findFirst({ where: { tenantId: context.tenantId } }), tx));
  }

  readiness(context: TrustedTenantAdministratorContext) {
    this.ownerOnly(context);
    const required = ["BASEER_GMAIL_OAUTH_ENABLED", "BASEER_GMAIL_OAUTH_CLIENT_ID", "BASEER_GMAIL_OAUTH_CLIENT_SECRET", "BASEER_GMAIL_OAUTH_REDIRECT_URI", "BASEER_INBOUND_EVIDENCE_ENCRYPTION_KEY", "BASEER_INBOUND_EVIDENCE_STORAGE_ENCRYPTION_KEY"];
    const missing = required.filter((name) => name === "BASEER_GMAIL_OAUTH_ENABLED" ? process.env[name] !== "true" : !process.env[name]?.trim());
    const redirectUri = process.env.BASEER_GMAIL_OAUTH_REDIRECT_URI?.trim() || null;
    return { ready: missing.length === 0 && this.validUrl(redirectUri), missing: this.validUrl(redirectUri) ? missing : [...missing, ...(missing.includes("BASEER_GMAIL_OAUTH_REDIRECT_URI") ? [] : ["BASEER_GMAIL_OAUTH_REDIRECT_URI"])], redirectUri: this.validUrl(redirectUri) ? redirectUri : null };
  }

  async beginAuthorization(context: TrustedTenantAdministratorContext) {
    this.ownerOnly(context);
    const config = this.config();
    const stateSecret = randomBytes(32).toString("base64url");
    const state = `${context.tenantId}.${stateSecret}`;
    const verifier = randomBytes(48).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const encrypted = this.encryptText(JSON.stringify({ verifier, nonce }));
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await tx.inboundEvidenceGmailOAuthState.create({ data: { id: randomUUID(), tenantId: context.tenantId, initiatedByUserId: context.actorUserId, stateHash: this.hash(state), nonceHash: this.hash(nonce), verifierEncrypted: encrypted.ciphertext, verifierIv: encrypted.iv, verifierTag: encrypted.tag, expiresAt } });
      await tx.inboundEvidenceGmailConnection.upsert({ where: { tenantId: context.tenantId }, create: { id: randomUUID(), tenantId: context.tenantId, status: "AUTHORIZING", createdByUserId: context.actorUserId, updatedByUserId: context.actorUserId }, update: { status: "AUTHORIZING", lastErrorCode: null, updatedByUserId: context.actorUserId } });
      await this.audit(tx, context, "inbound_evidence.gmail.authorization_started", "InboundEvidenceGmailConnection", context.tenantId, null, { expiresAt: expiresAt.toISOString() });
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: GMAIL_SCOPE, state, code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent", include_granted_scopes: "true" }).toString();
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async completeAuthorization(state: string, code: string) {
    const [tenantId, secret, ...rest] = state.split(".");
    if (!tenantId || !secret || rest.length || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new ForbiddenException("Invalid Gmail authorization state.");
    const config = this.config();
    // Validate and decrypt state in a short tenant transaction. The OAuth
    // exchange itself is network I/O and must not keep a Prisma transaction
    // open, otherwise a slow provider can starve or invalidate the DB session.
    const saved = await this.database.inTenantTransaction(tenantId, async (tx) => tx.inboundEvidenceGmailOAuthState.findFirst({ where: { tenantId, stateHash: this.hash(state), consumedAt: null, expiresAt: { gt: new Date() } } }));
    if (!saved) throw new ForbiddenException("Gmail authorization state has expired or was already used.");
    const { verifier } = JSON.parse(this.decryptText({ ciphertext: saved.verifierEncrypted, iv: saved.verifierIv, tag: saved.verifierTag })) as { verifier: string };
    const token = await this.exchangeCode(config, code, verifier);
    if (!token.access_token || !token.refresh_token) throw new BadGatewayException("Gmail consent did not provide a refresh token. Revoke the prior grant and retry with consent.");
    const profile = await this.gmailJson<{ emailAddress?: string; historyId?: string }>(token.access_token, "/gmail/v1/users/me/profile");
    const mailboxEmail = profile.emailAddress;
    if (!mailboxEmail) throw new BadGatewayException("Gmail did not return a mailbox identity.");
    const credentials = this.encryptText(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token } satisfies Credential));
    const expiresAt = new Date(Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000);
    return this.database.inTenantTransaction(tenantId, async (tx) => {
      const unconsumed = await tx.inboundEvidenceGmailOAuthState.findFirst({ where: { id: saved.id, tenantId, stateHash: this.hash(state), consumedAt: null, expiresAt: { gt: new Date() } } });
      if (!unconsumed) throw new ForbiddenException("Gmail authorization state was already completed.");
      const connection = await tx.inboundEvidenceGmailConnection.upsert({ where: { tenantId }, create: { id: randomUUID(), tenantId, status: "CONNECTED", mailboxEmail: mailboxEmail.toLowerCase(), credentialCiphertext: credentials.ciphertext, credentialIv: credentials.iv, credentialTag: credentials.tag, credentialKeyVersion: 1, accessTokenExpiresAt: expiresAt, gmailHistoryId: profile.historyId ?? null, createdByUserId: saved.initiatedByUserId, updatedByUserId: saved.initiatedByUserId }, update: { status: "CONNECTED", mailboxEmail: mailboxEmail.toLowerCase(), credentialCiphertext: credentials.ciphertext, credentialIv: credentials.iv, credentialTag: credentials.tag, credentialKeyVersion: 1, accessTokenExpiresAt: expiresAt, gmailHistoryId: profile.historyId ?? null, lastErrorCode: null, updatedByUserId: saved.initiatedByUserId } });
      await tx.inboundEvidenceGmailOAuthState.update({ where: { id: saved.id }, data: { consumedAt: new Date() } });
      await this.audit(tx, { tenantId, actorUserId: saved.initiatedByUserId, isOwner: true }, "inbound_evidence.gmail.connected", "InboundEvidenceGmailConnection", connection.id, null, { mailboxEmail: connection.mailboxEmail, scope: "gmail.readonly" });
      return { mailboxEmail: connection.mailboxEmail! };
    });
  }

  async syncWithKey(context: TrustedTenantAdministratorContext, maxMessages: number, idempotencyKey: string) {
    this.ownerOnly(context);
    const requestHash = this.hash({ maxMessages });
    const prior = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.inboundEvidenceCommandReceipt.findFirst({ where: { tenantId: context.tenantId, actorUserId: context.actorUserId, operation: "inbound_evidence.gmail.sync", idempotencyKey } }));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ConflictException("This idempotency key was used with a different Gmail sync request.");
      const response = prior.responseJson as { importedMessages?: number; downloadedAttachments?: number; skippedAttachments?: number };
      return { importedMessages: response.importedMessages ?? 0, downloadedAttachments: response.downloadedAttachments ?? 0, skippedAttachments: response.skippedAttachments ?? 0, replayed: true };
    }
    const connection = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.inboundEvidenceGmailConnection.findFirst({ where: { tenantId: context.tenantId } }));
    if (!connection?.credentialCiphertext || !connection.credentialIv || !connection.credentialTag || connection.status !== "CONNECTED") throw new ConflictException("Gmail is not connected.");
    const accessToken = await this.accessToken(context, connection);
    let listing: GmailList;
    try { listing = await this.gmailJson<GmailList>(accessToken, `/gmail/v1/users/me/messages?maxResults=${maxMessages}`); }
    catch (error) { await this.markConnectionError(context, "GMAIL_LIST_FAILED"); throw error; }
    let importedMessages = 0, downloadedAttachments = 0, skippedAttachments = 0;
    for (const reference of listing.messages ?? []) {
      const message = await this.gmailJson<GmailMessage>(accessToken, `/gmail/v1/users/me/messages/${encodeURIComponent(reference.id)}?format=full`);
      const result = await this.persistMessage(context, accessToken, message);
      importedMessages += result.imported ? 1 : 0;
      downloadedAttachments += result.downloaded;
      skippedAttachments += result.skipped;
    }
    const receipt = { importedMessages, downloadedAttachments, skippedAttachments, replayed: false };
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await tx.inboundEvidenceGmailConnection.update({ where: { tenantId: context.tenantId }, data: { lastSyncedAt: new Date(), ...(listing.historyId ? { gmailHistoryId: listing.historyId } : {}), lastErrorCode: null, updatedByUserId: context.actorUserId } });
      await tx.inboundEvidenceCommandReceipt.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, operation: "inbound_evidence.gmail.sync", idempotencyKey, requestHash, responseJson: { importedMessages, downloadedAttachments, skippedAttachments }, expiresAt: new Date(Date.now() + 86_400_000) } });
      await this.audit(tx, context, "inbound_evidence.gmail.synced", "InboundEvidenceGmailConnection", context.tenantId, null, { importedMessages, downloadedAttachments, skippedAttachments });
    });
    return receipt;
  }

  async messages(context: TrustedTenantAdministratorContext) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const rows = await tx.inboundEvidenceMessage.findMany({ where: { tenantId: context.tenantId }, orderBy: [{ receivedAt: "desc" }, { importedAt: "desc" }], take: 100, include: { labels: { include: { label: { include: { _count: { select: { rules: true } } } } } }, attachments: { orderBy: { createdAt: "asc" } } } });
      return { messages: rows.map((message) => ({ id: message.id, sender: message.sender, subject: message.subject, snippet: message.snippet, receivedAt: message.receivedAt?.toISOString() ?? null, hasAttachments: message.hasAttachments, labels: message.labels.map((item) => ({ id: item.label.id, nameAr: item.label.nameAr, nameEn: item.label.nameEn, colorHex: item.label.colorHex })), attachments: message.attachments.map((attachment) => ({ id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, byteSize: attachment.byteSize.toString(), status: attachment.status })) })) };
    });
  }

  async downloadAttachment(context: TrustedTenantAdministratorContext, attachmentId: string) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const attachment = await tx.inboundEvidenceAttachment.findFirst({ where: { id: attachmentId, tenantId: context.tenantId }, select: { id: true, status: true, storageReference: true, encryptionIv: true, mimeType: true, fileName: true } });
      if (!attachment || attachment.status !== "STORED" || !attachment.storageReference || !attachment.encryptionIv) throw new NotFoundException("A readable attachment is not available.");
      const bytes = this.decryptBytes(await readFile(this.storagePath(attachment.storageReference)), attachment.encryptionIv);
      await this.audit(tx, context, "inbound_evidence.attachment.downloaded", "InboundEvidenceAttachment", attachment.id, null, { mimeType: attachment.mimeType });
      return { bytes, mimeType: attachment.mimeType, fileName: attachment.fileName };
    });
  }

  /** Internal-only plaintext access for the governed document-intelligence
   * service. It deliberately never becomes an HTTP download route. */
  async readAttachmentForAnalysis(context: TrustedTenantAdministratorContext, attachmentId: string) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const attachment = await tx.inboundEvidenceAttachment.findFirst({ where: { id: attachmentId, tenantId: context.tenantId }, select: { id: true, status: true, storageReference: true, encryptionIv: true, mimeType: true, fileName: true, sha256: true, retentionUntil: true } });
      if (!attachment || attachment.status !== "STORED" || !attachment.storageReference || !attachment.encryptionIv || !attachment.sha256) throw new NotFoundException("A safe attachment is not available for analysis.");
      if (attachment.retentionUntil && attachment.retentionUntil <= new Date()) throw new NotFoundException("The attachment retention period has ended.");
      return { id: attachment.id, mimeType: attachment.mimeType, fileName: attachment.fileName, sha256: attachment.sha256, bytes: this.decryptBytes(await readFile(this.storagePath(attachment.storageReference)), attachment.encryptionIv) };
    });
  }

  private async persistMessage(context: TrustedTenantAdministratorContext, accessToken: string, source: GmailMessage) {
    const headers = new Map((source.payload?.headers ?? []).map((header) => [header.name?.toLowerCase() ?? "", header.value?.trim() ?? ""]));
    const parts = this.attachments(source.payload);
    const sender = headers.get("from") || null, subject = headers.get("subject") || null;
    const receivedAt = source.internalDate && /^\d+$/.test(source.internalDate) ? new Date(Number(source.internalDate)) : null;
    const rawChecksum = this.hash({ id: source.id, thread: source.threadId ?? null, sender, subject, snippet: source.snippet ?? null, internalDate: source.internalDate ?? null, parts: parts.map((part) => [part.attachmentId, part.fileName, part.mimeType, part.size]) });
    const message = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.inboundEvidenceMessage.upsert({ where: { tenantId_gmailMessageId: { tenantId: context.tenantId, gmailMessageId: source.id } }, create: { id: randomUUID(), tenantId: context.tenantId, gmailMessageId: source.id, gmailThreadId: source.threadId ?? null, sender: this.trim(sender, 600), subject: this.trim(subject, 998), snippet: this.trim(source.snippet ?? null, 10_000), receivedAt, hasAttachments: parts.length > 0, rawChecksum }, update: { gmailThreadId: source.threadId ?? null, sender: this.trim(sender, 600), subject: this.trim(subject, 998), snippet: this.trim(source.snippet ?? null, 10_000), receivedAt, hasAttachments: parts.length > 0, rawChecksum } }));
    let downloaded = 0, skipped = 0;
    for (const part of parts) {
      const found = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.inboundEvidenceAttachment.findFirst({ where: { tenantId: context.tenantId, messageId: message.id, gmailAttachmentId: part.attachmentId }, select: { id: true } }));
      if (found) continue;
      const outcome = await this.persistAttachment(context, accessToken, source.id, message.id, part);
      if (outcome === "downloaded") downloaded++; else skipped++;
    }
    await this.applyRules(context, message.id, sender, subject, parts.length > 0);
    return { imported: true, downloaded, skipped };
  }

  private async persistAttachment(context: TrustedTenantAdministratorContext, accessToken: string, gmailMessageId: string, messageId: string, part: AttachmentPart) {
    const safe = this.supportedMime(part.mimeType);
    if (!safe || part.size > MAX_ATTACHMENT_BYTES) {
      await this.createAttachmentRecord(context, messageId, part, safe ? "TOO_LARGE" : "UNSUPPORTED", null);
      return "skipped" as const;
    }
    const source = await this.gmailJson<GmailAttachment>(accessToken, `/gmail/v1/users/me/messages/${encodeURIComponent(gmailMessageId)}/attachments/${encodeURIComponent(part.attachmentId)}`);
    if (!source.data) { await this.createAttachmentRecord(context, messageId, part, "FAILED", null); return "skipped" as const; }
    const bytes = Buffer.from(source.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || !this.mimeMatches(bytes, part.mimeType)) { await this.createAttachmentRecord(context, messageId, part, bytes.length > MAX_ATTACHMENT_BYTES ? "TOO_LARGE" : "QUARANTINED", null); return "skipped" as const; }
    const scan = await this.scan(bytes);
    const attachmentId = randomUUID();
    const reference = `${STORAGE_NAMESPACE}/${context.tenantId}/${attachmentId}.bin`;
    const encrypted = this.encryptBytes(bytes);
    let stored = false;
    try {
      await this.writeStorage(reference, encrypted.bytes); stored = true;
      await this.createAttachmentRecord(context, messageId, part, scan.status, { attachmentId, reference, iv: encrypted.iv, sha256: this.hashBytes(bytes), scannerName: scan.name, scannerResult: scan.result, byteSize: bytes.length });
    } catch (error) { if (stored) await unlink(this.storagePath(reference)).catch(() => undefined); throw error; }
    return scan.status === "STORED" ? "downloaded" as const : "skipped" as const;
  }

  private async createAttachmentRecord(context: TrustedTenantAdministratorContext, messageId: string, part: AttachmentPart, status: "STORED" | "QUARANTINED" | "UNSUPPORTED" | "TOO_LARGE" | "FAILED", stored: { attachmentId: string; reference: string; iv: string; sha256: string; scannerName: string; scannerResult: string; byteSize: number } | null) {
    await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.inboundEvidenceAttachment.create({ data: { id: stored?.attachmentId ?? randomUUID(), tenantId: context.tenantId, messageId, gmailAttachmentId: part.attachmentId, gmailPartId: part.partId, fileName: this.safeName(part.fileName), mimeType: part.mimeType, byteSize: BigInt(stored?.byteSize ?? part.size), status, sha256: stored?.sha256 ?? null, storageReference: stored?.reference ?? null, encryptionIv: stored?.iv ?? null, scannerName: stored?.scannerName ?? null, scannerResult: stored?.scannerResult ?? null, retentionUntil: stored ? new Date(Date.now() + 30 * 86_400_000) : null, downloadedAt: stored ? new Date() : null } }));
  }

  private async applyRules(context: TrustedTenantAdministratorContext, messageId: string, sender: string | null, subject: string | null, hasAttachment: boolean) {
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const rules = await tx.inboundEvidenceRule.findMany({ where: { tenantId: context.tenantId, enabled: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
      const lowerSender = sender?.toLowerCase() ?? "", lowerSubject = subject?.toLowerCase() ?? "";
      const labelIds = rules.filter((rule) => (!rule.senderContains || lowerSender.includes(rule.senderContains)) && (!rule.subjectContains || lowerSubject.includes(rule.subjectContains)) && (rule.attachmentCondition === "ANY" || (rule.attachmentCondition === "REQUIRED") === hasAttachment)).map((rule) => rule.labelId);
      await tx.inboundEvidenceMessageLabel.deleteMany({ where: { tenantId: context.tenantId, messageId, appliedBy: "RULE" } });
      if (labelIds.length) await tx.inboundEvidenceMessageLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ tenantId: context.tenantId, messageId, labelId, appliedBy: "RULE" })), skipDuplicates: true });
    });
  }

  private attachments(part: GmailPart | undefined): AttachmentPart[] {
    if (!part) return [];
    const nested = (part.parts ?? []).flatMap((child) => this.attachments(child));
    if (!part.body?.attachmentId || !part.filename?.trim() || !part.mimeType || !part.partId) return nested;
    return [{ attachmentId: part.body.attachmentId, partId: part.partId, mimeType: part.mimeType.toLowerCase(), fileName: part.filename.trim(), size: Number(part.body.size ?? 0) }, ...nested];
  }

  private async accessToken(context: TrustedTenantAdministratorContext, connection: { credentialCiphertext: string | null; credentialIv: string | null; credentialTag: string | null; accessTokenExpiresAt: Date | null }) {
    const credential = JSON.parse(this.decryptText({ ciphertext: connection.credentialCiphertext!, iv: connection.credentialIv!, tag: connection.credentialTag! })) as Credential;
    if (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.valueOf() > Date.now() + 60_000) return credential.accessToken;
    const config = this.config();
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: credential.refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => ({})) as GmailToken;
    if (!response.ok || !token.access_token) { await this.markConnectionError(context, "GMAIL_REFRESH_FAILED", "REAUTH_REQUIRED"); throw new BadGatewayException("Gmail authorization needs to be renewed."); }
    const refreshed = this.encryptText(JSON.stringify({ accessToken: token.access_token, refreshToken: credential.refreshToken } satisfies Credential));
    await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.inboundEvidenceGmailConnection.update({ where: { tenantId: context.tenantId }, data: { credentialCiphertext: refreshed.ciphertext, credentialIv: refreshed.iv, credentialTag: refreshed.tag, accessTokenExpiresAt: new Date(Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000), updatedByUserId: context.actorUserId } }));
    return token.access_token;
  }

  private async exchangeCode(config: ReturnType<InboundEvidenceGmailService["config"]>, code: string, verifier: string) {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: verifier }), signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => ({})) as GmailToken;
    if (!response.ok) throw new BadGatewayException("Gmail rejected the authorization code.");
    return token;
  }

  private async gmailJson<T>(accessToken: string, path: string): Promise<T> {
    const response = await fetch(`https://gmail.googleapis.com${path}`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new BadGatewayException(`Gmail request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }

  private config() {
    const clientId = process.env.BASEER_GMAIL_OAUTH_CLIENT_ID?.trim(), clientSecret = process.env.BASEER_GMAIL_OAUTH_CLIENT_SECRET?.trim(), redirectUri = process.env.BASEER_GMAIL_OAUTH_REDIRECT_URI?.trim();
    if (process.env.BASEER_GMAIL_OAUTH_ENABLED !== "true" || !clientId || !clientSecret || !redirectUri) throw new ServiceUnavailableException("Gmail platform configuration is incomplete.");
    try { new URL(redirectUri); } catch { throw new ServiceUnavailableException("Gmail redirect URI is invalid."); }
    this.key(); this.storageKey();
    return { clientId, clientSecret, redirectUri };
  }
  private validUrl(value: string | null) { try { return Boolean(value && new URL(value)); } catch { return false; } }
  private key() { return this.readKey("BASEER_INBOUND_EVIDENCE_ENCRYPTION_KEY"); }
  private storageKey() { return this.readKey("BASEER_INBOUND_EVIDENCE_STORAGE_ENCRYPTION_KEY"); }
  private readKey(name: string) { const raw = process.env[name]; const key = raw ? Buffer.from(raw, "base64") : null; if (!key || key.length !== 32 || key.toString("base64") !== raw) throw new ServiceUnavailableException(`${name} must be a 32-byte base64 key.`); return key; }
  private encryptText(value: string) { return this.encrypt(value, this.key()); }
  private decryptText(value: { ciphertext: string; iv: string; tag: string }) { return this.decrypt(value, this.key()).toString("utf8"); }
  private encryptBytes(value: Buffer) { const encrypted = this.encrypt(value, this.storageKey()); return { bytes: Buffer.concat([Buffer.from(encrypted.ciphertext, "base64"), Buffer.from(encrypted.tag, "base64")]), iv: encrypted.iv }; }
  private decryptBytes(value: Buffer, iv: string) { if (value.length < 17) throw new NotFoundException("The stored attachment is invalid."); return this.decrypt({ ciphertext: value.subarray(0, -16).toString("base64"), iv, tag: value.subarray(-16).toString("base64") }, this.storageKey()); }
  private encrypt(value: string | Buffer, key: Buffer) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]); return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") }; }
  private decrypt(value: { ciphertext: string; iv: string; tag: string }, key: Buffer) { const iv = Buffer.from(value.iv, "base64"), tag = Buffer.from(value.tag, "base64"); if (iv.length !== 12 || tag.length !== 16) throw new NotFoundException("The encrypted evidence is invalid."); const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag); try { return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]); } catch { throw new NotFoundException("The encrypted evidence cannot be read."); } }
  private async scan(bytes: Buffer) { if (process.env.NODE_ENV !== "production" && process.env.BASEER_DOCUMENT_DEV_SCANNER === "deterministic-content-validator") return { status: "STORED" as const, name: "deterministic-development-content-validator", result: "FORMAT_VALIDATED_NOT_ANTIVIRUS" }; const endpoint = process.env.BASEER_DOCUMENT_SCANNER_ENDPOINT; if (!endpoint) return { status: "QUARANTINED" as const, name: "scanner-unavailable", result: "NO_ANTIVIRUS_SCANNER_CONFIGURED" }; try { const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(10_000) }); const result = await response.json() as { status?: string; scannerName?: string; result?: string }; if (!response.ok || (result.status !== "READY" && result.status !== "QUARANTINED")) throw new Error(); return { status: result.status === "READY" ? "STORED" as const : "QUARANTINED" as const, name: result.scannerName?.slice(0, 120) || "configured-scanner", result: result.result?.slice(0, 240) || result.status }; } catch { return { status: "QUARANTINED" as const, name: "configured-scanner-unavailable", result: "SCANNER_UNAVAILABLE_OR_INVALID_RESPONSE" }; } }
  private supportedMime(value: string) { return ["application/pdf", "image/jpeg", "image/png", "text/plain", "text/csv"].includes(value); }
  private mimeMatches(bytes: Buffer, mime: string) { if (mime === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-"; if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); return mime === "text/plain" || mime === "text/csv"; }
  private safeName(value: string) { return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 500) || "attachment"; }
  private async writeStorage(reference: string, bytes: Buffer) { const target = this.storagePath(reference); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" }); }
  private storagePath(reference: string) { if (!new RegExp(`^${STORAGE_NAMESPACE}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.bin$`).test(reference)) throw new ForbiddenException("Unsafe inbound-evidence storage reference."); const target = resolve(this.root, ...reference.split("/")); if (!target.startsWith(`${this.root}${sep}`)) throw new ForbiddenException("Unsafe inbound-evidence storage path."); return target; }
  private async markConnectionError(context: TrustedTenantAdministratorContext, code: string, status?: "REAUTH_REQUIRED") { await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.inboundEvidenceGmailConnection.updateMany({ where: { tenantId: context.tenantId }, data: { lastErrorCode: code, ...(status ? { status } : {}) } })); }
  private async publicConnection(tenantId: string, connection: { status: string; mailboxEmail: string | null; lastSyncedAt: Date | null } | null, tx: Prisma.TransactionClient) { const [messageCount, attachmentCount] = await Promise.all([tx.inboundEvidenceMessage.count({ where: { tenantId } }), tx.inboundEvidenceAttachment.count({ where: { tenantId } })]); const status = connection?.status ?? "NOT_CONNECTED"; const messageAr = status === "CONNECTED" ? "Gmail متصل للقراءة فقط. يمكنك مزامنة الرسائل والمرفقات من هذه الواجهة." : status === "AUTHORIZING" ? "بانتظار إكمال موافقة Gmail في نافذة Google." : status === "REAUTH_REQUIRED" ? "يلزم إعادة تفويض Gmail قبل استمرار المزامنة." : "Gmail غير متصل. لا تدخل كلمات مرور أو مفاتيح في Baseer؛ ابدأ الموافقة من الواجهة بعد إعداد منصة Google."; const messageEn = status === "CONNECTED" ? "Gmail is connected read-only. Messages and attachments can be synchronized here." : status === "AUTHORIZING" ? "Complete Gmail consent in the Google window." : status === "REAUTH_REQUIRED" ? "Reconnect Gmail before synchronization can continue." : "Gmail is not connected. Do not enter passwords or secrets in Baseer; start consent from the UI after the Google platform is configured."; return { status, mailboxEmail: connection?.mailboxEmail ?? null, lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null, messageCount, attachmentCount, messageAr, messageEn }; }
  private async audit(tx: Prisma.TransactionClient, context: TrustedTenantAdministratorContext, action: string, entityType: string, entityId: string, beforeJson: unknown, afterJson: unknown) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson === null ? Prisma.JsonNull : beforeJson as Prisma.InputJsonValue, afterJson: afterJson === null ? Prisma.JsonNull : afterJson as Prisma.InputJsonValue } }); }
  private hash(value: unknown) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
  private hashBytes(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }
  private trim(value: string | null, limit: number) { const next = value?.trim(); return next ? next.slice(0, limit) : null; }
  private ownerOnly(context: TrustedTenantAdministratorContext) { if (!context.isOwner) throw new ForbiddenException("Tenant-owner access is required."); }
}
