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
  /**
   * Baileys appends messages sent by the linked account.  Keep the precise
   * first complete second after this socket becomes live. Baileys timestamps
   * have second precision, so the opening second itself is deliberately
   * excluded rather than risking a historical row from that same second.
   */
  liveSinceAtSeconds: number | null;
  stopped: boolean;
  processing: boolean;
  authRowVersion: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  workTimer: ReturnType<typeof setInterval> | null;
  saveChain: Promise<void>;
};

type MessageUpsertEvent = Readonly<{
  type: string;
  messages: readonly WAMessage[];
}>;

/**
 * Select only events that are safe for the live, no-history invoice monitor.
 *
 * Group members' new messages arrive as `notify`.  A message sent from the
 * linked personal account arrives as `append` in Baileys, so it is accepted
 * only when its WhatsApp timestamp is at or after the first full second after
 * this socket became online.
 * Historical appended rows and every appended message from another account
 * remain excluded.
 */
export function selectLiveInvoiceMessages(event: MessageUpsertEvent, liveSinceAtSeconds: number | null): readonly WAMessage[] {
  if (event.type === "notify") return event.messages;
  if (event.type !== "append" || liveSinceAtSeconds === null) return [];
  return event.messages.filter((message) => {
    if (!message.key.fromMe) return false;
    const sentAtSeconds = Number(message.messageTimestamp);
    return Number.isSafeInteger(sentAtSeconds) && sentAtSeconds >= liveSinceAtSeconds;
  });
}

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
  private shuttingDown = false;

  constructor(
    private readonly foundation: WhatsappInvoiceBaileysPilotFoundationService,
    private readonly assetStorage: WhatsappInvoiceAssetStorageService,
  ) {}

  onModuleInit(): void {
    // Pairing remains an explicit, authorized UI action.  A previously paired
    // receive-only connection is different: it must recover after an API
    // restart so an ordinary deployment never acts like the user stopped it.
    this.shuttingDown = false;
    if (!this.enabled()) return;
    void this.resumePersistedConnections().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    // Do not write the durable user-stop intent during a service shutdown.
    // `dispose` closes locally and releases the fenced lease; startup recovery
    // may claim the expired lease only for CONNECTED/GAP_DETECTED states.
    await Promise.all([...this.active.values()].map((connection) => this.dispose(connection)));
  }

  async start(scope: WhatsappInvoiceConnectionScope, resumeOnly = false): Promise<void> {
    if (this.shuttingDown) return;
    this.assertEnabled();
    const key = this.connectionKey(scope);
    const scheduled = this.reconnectTimers.get(key);
    if (scheduled) {
      clearTimeout(scheduled);
      this.reconnectTimers.delete(key);
    }
    if (this.active.has(key)) return;

    const ownerToken = randomUUID();
    const acquired = await this.foundation.acquireConnectionLease({ ...scope, ownerToken, ttlMs: CONNECTION_LEASE_MS, resumeOnly });
    if (!acquired.acquired || acquired.fence === undefined) {
      if (resumeOnly) {
        if (acquired.expiresAt && acquired.expiresAt > new Date()) this.scheduleLeaseRecheck(scope, acquired.expiresAt);
        return;
      }
      throw new ServiceUnavailableException("The WhatsApp connection is active on another worker.");
    }

    try {
      this.assetStorage.assertIngestionReady();
      const active = await this.createActiveConnection(scope, ownerToken, acquired.fence, acquired.requiresFreshPairing === true);
      this.active.set(key, active);
      if (this.shuttingDown) {
        await this.dispose(active);
        return;
      }
      active.heartbeatTimer = setInterval(() => { void this.heartbeat(active); }, Math.floor(CONNECTION_LEASE_MS / 3));
      active.workTimer = setInterval(() => { void this.processNextWorkItem(active); }, 2_000);
      void this.processNextWorkItem(active);
    } catch (error) {
      // A startup recovery owns this fenced lease at this point.  Make an
      // unavailable storage/session/runtime prerequisite visible instead of
      // leaving a stale CONNECTED badge while no socket exists.  A manual
      // start retains its original error contract for the settings dialog.
      if (resumeOnly) await this.foundation.setConnectionStatus({ ...scope, ownerToken, fence: acquired.fence, status: "GAP_DETECTED" }).catch(() => undefined);
      await this.foundation.releaseConnectionLease({ ...scope, ownerToken, fence: acquired.fence });
      throw error;
    }
  }

  async stop(scope: WhatsappInvoiceConnectionScope): Promise<void> {
    const scheduled = this.reconnectTimers.get(this.connectionKey(scope));
    if (scheduled) {
      clearTimeout(scheduled);
      this.reconnectTimers.delete(this.connectionKey(scope));
    }
    await this.foundation.requestConnectionStop(scope);
    const connection = this.active.get(this.connectionKey(scope));
    if (!connection) return;
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

  private async createActiveConnection(scope: WhatsappInvoiceConnectionScope, ownerToken: string, fence: bigint, freshPairing = false): Promise<ActiveConnection> {
    const persisted = await this.foundation.loadAuthState<PersistedAuthenticationState>(scope);
    // `REAUTH_REQUIRED` is a durable signal from WhatsApp, not a transient
    // network gap.  The authorized, explicit QR action starts fresh creds in
    // memory so Baileys can issue a new QR.  The old encrypted row remains
    // intact until a fenced `creds.update` from the successful scan replaces
    // it.  Automatic reconnects cannot opt into this path.
    const restored = freshPairing ? { creds: initAuthCreds(), keys: {} } : persisted ? revive(persisted.state) : { creds: initAuthCreds(), keys: {} };
    const active: ActiveConnection = {
      scope, ownerToken, fence, socket: undefined as unknown as WASocket, qr: null, qrExpiresAt: null,
      liveSinceAtSeconds: null, stopped: false, processing: false, authRowVersion: persisted?.rowVersion ?? 0, heartbeatTimer: null, workTimer: null, saveChain: Promise.resolve(),
    };
    const auth = this.authenticationState(restored, () => this.persistAuthentication(active, restored));
    const socket = makeWASocket({ auth, markOnlineOnConnect: false, syncFullHistory: false, shouldIgnoreJid: (jid) => !jid.endsWith("@g.us") });
    active.socket = socket;

    socket.ev.on("creds.update", () => { void this.persistAuthentication(active, restored).catch(() => this.dispose(active)); });
    socket.ev.on("connection.update", (update) => {
      if (active.stopped) return;
      if (update.qr) {
        active.qr = update.qr;
        active.qrExpiresAt = new Date(Date.now() + QR_TTL_MS);
      }
      if (update.connection === "open") {
        active.qr = null;
        active.qrExpiresAt = null;
        // Message timestamps have only whole-second precision.  Suppressing
        // the open second closes the only timestamp ambiguity with an
        // immediately appended historical row without enabling history sync.
        active.liveSinceAtSeconds = Math.floor(Date.now() / 1_000) + 1;
        this.reconnectAttempts.delete(this.connectionKey(active.scope));
        void this.foundation.setConnectionStatus({ ...active.scope, ownerToken: active.ownerToken, fence: active.fence, status: "CONNECTED" }).catch(() => undefined);
      }
      if (update.connection === "close") void this.handleClosedConnection(active, update.lastDisconnect?.error);
    });
    socket.ev.on("messages.upsert", (event) => {
      for (const message of selectLiveInvoiceMessages(event, active.liveSinceAtSeconds)) {
        void this.receiveMessage(active, message).catch(() => undefined);
      }
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
      // `creds.update` can be queued immediately before a pairing socket emits
      // `close`.  Once queued, it is a durability barrier: dispose waits for it
      // before releasing the fenced lease and starting a replacement socket.
      // Do not discard that update merely because disposal has stopped new work.
      const saved = await this.foundation.saveAuthStateOwned({
        ...active.scope, ownerToken: active.ownerToken, fence: active.fence,
        expectedRowVersion: active.authRowVersion, state: serialize(state),
      });
      active.authRowVersion = saved.rowVersion;
    });
    return active.saveChain;
  }

  private async receiveMessage(active: ActiveConnection, message: WAMessage): Promise<void> {
    if (active.stopped || !message.key.remoteJid?.endsWith("@g.us") || !message.key.id || !message.message) return;
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
    if (!this.enabled() || this.shuttingDown) return;
    const key = this.connectionKey(scope);
    if (this.reconnectTimers.has(key)) return;
    const attempt = (this.reconnectAttempts.get(key) ?? 0) + 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) return;
    this.reconnectAttempts.set(key, attempt);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(key);
      void this.start(scope, true).catch(() => this.scheduleReconnect(scope));
    }, Math.min(60_000, 2_000 * (2 ** (attempt - 1))) + randomInt(0, MAX_RECONNECT_JITTER_MS + 1));
    this.reconnectTimers.set(key, timer);
  }

  /** A restart can observe a still-valid lease from a process that died without
   * shutdown.  Wait only until that lease expires, then re-run the fenced
   * recovery path; a durable user stop remains rejected by the claim itself. */
  private scheduleLeaseRecheck(scope: WhatsappInvoiceConnectionScope, expiresAt: Date): void {
    if (!this.enabled() || this.shuttingDown) return;
    const key = this.connectionKey(scope);
    if (this.reconnectTimers.has(key)) return;
    const delay = Math.max(0, expiresAt.valueOf() - Date.now()) + randomInt(0, MAX_RECONNECT_JITTER_MS + 1);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(key);
      if (this.shuttingDown) return;
      void this.start(scope, true).catch(() => undefined);
    }, delay);
    this.reconnectTimers.set(key, timer);
  }

  private async resumePersistedConnections(): Promise<void> {
    if (this.shuttingDown) return;
    const scopes = await this.foundation.resumableConnectionScopes();
    await Promise.all(scopes.map(async (scope) => {
      try {
        if (this.shuttingDown) return;
        await this.start(scope, true);
      } catch {
        // A competing owner, missing runtime prerequisite, or transient
        // transport failure is safe to leave visible through its durable state.
        // No QR is generated and no manual stop can be overridden here.
      }
    }));
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
