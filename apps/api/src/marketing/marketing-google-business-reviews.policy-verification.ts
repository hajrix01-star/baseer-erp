import assert from "node:assert/strict";

import { MarketingGoogleBusinessReviewsService } from "./marketing-google-business-reviews.service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";
const mappingId = "44444444-4444-4444-8444-444444444444";

type Run = { id: string; status: string; rowsRead: number; rowsWritten: number; sourceFreshAt: Date | null; providerAverageRating: string | null; providerTotalReviewCount: number | null };
type Fact = { id: string; rating: number; reviewerDisplayName: string | null; reviewComment: string | null; reviewCreatedAt: Date; reviewUpdatedAt: Date; replyComment: string | null; replyUpdatedAt: Date | null; fetchedAt: Date; providerReviewResourceName: string };

class ReviewsDatabase {
  connected = true;
  runs: Run[] = [];
  facts: Fact[] = [];
  readonly tx = {
    $executeRaw: async () => 1,
    marketingProviderConnection: {
      findFirst: async () => this.connected ? { id: "connection", credentialEnvelope: { ciphertext: "sealed", iv: "AAAAAAAAAAAAAAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA==", keyVersion: 1, status: "ACTIVE", revokedAt: null } } : null,
    },
    marketingGoogleBusinessLocationMapping: {
      findFirst: async () => this.connected ? { id: mappingId, googleAccountResourceName: "accounts/arZAccount", googleLocationResourceName: "locations/arZLocation" } : null,
    },
    marketingProviderSyncRun: {
      updateMany: async ({ where, data }: any) => {
        const candidates = this.runs.filter((run) => (!where.id || run.id === where.id) && (!where.status || run.status === where.status));
        candidates.forEach((run) => { run.status = data.status; });
        return { count: candidates.length };
      },
      create: async ({ data }: any) => {
        if (this.runs.some((run) => run.status === "RUNNING")) { const error = Object.assign(new Error("sync running"), { code: "P2002" }); throw error; }
        const run: Run = { id: data.id, status: data.status, rowsRead: 0, rowsWritten: 0, sourceFreshAt: null, providerAverageRating: null, providerTotalReviewCount: null };
        this.runs.push(run);
        return run;
      },
      update: async ({ where, data }: any) => {
        const run = this.runs.find((candidate) => candidate.id === where.id)!;
        Object.assign(run, data);
        return run;
      },
      findFirst: async ({ where }: any) => {
        const run = [...this.runs].reverse().find((candidate) => !where.status || candidate.status === where.status);
        return run ? { ...run, providerAverageRating: run.providerAverageRating ? { toNumber: () => Number(run.providerAverageRating) } : null } : null;
      },
    },
    marketingGoogleBusinessReviewFact: {
      deleteMany: async ({ where }: any) => {
        const before = this.facts.length;
        if (where.reviewUpdatedAt?.lt) this.facts = this.facts.filter((fact) => fact.reviewUpdatedAt >= where.reviewUpdatedAt.lt);
        return { count: before - this.facts.length };
      },
      upsert: async ({ where, create, update }: any) => {
        const key = where.tenantId_companyId_locationMappingId_providerReviewResourceName.providerReviewResourceName;
        const current = this.facts.find((fact) => fact.providerReviewResourceName === key);
        if (current) { Object.assign(current, update); return current; }
        const fact: Fact = { ...create };
        this.facts.push(fact);
        return fact;
      },
      findMany: async ({ where, take }: any) => {
        let rows = [...this.facts].sort((left, right) => right.reviewUpdatedAt.valueOf() - left.reviewUpdatedAt.valueOf() || right.id.localeCompare(left.id));
        if (where.rating) rows = rows.filter((fact) => fact.rating === where.rating);
        if (where.replyComment === null) rows = rows.filter((fact) => fact.replyComment === null);
        if (where.replyComment?.not === null) rows = rows.filter((fact) => fact.replyComment !== null);
        if (where.OR) rows = rows.filter((fact) => fact.reviewUpdatedAt < where.OR[0].reviewUpdatedAt.lt || (fact.reviewUpdatedAt.valueOf() === where.OR[1].reviewUpdatedAt.valueOf() && fact.id < where.OR[1].id.lt));
        return rows.slice(0, take);
      },
      count: async ({ where }: any) => this.facts.filter((fact) => (!where.rating || fact.rating === where.rating) && (where.replyComment === null ? fact.replyComment === null : where.replyComment?.not === null ? fact.replyComment !== null : true)).length,
      groupBy: async () => [1, 2, 3, 4, 5].filter((rating) => this.facts.some((fact) => fact.rating === rating)).map((rating) => ({ rating, _count: { _all: this.facts.filter((fact) => fact.rating === rating).length } })),
    },
    auditEvent: { create: async () => ({}) },
  };
  async inTenantTransaction<T>(_tenant: string, operation: (tx: any) => Promise<T>) { return operation(this.tx); }
}

