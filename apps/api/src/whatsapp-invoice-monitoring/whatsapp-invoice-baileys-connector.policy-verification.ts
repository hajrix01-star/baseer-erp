/** Run after the API build:
 * `node apps/api/dist/whatsapp-invoice-monitoring/whatsapp-invoice-baileys-connector.policy-verification.js`.
 * This verifies close handling only; it opens no socket, database, or HTTP request. */
import assert from "node:assert/strict";

import { DisconnectReason } from "@whiskeysockets/baileys";

import { normalizeInvoiceMessageContent, selectLiveInvoiceMessages, WhatsappInvoiceBaileysPilotConnectorService } from "./whatsapp-invoice-baileys-connector.service.js";
import { WhatsappInvoiceBaileysPilotFoundationService } from "./whatsapp-invoice-baileys-pilot-foundation.service.js";

type CloseHandler = {
  handleClosedConnection(active: unknown, error: unknown): Promise<void>;
  dispose(active: unknown, reconnect?: boolean): Promise<void>;
};

type PersistenceHandler = {
  persistAuthentication(active: unknown, state: unknown): Promise<void>;
};

const onlineAtSeconds = 1_726_000_000;
const firstAcceptedAppendSeconds = onlineAtSeconds + 1;
const ownLiveMessage = {
  key: { fromMe: true, remoteJid: "120363430786105597@g.us", id: "own-live-media" },
  messageTimestamp: firstAcceptedAppendSeconds,
  message: { imageMessage: { mimetype: "image/jpeg" } },
} as never;
const ownHistoricalMessage = {
  key: { fromMe: true, remoteJid: "120363430786105597@g.us", id: "own-old-media" },
  messageTimestamp: onlineAtSeconds,
  message: { imageMessage: { mimetype: "image/jpeg" } },
} as never;
const otherHistoricalAppend = {
  key: { fromMe: false, remoteJid: "120363430786105597@g.us", id: "other-old-media" },
  messageTimestamp: onlineAtSeconds + 1,
  message: { imageMessage: { mimetype: "image/jpeg" } },
} as never;
assert.deepEqual(
  selectLiveInvoiceMessages({ type: "append", messages: [ownHistoricalMessage, ownLiveMessage, otherHistoricalAppend] }, firstAcceptedAppendSeconds),
  [ownLiveMessage],
  "Only a newly sent linked-account message after the opening second may pass an appended event; historical rows remain excluded.",
);
assert.deepEqual(
  selectLiveInvoiceMessages({ type: "notify", messages: [ownLiveMessage] }, firstAcceptedAppendSeconds),
  [ownLiveMessage],
  "A live notification from the linked account must reach the normal group/media filters.",
);
assert.deepEqual(
  selectLiveInvoiceMessages({ type: "append", messages: [ownLiveMessage] }, null),
  [],
  "No appended event may be accepted before this socket is online.",
);
const wrappedInvoiceImage = {
  key: { fromMe: true, remoteJid: "120363430786105597@g.us", id: "wrapped-image" },
  message: { ephemeralMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } } },
} as never;
assert.equal(
  normalizeInvoiceMessageContent(wrappedInvoiceImage)?.imageMessage?.mimetype,
  "image/jpeg",
  "An image inside WhatsApp's ephemeral envelope must reach the same media admission path as a direct image.",
);
const wrappedInvoicePdf = {
  key: { fromMe: true, remoteJid: "120363430786105597@g.us", id: "wrapped-pdf" },
  message: { documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "invoice.pdf" } } } },
} as never;
assert.equal(
  normalizeInvoiceMessageContent(wrappedInvoicePdf)?.documentMessage?.mimetype,
  "application/pdf",
  "A PDF inside WhatsApp's caption envelope must reach the same media admission path as a direct PDF.",
);
const viewOnceInvoiceImage = {
  key: { fromMe: true, remoteJid: "120363430786105597@g.us", id: "view-once-image" },
  message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/png" } } } },
} as never;
assert.equal(
  normalizeInvoiceMessageContent(viewOnceInvoiceImage)?.imageMessage?.mimetype,
  "image/png",
  "An image inside WhatsApp's view-once envelope must reach the same media admission path as a direct image.",
);

const statuses: string[] = [];
const connector = new WhatsappInvoiceBaileysPilotConnectorService(
  { setConnectionStatus: async ({ status }: { status: string }) => { statuses.push(status); } } as never,
  {} as never,
) as unknown as CloseHandler;
const disposed: boolean[] = [];
connector.dispose = async (_active, reconnect = false) => { disposed.push(reconnect); };

