import assert from "node:assert/strict";

import { MarketingGoogleBusinessResourceSelectionService } from "./marketing-google-business-resource-selection.service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";
const context = { tenantId, companyId, actorUserId };

class SelectionDatabase {
  mapping: Record<string, unknown> | null = null;
  audit: Record<string, unknown> | null = null;
  connectionStatus = "AUTHORIZED_AWAITING_SELECTION";
  readonly tx = {
    $executeRaw: async () => 1,
    marketingProviderConnection: {
      findFirst: async () => ({ id: "44444444-4444-4444-8444-444444444444", credentialEnvelope: { ciphertext: "sealed", iv: "iv", tag: "tag", keyVersion: 1, status: "ACTIVE", revokedAt: null } }),
      update: async ({ data }: any) => { this.connectionStatus = data.status; return { id: "44444444-4444-4444-8444-444444444444", status: data.status }; },
    },
    marketingGoogleBusinessLocationMapping: {
      findFirst: async () => this.mapping ? { ...this.mapping } : null,
      create: async ({ data }: any) => { this.mapping = { ...data }; return this.mapping; },
      update: async ({ data }: any) => { this.mapping = { ...this.mapping, ...data }; return this.mapping; },
    },
    auditEvent: { create: async ({ data }: any) => { this.audit = { ...data }; return this.audit; } },
  };
  async inTenantTransaction<T>(_tenantId: string, operation: (tx: any) => Promise<T>) { return operation(this.tx); }
}
class SelectionPlatform {
  googleBusinessPilotCompanyId() { return companyId; }
  googleBusinessPilotConfiguration() { return { clientId: "verification-client", clientSecret: "verification-secret", redirectUri: "https://baseer.test/callback" }; }
}
class SelectionVault { decrypt() { return JSON.stringify({ kind: "google-business-refresh-token.v1", refreshToken: "verification-refresh-token" }); } }
class SelectionIdempotency {
  async beginInTransaction(_tx: unknown, _context: unknown, _request: unknown) { return { kind: "begun" as const, receiptId: "66666666-6666-4666-8666-666666666666" }; }
  async completeInTransaction() { return undefined; }
}

const database = new SelectionDatabase();
const service = new MarketingGoogleBusinessResourceSelectionService(database as any, new SelectionPlatform() as any, new SelectionVault() as any, new SelectionIdempotency() as any);
const originalFetch = globalThis.fetch;
const calls: string[] = [];
let discoveryMode: "SINGLE" | "AMBIGUOUS" = "SINGLE";
globalThis.fetch = (async (input: URL | RequestInfo) => {
  const url = String(input); calls.push(url);
  if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "verification-access-token" }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) return new Response(JSON.stringify({ accounts: discoveryMode === "SINGLE" ? [{ name: "accounts/123", accountName: "ARZ Google Account", type: "LOCATION_GROUP", ignoredSecret: "must-not-leak" }] : [{ name: "accounts/123", accountName: "ARZ Google Account", type: "LOCATION_GROUP" }, { name: "accounts/789", accountName: "Another account", type: "LOCATION_GROUP" }] }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://mybusinessbusinessinformation.googleapis.com/v1/accounts/123/locations")) return new Response(JSON.stringify({ locations: [{ name: "locations/456", title: "ARZ Lounge", storefrontAddress: { addressLines: ["King Road"], locality: "Jeddah" }, ignoredPayload: "must-not-leak" }] }), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error(`Unexpected provider request: ${url}`);
}) as typeof fetch;

try {
  const resources = await service.resources(context);
  assert.deepEqual(resources.accounts, [{ resourceName: "accounts/123", accountName: "ARZ Google Account", accountType: "LOCATION_GROUP" }]);
  assert.equal(JSON.stringify(resources).includes("verification-access-token"), false, "Access tokens must not enter API data.");
  assert.equal(JSON.stringify(resources).includes("must-not-leak"), false, "Raw provider fields must not enter API data.");
  const locations = await service.locations(context, "accounts/123");
  assert.deepEqual(locations.locations, [{ resourceName: "locations/456", title: "ARZ Lounge", address: "King Road, Jeddah" }]);
  const receipt = await service.select(context, { accountResourceName: "accounts/123", locationResourceName: "locations/456", idempotencyKey: "44444444-4444-4444-8444-444444444445" });
  assert.equal(receipt.selectedReadOnly, true);
  assert.equal(database.mapping?.googleAccountResourceName, "accounts/123");
  assert.equal(database.mapping?.googleLocationResourceName, "locations/456");
  assert.equal(database.connectionStatus, "AUTHORIZED_READ_ONLY_SELECTED", "A saved selection must become the canonical connection state.");
  assert.deepEqual(database.audit?.afterJson, { selectedReadOnly: true }, "Audit metadata must not contain Google identifiers.");
  const beforeDenied = calls.length;
  await assert.rejects(() => service.resources({ ...context, companyId: "55555555-5555-4555-8555-555555555555" }), /not available/);
  assert.equal(calls.length, beforeDenied, "A company outside the ARZ allowlist must not trigger token refresh or provider egress.");
  await assert.rejects(() => service.select(context, { accountResourceName: "accounts/123", locationResourceName: "locations/999", idempotencyKey: "55555555-5555-4555-8555-555555555556" }), /not available/);
  const oneStep = await service.selectOnlyAvailableResource(context);
  assert.deepEqual(oneStep, { selected: true, reason: null }, "A single account/location pair must be saved without browser selection steps.");
  discoveryMode = "AMBIGUOUS";
  assert.deepEqual(await service.selectOnlyAvailableResource(context), { selected: false, reason: "ACCOUNT_AMBIGUOUS" }, "Multiple accounts must never be selected by order or name.");
  console.log("Marketing Google Business selection verification passed: ARZ-only egress, transient discovery, explicit membership validation, and safe audit output.");
} finally {
  globalThis.fetch = originalFetch;
}