class ReviewsPlatform {
  enabled = true;
  googleBusinessReviewReadConfiguration() {
    if (!this.enabled) throw new Error("disabled");
    return { clientId: "verification-client", clientSecret: "verification-secret" };
  }
}
class ReviewsVault {
  decrypt() { return JSON.stringify({ kind: "google-business-refresh-token.v1", refreshToken: "verification-refresh-token" }); }
}

const database = new ReviewsDatabase();
const platform = new ReviewsPlatform();
const service = new MarketingGoogleBusinessReviewsService(database as any, platform as any, new ReviewsVault() as any);
const context = { tenantId, companyId, actorUserId };
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async (input: string | URL) => {
  fetchCalls += 1;
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "short-lived-access-token" }), { status: 200, headers: { "content-type": "application/json" } });
  assert.match(url, /^https:\/\/mybusiness\.googleapis\.com\/v4\/accounts\/arZAccount\/locations\/arZLocation\/reviews\?/);
  return new Response(JSON.stringify({
    averageRating: 4.5,
    totalReviewCount: 2,
    reviews: [
      { name: "accounts/arZAccount/locations/arZLocation/reviews/reviewA", starRating: "FIVE", reviewer: { displayName: "Google guest" }, comment: "Excellent", createTime: "2026-09-05T08:00:00.000Z", updateTime: "2026-09-05T09:00:00.000Z", reviewReply: { comment: "Thank you", updateTime: "2026-09-05T10:00:00.000Z" } },
      { name: "accounts/arZAccount/locations/arZLocation/reviews/reviewB", starRating: "FOUR", reviewer: { displayName: "Another guest" }, comment: "Good", createTime: "2026-09-04T08:00:00.000Z", updateTime: "2026-09-04T09:00:00.000Z" },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

try {
  const receipt = await service.sync(context);
  assert.deepEqual(receipt.status, "COMPLETED");
  assert.equal(receipt.rowsRead, 2);
  assert.equal(receipt.rowsWritten, 2);
  assert.equal(database.facts.length, 2, "The provider reviews must be stored as company-scoped facts.");
  assert.ok(!JSON.stringify(receipt).includes("verification-refresh-token"), "A sync receipt must not expose a refresh token.");

  const read = await service.read(context, {});
  assert.equal(read.sourceStatus, "READY");
  assert.equal(read.summary.averageRating, 4.5);
  assert.equal(read.summary.totalReviewCount, 2);
  assert.equal(read.summary.repliedReviewCount, 1);
  assert.equal(read.summary.unrepliedReviewCount, 1);
  assert.equal(read.distribution.find((item) => item.rating === 5)?.reviewCount, 1);
  assert.equal(read.reviews[0]?.replyComment, "Thank you", "Existing Google replies must be available for display.");

  const unanswered = await service.read(context, { replyState: "UNREPLIED" });
  assert.equal(unanswered.filteredReviewCount, 1, "Reply-state filtering must happen in the server read model.");
  assert.equal(unanswered.reviews[0]?.reviewerDisplayName, "Another guest");

  const supersededRun = { id: "55555555-5555-4555-8555-555555555555", status: "BLOCKED", rowsRead: 0, rowsWritten: 0, sourceFreshAt: null, providerAverageRating: null, providerTotalReviewCount: null };
  database.runs.push(supersededRun);
  await assert.rejects(() => (service as any).persist(context, { connectionId: "connection", mappingId, runId: supersededRun.id }, [], 0, new Date(), null, null), /superseded/, "A replaced run must not write facts after a newer synchronization claimed the lease.");

  database.facts[1]!.reviewUpdatedAt = new Date("2020-01-01T00:00:00.000Z");
  const retentionRun = { id: "66666666-6666-4666-8666-666666666666", status: "RUNNING", rowsRead: 0, rowsWritten: 0, sourceFreshAt: null, providerAverageRating: null, providerTotalReviewCount: null };
  database.runs.push(retentionRun);
  await (service as any).persist(context, { connectionId: "connection", mappingId, runId: retentionRun.id }, [], 0, new Date(), null, null);
  assert.equal(database.facts.length, 2, "A repeated synchronization must retain the requested full review history.");

  database.connected = false;
  const beforeBlockedSync = fetchCalls;
  await assert.rejects(() => service.sync(context), /not ready/);
  assert.equal(fetchCalls, beforeBlockedSync, "A disconnected company must be rejected before Google egress.");
  console.log("Marketing Google Business reviews verification passed: guarded manual sync, full company-scoped history, server filters and analysis, and read-only existing replies.");
} finally {
  globalThis.fetch = originalFetch;
}
