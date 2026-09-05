/** Run after the API build:
 * `node apps/api/dist/whatsapp-invoice-monitoring/whatsapp-invoice-baileys-connector.policy-verification.js`.
 * This verifies close handling only; it opens no socket, database, or HTTP request. */
import assert from "node:assert/strict";

import { DisconnectReason } from "@whiskeysockets/baileys";

import { WhatsappInvoiceBaileysPilotConnectorService } from "./whatsapp-invoice-baileys-connector.service.js";

type CloseHandler = {
  handleClosedConnection(active: unknown, error: unknown): Promise<void>;
  dispose(active: unknown, reconnect?: boolean): Promise<void>;
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

console.log(JSON.stringify({ ok: true, verified: ["transient-pairing-close-reconnects", "logout-does-not-reconnect"] }));
