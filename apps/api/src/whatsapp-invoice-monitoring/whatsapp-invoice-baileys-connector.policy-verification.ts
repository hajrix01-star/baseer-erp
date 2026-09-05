/** Run after the API build:
 * `node apps/api/dist/whatsapp-invoice-monitoring/whatsapp-invoice-baileys-connector.policy-verification.js`.
 * This verifies close handling only; it opens no socket, database, or HTTP request. */
import assert from "node:assert/strict";

import { DisconnectReason } from "@whiskeysockets/baileys";

import { WhatsappInvoiceBaileysPilotConnectorService } from "./whatsapp-invoice-baileys-connector.service.js";
import { WhatsappInvoiceBaileysPilotFoundationService } from "./whatsapp-invoice-baileys-pilot-foundation.service.js";

type CloseHandler = {
  handleClosedConnection(active: unknown, error: unknown): Promise<void>;
  dispose(active: unknown, reconnect?: boolean): Promise<void>;
};

type PersistenceHandler = {
  persistAuthentication(active: unknown, state: unknown): Promise<void>;
};

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
assert.equal((stoppedClaimWhere as { connection?: { is?: { status?: string } } }).connection?.is?.status, "GAP_DETECTED", "The lease claim itself must be conditional on the durable reconnect state.");

console.log(JSON.stringify({ ok: true, verified: ["transient-pairing-close-reconnects", "logout-does-not-reconnect", "queued-pairing-credentials-survive-dispose", "stale-owner-cannot-persist-session", "stopped-connection-cannot-reconnect"] }));