await connector.handleClosedConnection({ scope: {}, ownerToken: "owner", fence: 1n }, { output: { statusCode: 500 } });
assert.deepEqual(statuses, ["GAP_DETECTED"], "A transient pairing close must remain visible as a synchronization gap.");
assert.deepEqual(disposed, [true], "A transient pairing close must schedule the bounded reconnect path.");

statuses.length = 0;
disposed.length = 0;
await connector.handleClosedConnection({ scope: {}, ownerToken: "owner", fence: 1n }, { output: { statusCode: DisconnectReason.loggedOut } });
assert.deepEqual(statuses, ["REAUTH_REQUIRED"], "A logout must require an explicit new QR pairing.");
assert.deepEqual(disposed, [false], "A logout must never retry automatically.");

const persistedStates: unknown[] = [];
const persistenceConnector = new WhatsappInvoiceBaileysPilotConnectorService(
  { saveAuthStateOwned: async (input: { state: unknown; expectedRowVersion: number }) => { persistedStates.push(input); return { rowVersion: input.expectedRowVersion + 1 }; } } as never,
  {} as never,
) as unknown as PersistenceHandler;
const pairingActive = { scope: { tenantId: "tenant", connectionId: "connection" }, ownerToken: "owner-token-123456", fence: 1n, authRowVersion: 0, stopped: false, saveChain: Promise.resolve() };
const scheduledPersistence = persistenceConnector.persistAuthentication(pairingActive, { creds: {}, keys: {} });
pairingActive.stopped = true;
await scheduledPersistence;
assert.equal(persistedStates.length, 1, "A credential update queued before disposal must persist before reconnect can rebuild the socket.");
assert.equal((persistedStates[0] as { expectedRowVersion: number }).expectedRowVersion, 0, "The queued save must carry the session row version.");

const previousSessionKey = process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY;
const previousSessionKeyVersion = process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY_VERSION;
process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY_VERSION = "1";
let attemptedSessionWrite = false;
const leaseQueries: unknown[] = [];
const fencedFoundation = new WhatsappInvoiceBaileysPilotFoundationService({
  inTenantTransaction: async (_tenantId: string, operation: (tx: unknown) => Promise<unknown>) => operation({
    whatsappInvoiceConnection: { findFirst: async () => ({ id: "connection" }) },
    whatsappInvoiceConnectionLease: { findFirst: async (query: unknown) => { leaseQueries.push(query); return null; } },
    whatsappInvoiceConnectionSession: { findFirst: async () => null, create: async () => { attemptedSessionWrite = true; return { rowVersion: 1 }; } },
  }),
} as never);
try {
  await assert.rejects(
    () => fencedFoundation.saveAuthStateOwned({ tenantId: "tenant", connectionId: "connection", ownerToken: "owner-token-123456", fence: 2n, state: { creds: {}, keys: {} }, expectedRowVersion: 0 }),
    /lease was lost/,
    "A stale connector must not persist credentials after its lease fence is lost.",
  );
} finally {
  if (previousSessionKey === undefined) delete process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY; else process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY = previousSessionKey;
  if (previousSessionKeyVersion === undefined) delete process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY_VERSION; else process.env.BASEER_WAI_SESSION_ENCRYPTION_KEY_VERSION = previousSessionKeyVersion;
}
assert.equal(attemptedSessionWrite, false, "A lease-failed save must not reach the encrypted session row.");
assert.equal(leaseQueries.length, 1, "The owned save must query exactly one current lease fence.");

const reauthorizationFoundation = new WhatsappInvoiceBaileysPilotFoundationService({
  inTenantTransaction: async (_tenantId: string, operation: (tx: unknown) => Promise<unknown>) => operation({
    whatsappInvoiceConnection: { findFirst: async () => ({ id: "connection", status: "REAUTH_REQUIRED" }) },
    whatsappInvoiceConnectionLease: { findFirst: async () => null, create: async () => ({ fence: 1n, expiresAt: new Date() }) },
  }),
} as never);
const reauthorizationStart = await reauthorizationFoundation.acquireConnectionLease({ tenantId: "tenant", connectionId: "connection", ownerToken: "owner-token-123456", ttlMs: 5_000 });
assert.equal(reauthorizationStart.requiresFreshPairing, true, "An explicit start after WhatsApp logout must request fresh in-memory pairing credentials.");

