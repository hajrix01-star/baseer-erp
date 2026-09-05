import assert from "node:assert/strict";

import { MarketingGoogleBusinessOAuthPilotService } from "./marketing-google-business-oauth-pilot.service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";

type StateRow = Record<string, any>;
class PilotDatabase {
  state: StateRow | null = null;
  connection = { id: "44444444-4444-4444-8444-444444444444", status: "NOT_CONNECTED" };
  envelope: Record<string, unknown> | null = null;
  transactionCount = 0;
  readonly tx = {
    $executeRaw: async () => 1,
    marketingProviderConnection: {
      findFirst: async () => this.connection.id ? { id: this.connection.id } : null,
      create: async ({ data }: any) => { this.connection = { id: data.id, status: data.status }; return data; },
      update: async ({ data }: any) => { this.connection.status = data.status; return { ...this.connection }; },
      updateMany: async ({ data }: any) => { this.connection.status = data.status; return { count: 1 }; },
    },
    marketingGoogleBusinessOAuthState: {
      updateMany: async ({ where, data }: any) => {
        if (!this.state || this.state.consumedAt || (where.stateHash && this.state.stateHash !== where.stateHash)) return { count: 0 };
        this.state = { ...this.state, ...data };
        return { count: 1 };
      },
      create: async ({ data }: any) => { this.state = { ...data }; return data; },
      findFirst: async ({ where }: any) => this.state && !this.state.consumedAt && this.state.stateHash === where.stateHash && this.state.expiresAt > new Date() ? { ...this.state } : null,
    },
    marketingProviderCredentialEnvelope: {
      upsert: async ({ create, update }: any) => { this.envelope = this.envelope ? { ...this.envelope, ...update } : { ...create }; return this.envelope; },
      updateMany: async ({ data }: any) => { if (!this.envelope || this.envelope.status !== "ACTIVE") return { count: 0 }; this.envelope = { ...this.envelope, ...data }; return { count: 1 }; },
    },
    auditEvent: { create: async () => ({}) },
  };
  async inTenantTransaction<T>(_tenant: string, operation: (tx: any) => Promise<T>) { this.transactionCount += 1; return operation(this.tx); }
}

class PilotPlatform {
  enabled = true;
  googleBusinessPilotCompanyId() { return companyId; }
  googleBusinessPilotConfiguration() {
    if (!this.enabled) throw new Error("disabled");
    return { clientId: "client", clientSecret: "secret", redirectUri: "https://baseer.test/marketing/provider-connections/google-business/pilot/callback" };
  }
}

class PilotVault {
  encrypt(value: string) { return { ciphertext: `sealed:${value}`, iv: "AAAAAAAAAAAAAAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA==", keyVersion: 1 }; }
  decrypt(value: { ciphertext: string }) { return value.ciphertext.replace(/^sealed:/, ""); }
}

const context = { tenantId, companyId, actorUserId };
const database = new PilotDatabase();
const platform = new PilotPlatform();
const service = new MarketingGoogleBusinessOAuthPilotService(database as any, platform as any, new PilotVault() as any);
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls += 1; return new Response(JSON.stringify({ refresh_token: "verification-only-refresh-token" }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;

try {
  const started = await service.begin(context);
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  assert.ok(state, "The pilot must create a state value.");
  const callbacks = await Promise.allSettled([
    service.complete({ state, code: "verification-code", error: undefined }),
    service.complete({ state, code: "verification-code", error: undefined }),
  ]);
  assert.equal(callbacks.filter((item) => item.status === "fulfilled").length, 1, "Exactly one concurrent callback may claim the state.");
  assert.equal(fetchCalls, 1, "Only the winning callback may exchange its code.");
  assert.equal(database.connection.status, "AUTHORIZED_AWAITING_SELECTION");
  assert.ok(database.envelope, "Only the successful callback may write an envelope.");
  assert.ok(!JSON.stringify(database.envelope).includes("verification-code"), "Authorization codes must never enter the envelope.");

  const second = await service.begin(context);
  const secondState = new URL(second.authorizationUrl).searchParams.get("state");
  assert.ok(secondState);
  platform.enabled = false;
  const beforeDisabledCallback = fetchCalls;
  assert.equal(await service.complete({ state: secondState, code: "verification-code", error: undefined }), "BLOCKED");
  assert.equal(fetchCalls, beforeDisabledCallback, "The second kill-switch check must prevent egress.");
  assert.equal(database.connection.status, "BLOCKED");
  assert.equal(database.envelope?.status, "REVOKED", "A failed re-authorization must not leave an older credential active.");
  console.log("Marketing Google Business OAuth pilot policy verification passed: atomic callback claim, encrypted-envelope-only success path, and pre-exchange kill switch.");
} finally {
  globalThis.fetch = originalFetch;
}
