import assert from "node:assert/strict";

import { MarketingGoogleBusinessOAuthPilotService } from "./marketing-google-business-oauth-pilot.service.js";
import { MarketingGooglePlatformService } from "./marketing-google-platform.service.js";

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
class OnlyResourceSelection {
  selectedContext: Record<string, string> | null = null;
  async selectOnlyAvailableResource(context: Record<string, string>) {
    this.selectedContext = context;
    return { selected: true as const, reason: null };
  }
}

const context = { tenantId, companyId, actorUserId };
const database = new PilotDatabase();
const platform = new PilotPlatform();
const onlyResourceSelection = new OnlyResourceSelection();
const service = new MarketingGoogleBusinessOAuthPilotService(database as any, platform as any, new PilotVault() as any, onlyResourceSelection as any);
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls += 1; return new Response(JSON.stringify({ refresh_token: "verification-only-refresh-token" }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;

const platformEnvironmentNames = [
  "BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_COMPANY_ID",
  "BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED",
  "BASEER_GOOGLE_OAUTH_ENABLED",
  "BASEER_GOOGLE_OAUTH_CLIENT_ID",
  "BASEER_GOOGLE_OAUTH_CLIENT_SECRET",
  "BASEER_GOOGLE_OAUTH_REDIRECT_URI",
  "BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY",
] as const;
const originalPlatformEnvironment = new Map(platformEnvironmentNames.map((name) => [name, process.env[name]]));

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
  assert.equal(database.connection.status, "AUTHORIZED_AWAITING_SELECTION", "The OAuth boundary delegates the canonical transition to the resource-selection service.");
  assert.deepEqual(onlyResourceSelection.selectedContext, context, "The callback must continue the same company and initiating actor through one-step selection.");
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
  Object.assign(process.env, {
    BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_COMPANY_ID: companyId,
    BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED: "true",
    BASEER_GOOGLE_OAUTH_ENABLED: "true",
    BASEER_GOOGLE_OAUTH_CLIENT_ID: "verification-client",
    BASEER_GOOGLE_OAUTH_CLIENT_SECRET: "verification-secret",
    BASEER_GOOGLE_OAUTH_REDIRECT_URI: "https://baseer.test/marketing/provider-connections/google-business/pilot/callback",
    BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  const platformReadiness = new MarketingGooglePlatformService();
  assert.equal(platformReadiness.googleBusinessPilotAuthorizationAvailable(companyId), true, "Only a completely configured allowlisted company may see the pilot action.");
  assert.equal(platformReadiness.googleBusinessPilotAuthorizationAvailable("55555555-5555-4555-8555-555555555555"), false, "A different company must not see the pilot action.");
  process.env.BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED = "false";
  assert.equal(platformReadiness.googleBusinessPilotAuthorizationAvailable(companyId), false, "The pilot action must fail closed when disabled.");
  console.log("Marketing Google Business OAuth pilot policy verification passed: atomic callback claim, encrypted-envelope-only success path, and pre-exchange kill switch.");
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of originalPlatformEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
