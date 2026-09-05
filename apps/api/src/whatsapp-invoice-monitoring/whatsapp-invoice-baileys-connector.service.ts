import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import {
  BufferJSON,
  DisconnectReason,
  downloadContentFromMessage,
  initAuthCreds,
  makeWASocket,
  type AuthenticationCreds,
  type AuthenticationState,
  type DownloadableMessage,
  type MediaType,
  type SignalDataSet,
  type SignalKeyStore,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { randomInt, randomUUID } from "node:crypto";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { WhatsappInvoiceAssetStorageService } from "./whatsapp-invoice-asset-storage.service.js";
import {
  type WhatsappInvoiceConnectionScope,
  WhatsappInvoiceBaileysPilotFoundationService,
} from "./whatsapp-invoice-baileys-pilot-foundation.service.js";

const CONNECTION_LEASE_MS = 45_000;
const WORK_ITEM_LEASE_MS = 60_000;
const QR_TTL_MS = 60_000;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_JITTER_MS = 1_000;

type PersistedAuthenticationState = Readonly<{
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
}>;

type TransportMetadata = Readonly<{
  mediaKey: string;
  directPath?: string;
  url?: string;
  mediaType: "image" | "document";
}>;

type ActiveConnection = {
  readonly scope: WhatsappInvoiceConnectionScope;
  readonly ownerToken: string;
  readonly fence: bigint;
  socket: WASocket;
  qr: string | null;
  qrExpiresAt: Date | null;
  stopped: boolean;
  processing: boolean;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  workTimer: ReturnType<typeof setInterval> | null;
  saveChain: Promise<void>;
};

/**
 * The live, receive-only Baileys boundary for the personal pilot.
 *
 * It is deliberately dormant unless BASEER_WAI_BAILEYS_PILOT_ENABLED=true.
 * QR values never cross this service's persistence boundary, and no chat text,
 * caption, sender profile, send/reply, or OCR path is present here.
 */
@Injectable()
export class WhatsappInvoiceBaileysPilotConnectorService implements OnModuleInit, OnModuleDestroy {
  private readonly active = new Map<string, ActiveConnection>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reconnectAttempts = new Map<string, number>();

  constructor(
    private readonly foundation: WhatsappInvoiceBaileysPilotFoundationService,
    private readonly assetStorage: WhatsappInvoiceAssetStorageService,
  ) {}

  onModuleInit(): void {
    // This is intentionally an opt-in connector. It does not scan, reconnect,
    // or pair an account on API startup; an authorized settings flow invokes start.
    if (!this.enabled()) return;
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    await Promise.all([...this.active.values()].map((connection) => this.stop(connection.scope)));
  }

  async start(scope: WhatsappInvoiceConnectionScope): Promise<void> {
    this.assertEnabled();
    this.assetStorage.assertIngestionReady();
    const key = this.connectionKey(scope);
    const scheduled = this.reconnectTimers.get(key);
    if (scheduled) {
      clearTimeout(scheduled);
      this.reconnectTimers.delete(key);
    }
    if (this.active.has(key)) return;

    const ownerToken = randomUUID();
    const acquired = await this.foundation.acquireConnectionLease({ ...scope, ownerToken, ttlMs: CONNECTION_LEASE_MS });
    if (!acquired.acquired || acquired.fence === undefined) throw new ServiceUnavailableException("The WhatsApp connection is active on another worker.");

    try {
      const active = await this.createActiveConnection(scope, ownerToken, acquired.fence);
      this.active.set(key, active);
      active.heartbeatTimer = setInterval(() => { void this.heartbeat(active); }, Math.floor(CONNECTION_LEASE_MS / 3));
      active.workTimer = setInterval(() => { void this.processNextWorkItem(active); }, 2_000);
      void this.processNextWorkItem(active);
    } catch (error) {
      await this.foundation.releaseConnectionLease({ ...scope, ownerToken, fence: acquired.fence });
      throw error;
    }
  }

  async stop(scope: WhatsappInvoiceConnectionScope): Promise<void> {
    const connection = this.active.get(this.connectionKey(scope));
    if (!connection) return;
    await this.foundation.setConnectionStatus({ ...connection.scope, ownerToken: connection.ownerToken, fence: connection.fence, status: "DISCONNECTED" }).catch(() => undefined);
    await this.dispose(connection);
  }

  qr(scope: WhatsappInvoiceConnectionScope): Readonly<{ qr: string | null; expiresAt: Date | null }> {
    if (!this.enabled()) return { qr: null, expiresAt: null };
    const active = this.active.get(this.connectionKey(scope));
    if (!active || !active.qr || !active.qrExpiresAt || active.qrExpiresAt <= new Date()) return { qr: null, expiresAt: null };
    return { qr: active.qr, expiresAt: active.qrExpiresAt };
  }

  /** Lists only group identity needed by the settings picker; no messages or chat history leave Baileys. */
  async groups(scope: WhatsappInvoiceConnectionScope): Promise<Array<Readonly<{ jid: string; displayName: string }>>> {
    this.assertEnabled();
    const active = this.active.get(this.connectionKey(scope));
    if (!active || active.stopped) return [];
    const groups = await active.socket.groupFetchAllParticipating();
    return Object.values(groups)
      .filter((group) => group.id.endsWith("@g.us"))
      .map((group) => ({ jid: group.id, displayName: group.subject?.trim() || group.id }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ar"));
  }

  private async createActiveConnection(scope: WhatsappInvoiceConnectionScope, ownerToken: string, fence: bigint): Promise<ActiveConnection> {
    const persisted = await this.foundation.loadAuthState<PersistedAuthenticationState>(scope);
    const restored = persisted ? revive(persisted.state) : { creds: initAuthCreds(), keys: {} };
    const active: ActiveConnection = {
      scope, ownerToken, fence, socket: undefined as unknown as WASocket, qr: null, qrExpiresAt: null,
      stopped: false, processing: false, heartbeatTimer: null, workTimer: null, saveChain: Promise.resolve(),
    };
    const auth = this.authenticationState(restored, () => this.persistAuthentication(active, restored));
    const socket = makeWASocket({ auth, markOnlineOnConnect: false, syncFullHistory: false, shouldIgnoreJid: (jid) => !jid.endsWith("@g.us") });
    active.socket = socket;

    socket.ev.on("creds.update", () => { void this.persistAuthentication(active, restored); });
    socket.ev.on("connection.update", (update) => {
      if (active.stopped) return;
      if (update.qr) {
        active.qr = update.qr;
        active.qrExpiresAt = new Date(Date.now() + QR_TTL_MS);
      }
      if (update.connection === "open") {
        active.qr = null;
        active.qrExpiresAt = null;
        this.reconnectAttempts.delete(this.connectionKey(active.scope));
        void this.foundation.setConnectionStatus({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence, status: "CONNECTED" }).catch(() => undefined);
      }
      if (update.connection === "close") void this.handleClosedConnection(active, update.lastDisconnect?.error);
    });
    socket.ev.on("messages.upsert", (event) => {
      // This monitor deliberately receives only real-time notifications. It
      // does not ingest history sync/appended chat rows as a catch-up claim.
      if (event.type !== "notify") return;
      for (const message of event.messages) void this.receiveMessage(active, message).catch(() => undefined);
    });
    return active;
  }

  private authenticationState(state: PersistedAuthenticationState, persist: () => Promise<void>): AuthenticationState {
    const keys: SignalKeyStore = {
      get: async (type, ids) => Object.fromEntries(ids.flatMap((id) => {
        const value = state.keys[type]?.[id];
        return value === undefined || value === null ? [] : [[id, value]];
      })) as never,
      set: async (data: SignalDataSet) => {
        for (const [type, values] of Object.entries(data)) {
          if (!values) continue;
          state.keys[type] ??= {};
          for (const [id, value] of Object.entries(values)) {
            if (value === null) delete state.keys[type][id];
            else state.keys[type][id] = value;
          }
        }
        await persist();
      },
    };
    return { creds: state.creds, keys };
  }

  private async persistAuthentication(active: ActiveConnection, state: PersistedAuthenticationState): Promise<void> {
    if (active.stopped) return;
    active.saveChain = active.saveChain.catch(() => undefined).then(async () => {
      if (active.stopped) return;
      await this.foundation.saveAuthState(active.scope, serialize(state));
    });
    return active.saveChain;
  }

  private async receiveMessage(active: ActiveConnection, message: WAMessage): Promise<void> {
    if (active.stopped || message.key.fromMe || !message.key.remoteJid?.endsWith("@g.us") || !message.key.id || !message.message) return;
    const receivedAt = message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1_000) : new Date();
    if (!Number.isFinite(receivedAt.valueOf())) return;
    const groupJid = message.key.remoteJid;
    const image = message.message.imageMessage;
    const document = message.message.documentMessage;
    const candidates: Array<Readonly<{ mimeType: "image/jpeg" | "image/png" | "application/pdf"; originalFileName: string; metadata: TransportMetadata }>> = [];
    if (image && (image.mimetype === "image/jpeg" || image.mimetype === "image/png")) {
      const metadata = this.transportMetadata(image, "image");
      if (metadata) candidates.push({ mimeType: image.mimetype, originalFileName: image.mimetype === "image/png" ? "invoice-image.png" : "invoice-image.jpg", metadata });
    }
    if (document && document.mimetype === "application/pdf") {
      const metadata = this.transportMetadata(document, "document");
      if (metadata) candidates.push({ mimeType: "application/pdf", originalFileName: safePdfName(document.fileName), metadata });
    }
    for (const [attachmentIndex, candidate] of candidates.entries()) {
      await this.foundation.reserveMediaReceipt({
        tenantId: active.scope.tenantId, connectionId: active.scope.connectionId, groupJid,
        whatsappMessageId: message.key.id, receivedAt, attachmentIndex,
        originalFileName: candidate.originalFileName, mimeType: candidate.mimeType, transportMetadata: candidate.metadata,
      });
    }
    if (candidates.length) void this.processNextWorkItem(active);
  }

  private transportMetadata(message: DownloadableMessage, mediaType: "image" | "document"): TransportMetadata | null {
    if (!message.mediaKey || !message.directPath) return null;
    const mediaKey = Buffer.from(message.mediaKey).toString("base64");
    if (!mediaKey) return null;
    return { mediaKey, directPath: message.directPath, ...(message.url ? { url: message.url } : {}), mediaType };
  }

  private async processNextWorkItem(active: ActiveConnection): Promise<void> {
    if (active.stopped || active.processing) return;
    active.processing = true;
    try {
      const item = await this.foundation.claimNextMediaWorkItem({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence, ttlMs: WORK_ITEM_LEASE_MS });
      if (!item) return;
      try {
        const metadata = await this.foundation.loadMediaWorkItemMetadata<TransportMetadata>({ tenantId: active.scope.tenantId, companyId: item.companyId, mediaWorkItemId: item.id });
        const bytes = await this.downloadMedia(metadata);
        const stored = await this.assetStorage.storeTrustedOriginal({ context: internalCompanyContext(active.scope.tenantId, item.companyId), assetId: item.assetId, bytes });
        await this.foundation.completeMediaWorkItem({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence, mediaWorkItemId: item.id, completion: stored.storageState === "READY" ? "STORED" : "QUARANTINED", ...(stored.storageState === "READY" ? {} : { errorCode: "ASSET_QUARANTINED" }) });
      } catch (error) {
        const completion = isTerminalMediaError(error) ? "FINAL_FAILURE" : "RETRYABLE_FAILURE";
        await this.foundation.completeMediaWorkItem({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence, mediaWorkItemId: item.id, completion, errorCode: completion === "FINAL_FAILURE" ? "UNSUPPORTED_MEDIA" : "MEDIA_DOWNLOAD_FAILED" });
      }
    } finally {
      active.processing = false;
    }
  }

  private async downloadMedia(metadata: TransportMetadata): Promise<Buffer> {
    if (!metadata.mediaKey || !metadata.directPath || (metadata.mediaType !== "image" && metadata.mediaType !== "document")) throw new Error("invalid media transport");
    const stream = await downloadContentFromMessage({ mediaKey: Buffer.from(metadata.mediaKey, "base64"), directPath: metadata.directPath, ...(metadata.url ? { url: metadata.url } : {}) }, metadata.mediaType as MediaType);
    const parts: Buffer[] = [];
    let length = 0;
    for await (const part of stream) {
      const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
      length += bytes.byteLength;
      if (length > MAX_MEDIA_BYTES) throw new Error("media exceeds size limit");
      parts.push(bytes);
    }
    if (!length) throw new Error("empty media");
    return Buffer.concat(parts, length);
  }

  private async heartbeat(active: ActiveConnection): Promise<void> {
    if (active.stopped) return;
    const renewed = await this.foundation.heartbeatConnectionLease({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence, ttlMs: CONNECTION_LEASE_MS });
    if (!renewed.acquired) await this.dispose(active);
  }

  private async handleClosedConnection(active: ActiveConnection, error: unknown): Promise<void> {
    const status = connectionStatusAfterClose(error);
    await this.foundation.setConnectionStatus({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence, status }).catch(() => undefined);
    // A QR pairing can close the bootstrap socket before the freshly persisted
    // credentials are reopened. Treat each non-logout close as a bounded
    // recovery gap; `start` builds a new socket from that saved state.
    await this.dispose(active, shouldReconnectAfterClose(error));
  }

  private async dispose(active: ActiveConnection, reconnect = false): Promise<void> {
    if (active.stopped) return;
    active.stopped = true;
    active.qr = null;
    active.qrExpiresAt = null;
    if (active.heartbeatTimer) clearInterval(active.heartbeatTimer);
    if (active.workTimer) clearInterval(active.workTimer);
    this.active.delete(this.connectionKey(active.scope));
    try { active.socket.ws.close(); } catch { /* Baileys may already have closed the transport. */ }
    await active.saveChain.catch(() => undefined);
    await this.foundation.releaseConnectionLease({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence });
    if (reconnect) this.scheduleReconnect(active.scope);
  }

  private scheduleReconnect(scope: WhatsappInvoiceConnectionScope): void {
    if (!this.enabled()) return;
    const key = this.connectionKey(scope);
    if (this.reconnectTimers.has(key)) return;
    const attempt = (this.reconnectAttempts.get(key) ?? 0) + 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) return;
    this.reconnectAttempts.set(key, attempt);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(key);
      void this.start(scope).catch(() => this.scheduleReconnect(scope));
    }, Math.min(60_000, 2_000 * (2 ** (attempt - 1))) + randomInt(0, MAX_RECONNECT_JITTER_MS + 1));
    this.reconnectTimers.set(key, timer);
  }

  private enabled(): boolean { return process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED === "true"; }
  private assertEnabled(): void { if (!this.enabled()) throw new ServiceUnavailableException("The WhatsApp Baileys pilot is disabled."); }
  private connectionKey(scope: WhatsappInvoiceConnectionScope): string { return `${scope.tenantId}:${scope.connectionId}`; }
}