type StartConnector = {
  start(scope: { tenantId: string; connectionId: string }, resumeOnly?: boolean): Promise<void>;
  createActiveConnection(scope: unknown, ownerToken: unknown, fence: unknown, freshPairing: unknown): Promise<unknown>;
  processNextWorkItem(active: unknown): Promise<void>;
  active: Map<string, { heartbeatTimer: ReturnType<typeof setInterval> | null; workTimer: ReturnType<typeof setInterval> | null }>;
};
const previousPilotEnabled = process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED;
process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED = "true";
const freshPairingArguments: unknown[] = [];
const startConnector = new WhatsappInvoiceBaileysPilotConnectorService(
  { acquireConnectionLease: async (_input: unknown) => ({ acquired: true, fence: 1n, requiresFreshPairing: true }) } as never,
  { assertIngestionReady: () => undefined } as never,
) as unknown as StartConnector;
startConnector.createActiveConnection = async (scope, _ownerToken, _fence, freshPairing) => {
  freshPairingArguments.push(freshPairing);
  return { scope, heartbeatTimer: null, workTimer: null };
};
startConnector.processNextWorkItem = async () => undefined;
try {
  await startConnector.start({ tenantId: "tenant", connectionId: "connection" });
  assert.deepEqual(freshPairingArguments, [true], "The connector must forward fresh pairing only from the manually acquired reauthorization lease.");
} finally {
  for (const active of startConnector.active.values()) {
    if (active.heartbeatTimer) clearInterval(active.heartbeatTimer);
    if (active.workTimer) clearInterval(active.workTimer);
  }
  startConnector.active.clear();
  if (previousPilotEnabled === undefined) delete process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED; else process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED = previousPilotEnabled;
}

let stoppedClaimWhere: unknown;
const stoppedConnectionFoundation = new WhatsappInvoiceBaileysPilotFoundationService({
  inTenantTransaction: async (_tenantId: string, operation: (tx: unknown) => Promise<unknown>) => operation({
    whatsappInvoiceConnection: { findFirst: async () => ({ id: "connection" }) },
    whatsappInvoiceConnectionLease: {
      findFirst: async () => ({ id: "lease", ownerToken: "old-owner", fence: 1n, expiresAt: new Date(0) }),
      updateMany: async (query: { where: unknown }) => { stoppedClaimWhere = query.where; return { count: 0 }; },
    },
  }),
} as never);
const stoppedReconnect = await stoppedConnectionFoundation.acquireConnectionLease({ tenantId: "tenant", connectionId: "connection", ownerToken: "owner-token-123456", ttlMs: 5_000, resumeOnly: true });
assert.equal(stoppedReconnect.acquired, false, "Reconnect must refuse a durable stop intent in the same lease-acquisition transaction.");
assert.deepEqual(
  (stoppedClaimWhere as { connection?: { is?: { status?: { in?: string[] } } } }).connection?.is?.status?.in,
  ["CONNECTED", "GAP_DETECTED"],
  "Startup recovery may claim only a stale healthy connection or visible gap; a user stop remains excluded in the lease claim itself.",
);

const heldLeaseExpiry = new Date(Date.now() + 5_000);
const heldLeaseFoundation = new WhatsappInvoiceBaileysPilotFoundationService({
  inTenantTransaction: async (_tenantId: string, operation: (tx: unknown) => Promise<unknown>) => operation({
    whatsappInvoiceConnection: { findFirst: async () => ({ id: "connection", status: "CONNECTED" }) },
    whatsappInvoiceConnectionLease: { findFirst: async () => ({ id: "lease", ownerToken: "old-owner", fence: 1n, expiresAt: heldLeaseExpiry }) },
  }),
} as never);
const heldLeaseResume = await heldLeaseFoundation.acquireConnectionLease({ tenantId: "tenant", connectionId: "connection", ownerToken: "owner-token-123456", ttlMs: 5_000, resumeOnly: true });
assert.equal(heldLeaseResume.acquired, false, "Recovery must not steal a still-valid lease from another API process.");
assert.equal(heldLeaseResume.expiresAt, heldLeaseExpiry, "A non-owner recovery must learn when to safely retry its fenced lease claim.");