function serialize(state: PersistedAuthenticationState): Record<string, unknown> { return JSON.parse(JSON.stringify(state, BufferJSON.replacer)) as Record<string, unknown>; }
function revive(value: PersistedAuthenticationState): PersistedAuthenticationState { return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as PersistedAuthenticationState; }
function safePdfName(value: string | null | undefined): string { const name = value?.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 180) || "invoice.pdf"; return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`; }
function internalCompanyContext(tenantId: string, companyId: string): TrustedCompanyActorContext { return { tenantId, companyId, actorUserId: "00000000-0000-0000-0000-000000000000" }; }
function isTerminalMediaError(error: unknown): boolean { return error instanceof Error && /size limit|empty media|invalid media transport/i.test(error.message); }
function connectionStatusAfterClose(error: unknown): "GAP_DETECTED" | "REAUTH_REQUIRED" {
  if (disconnectStatusCode(error) === DisconnectReason.loggedOut) return "REAUTH_REQUIRED";
  return "GAP_DETECTED";
}
function shouldReconnectAfterClose(error: unknown): boolean {
  return disconnectStatusCode(error) !== DisconnectReason.loggedOut;
}
function disconnectStatusCode(error: unknown): number {
  const statusCode = typeof error === "object" && error !== null && "output" in error
    ? Number((error as { output?: { statusCode?: unknown } }).output?.statusCode)
    : Number.NaN;
  return statusCode;
}