type LeaseRecheckConnector = {
  start(scope: { tenantId: string; connectionId: string }, resumeOnly?: boolean): Promise<void>;
  scheduleLeaseRecheck(scope: unknown, expiresAt: Date): void;
};
const previousLeasePilotEnabled = process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED;
process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED = "true";
const scheduledLeaseRechecks: Array<{ scope: unknown; expiresAt: Date }> = [];
const leaseRecheckConnector = new WhatsappInvoiceBaileysPilotConnectorService(
  { acquireConnectionLease: async () => ({ acquired: false, expiresAt: heldLeaseExpiry }) } as never,
  {} as never,
) as unknown as LeaseRecheckConnector;
leaseRecheckConnector.scheduleLeaseRecheck = (scope, expiresAt) => { scheduledLeaseRechecks.push({ scope, expiresAt }); };
await leaseRecheckConnector.start({ tenantId: "tenant", connectionId: "connection" }, true);
assert.deepEqual(scheduledLeaseRechecks, [{ scope: { tenantId: "tenant", connectionId: "connection" }, expiresAt: heldLeaseExpiry }], "Boot recovery must retry only after a previous owner's lease becomes claimable.");

const failedResumeStates: string[] = [];
const failedResumeConnector = new WhatsappInvoiceBaileysPilotConnectorService(
  {
    acquireConnectionLease: async () => ({ acquired: true, fence: 1n }),
    setConnectionStatus: async ({ status }: { status: string }) => { failedResumeStates.push(status); },
    releaseConnectionLease: async () => true,
  } as never,
  { assertIngestionReady: () => { throw new Error("storage unavailable"); } } as never,
);
await assert.rejects(
  () => failedResumeConnector.start({ tenantId: "tenant", connectionId: "connection" }, true),
  /storage unavailable/,
  "A failed recovery must retain the operational error for its bounded retry caller.",
);
assert.deepEqual(failedResumeStates, ["GAP_DETECTED"], "A recovery failure after claiming the lease must not leave a stale CONNECTED state.");
if (previousLeasePilotEnabled === undefined) delete process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED; else process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED = previousLeasePilotEnabled;

const resumableFoundation = new WhatsappInvoiceBaileysPilotFoundationService({
  listTenantIdsForSystemScheduler: async () => ["tenant-a", "tenant-b"],
  inTenantTransaction: async (tenantId: string, operation: (tx: unknown) => Promise<unknown>) => operation({
    whatsappInvoiceConnection: {
      findMany: async () => tenantId === "tenant-a" ? [{ id: "connection-a" }] : [{ id: "connection-b" }],
    },
  }),
} as never);
assert.deepEqual(
  await resumableFoundation.resumableConnectionScopes(),
  [{ tenantId: "tenant-a", connectionId: "connection-a" }, { tenantId: "tenant-b", connectionId: "connection-b" }],
  "Startup discovery must return connection IDs only, preserving tenant isolation for every later lease claim.",
);

type LifecycleConnector = {
  onModuleInit(): void;
  onModuleDestroy(): Promise<void>;
  resumePersistedConnections(): Promise<void>;
  dispose(active: unknown): Promise<void>;
  active: Map<string, { scope: { tenantId: string; connectionId: string } }>;
  reconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
};
const previousLifecyclePilotEnabled = process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED;
process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED = "true";
const lifecycleConnector = new WhatsappInvoiceBaileysPilotConnectorService({} as never, {} as never) as unknown as LifecycleConnector;
let startupResumes = 0;
lifecycleConnector.resumePersistedConnections = async () => { startupResumes += 1; };
lifecycleConnector.onModuleInit();
await Promise.resolve();
assert.equal(startupResumes, 1, "An enabled API startup must attempt durable, lease-fenced connector recovery.");
const disposedScopes: Array<{ tenantId: string; connectionId: string }> = [];
lifecycleConnector.dispose = async (active) => { disposedScopes.push((active as { scope: { tenantId: string; connectionId: string } }).scope); };
lifecycleConnector.active.set("tenant:connection", { scope: { tenantId: "tenant", connectionId: "connection" } });
await lifecycleConnector.onModuleDestroy();
assert.deepEqual(disposedScopes, [{ tenantId: "tenant", connectionId: "connection" }], "Service shutdown must dispose locally without issuing a durable user stop.");
if (previousLifecyclePilotEnabled === undefined) delete process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED; else process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED = previousLifecyclePilotEnabled;

console.log(JSON.stringify({ ok: true, verified: ["live-own-media-is-not-dropped", "historical-appends-remain-excluded", "wrapped-invoice-media-is-normalized", "transient-pairing-close-reconnects", "logout-does-not-reconnect", "queued-pairing-credentials-survive-dispose", "stale-owner-cannot-persist-session", "reauthentication-starts-fresh-qr", "stopped-connection-cannot-reconnect", "expired-owner-rechecks-without-stealing", "recovery-failure-becomes-gap", "startup-finds-resumable-scopes", "service-shutdown-preserves-resume-intent"] }));
