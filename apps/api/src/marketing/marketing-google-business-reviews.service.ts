import { createHash, randomUUID } from "node:crypto";

import { BadGatewayException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { MarketingGoogleCredentialVault } from "./marketing-google-credential-vault.js";
import { MarketingGooglePlatformService } from "./marketing-google-platform.service.js";

const GOOGLE_TIMEOUT_MS = 12_000;
// Mirrors Baseer legacy's bounded full-history reader: 100 pages × 50 reviews.
// This is a safety cap, not a UI pagination limit; stored facts remain pageable.
const MAX_PROVIDER_PAGES = 100;
const PAGE_SIZE = 50;
const REVIEW_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const RUN_STALE_AFTER_MS = 15 * 60 * 1_000;
const ACCOUNT_NAME = /^accounts\/[A-Za-z0-9_-]{1,128}$/;
const LOCATION_NAME = /^locations\/[A-Za-z0-9_-]{1,128}$/;

type ActiveRead = Readonly<{
  connectionId: string;
  mappingId: string;
  accountResourceName: string;
  locationResourceName: string;
  envelope: { ciphertext: string; iv: string; tag: string; keyVersion: number };
  runId: string;
}>;
type GoogleReview = Readonly<{
  name?: unknown;
  starRating?: unknown;
  reviewer?: { displayName?: unknown };
  comment?: unknown;
  createTime?: unknown;
  updateTime?: unknown;
  reviewReply?: { comment?: unknown; updateTime?: unknown };
}>;
type GoogleReviewsPage = Readonly<{
  reviews?: readonly GoogleReview[];
  averageRating?: unknown;
  totalReviewCount?: unknown;
  nextPageToken?: unknown;
}>;
type ProviderReview = Readonly<{
  resourceName: string;
  rating: number;
  reviewerDisplayName: string | null;
  reviewComment: string | null;
  reviewCreatedAt: Date;
  reviewUpdatedAt: Date;
  replyComment: string | null;
  replyUpdatedAt: Date | null;
}>;

/**
 * The only Google review reader. It keeps provider egress and all aggregation
 * on the server, then exposes a compact company-scoped read model to the UI.
 */
@Injectable()
export class MarketingGoogleBusinessReviewsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly platform: MarketingGooglePlatformService,
    private readonly vault: MarketingGoogleCredentialVault,
  ) {}

  async sync(context: TrustedCompanyActorContext) {
    let active: ActiveRead | null = null;
    try {
      active = await this.start(context);
      const accessToken = await this.accessToken(context, active.envelope);
      const read = await this.readPages(active.accountResourceName, active.locationResourceName, accessToken);
      const sourceFreshAt = new Date();
      const rowsWritten = await this.persist(context, active, read.reviews, read.rowsRead, sourceFreshAt, read.averageRating, read.totalReviewCount);
      return {
        status: "COMPLETED" as const,
        rowsRead: read.rowsRead,
        rowsWritten,
        sourceFreshAt: sourceFreshAt.toISOString(),
        totalReviewCount: read.totalReviewCount,
      };
    } catch (error) {
      if (active) await this.fail(context, active.runId, safeErrorCode(error));
      throw error;
    }
  }

  async read(context: TrustedCompanyActorContext, cursor: string | undefined) {
    const parsedCursor = decodeCursor(cursor);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const mapping = await tx.marketingGoogleBusinessLocationMapping.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" },
        orderBy: { selectedAt: "desc" }, select: { id: true },
      });
      if (!mapping) return emptyRead("NOT_CONNECTED");
      const latestRun = await tx.marketingProviderSyncRun.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, locationMappingId: mapping.id, provider: "GOOGLE_BUSINESS", status: "COMPLETED" },
        orderBy: { sourceFreshAt: "desc" },
        select: { sourceFreshAt: true, providerAverageRating: true, providerTotalReviewCount: true, rowsRead: true, rowsWritten: true },
      });
      if (!latestRun?.sourceFreshAt) return emptyRead("NO_DATA");
      const where = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        locationMappingId: mapping.id,
        ...(parsedCursor ? { OR: [{ reviewUpdatedAt: { lt: parsedCursor.updatedAt } }, { reviewUpdatedAt: parsedCursor.updatedAt, id: { lt: parsedCursor.id } }] } : {}),
      };
      const rows = await tx.marketingGoogleBusinessReviewFact.findMany({
        where,
        orderBy: [{ reviewUpdatedAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        select: { id: true, rating: true, reviewerDisplayName: true, reviewComment: true, reviewCreatedAt: true, reviewUpdatedAt: true, replyComment: true, replyUpdatedAt: true },
      });
      const page = rows.slice(0, PAGE_SIZE);
      const repliedCount = await tx.marketingGoogleBusinessReviewFact.count({ where: { tenantId: context.tenantId, companyId: context.companyId, locationMappingId: mapping.id, replyComment: { not: null } } });
      const storedCount = await tx.marketingGoogleBusinessReviewFact.count({ where: { tenantId: context.tenantId, companyId: context.companyId, locationMappingId: mapping.id } });
      const averageRating = latestRun.providerAverageRating?.toNumber() ?? null;
      const totalReviewCount = latestRun.providerTotalReviewCount ?? storedCount;
      const responseRatePercent = storedCount === 0 ? null : Math.round((repliedCount / storedCount) * 100);
      return {
        sourceStatus: "READY" as const,
        asOf: latestRun.sourceFreshAt.toISOString(),
        summary: {
          averageRating,
          totalReviewCount,
          storedReviewCount: storedCount,
          repliedReviewCount: repliedCount,
          responseRatePercent,
          analysisAr: analysisAr(averageRating, totalReviewCount, responseRatePercent),
          analysisEn: analysisEn(averageRating, totalReviewCount, responseRatePercent),
        },
        sync: { rowsRead: latestRun.rowsRead, rowsWritten: latestRun.rowsWritten },
        reviews: page.map((row) => ({
          id: row.id,
          rating: row.rating,
          reviewerDisplayName: row.reviewerDisplayName,
          reviewComment: row.reviewComment,
          reviewCreatedAt: row.reviewCreatedAt.toISOString(),
          reviewUpdatedAt: row.reviewUpdatedAt.toISOString(),
          replyComment: row.replyComment,
          replyUpdatedAt: row.replyUpdatedAt?.toISOString() ?? null,
        })),
        nextCursor: rows.length > PAGE_SIZE && page.at(-1) ? encodeCursor(page.at(-1)!.reviewUpdatedAt, page.at(-1)!.id) : null,
      };
    });
  }

  private async start(context: TrustedCompanyActorContext): Promise<ActiveRead> {
    this.platform.googleBusinessReviewReadConfiguration();
    try {
      return await this.database.inTenantTransaction(context.tenantId, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-google-reviews:${context.tenantId}:${context.companyId}`}, 0))`;
        const cutoff = new Date(Date.now() - RUN_STALE_AFTER_MS);
        await tx.marketingProviderSyncRun.updateMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: "RUNNING", createdAt: { lt: cutoff } },
          data: { status: "BLOCKED", safeErrorCode: "SYNC_LEASE_EXPIRED" },
        });
        const connection = await tx.marketingProviderConnection.findFirst({
          where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: "AUTHORIZED_READ_ONLY_SELECTED" },
          select: { id: true, credentialEnvelope: { select: { ciphertext: true, iv: true, tag: true, keyVersion: true, status: true, revokedAt: true } } },
        });
        const mapping = await tx.marketingGoogleBusinessLocationMapping.findFirst({
          where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" },
          orderBy: { selectedAt: "desc" }, select: { id: true, googleAccountResourceName: true, googleLocationResourceName: true },
        });
        if (!connection || !mapping || connection.credentialEnvelope?.status !== "ACTIVE" || connection.credentialEnvelope.revokedAt) throw new ForbiddenException("Google Business is not ready for review synchronization.");
        if (!ACCOUNT_NAME.test(mapping.googleAccountResourceName) || !LOCATION_NAME.test(mapping.googleLocationResourceName)) throw new ServiceUnavailableException("Google Business mapping is invalid.");
        const runId = randomUUID();
        await tx.marketingProviderSyncRun.create({
          data: { id: runId, tenantId: context.tenantId, companyId: context.companyId, locationMappingId: mapping.id, provider: "GOOGLE_BUSINESS", status: "RUNNING", correlationId: randomUUID(), adapterVersion: "google-business-reviews.v1" },
        });
        return { connectionId: connection.id, mappingId: mapping.id, accountResourceName: mapping.googleAccountResourceName, locationResourceName: mapping.googleLocationResourceName, envelope: connection.credentialEnvelope, runId };
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException("A Google Business review synchronization is already running.");
      throw error;
    }
  }

  private async accessToken(context: TrustedCompanyActorContext, envelope: ActiveRead["envelope"]) {
    const credential = this.vault.decrypt(envelope, { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" });
    let refreshToken = "";
    try {
      const parsed = JSON.parse(credential) as { kind?: unknown; refreshToken?: unknown };
      if (parsed.kind === "google-business-refresh-token.v1" && typeof parsed.refreshToken === "string") refreshToken = parsed.refreshToken.trim();
    } catch { /* handled below */ }
    if (!refreshToken) throw new ServiceUnavailableException("Google Business credential is invalid.");
    const config = this.platform.googleBusinessReviewReadConfiguration();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const body = await response.json().catch(() => ({})) as { access_token?: unknown };
    if (!response.ok || typeof body.access_token !== "string" || !body.access_token.trim()) throw new BadGatewayException("Google Business access could not be refreshed.");
    return body.access_token.trim();
  }

  private async readPages(account: string, location: string, accessToken: string) {
    const providerReviews: ProviderReview[] = [];
    let nextPageToken: string | null = null;
    let averageRating: number | null = null;
    let totalReviewCount: number | null = null;
    let rowsRead = 0;
    for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
      const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), orderBy: "updateTime desc" });
      if (nextPageToken) query.set("pageToken", nextPageToken);
      const response = await fetch(`https://mybusiness.googleapis.com/v4/${account}/${location}/reviews?${query}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({})) as GoogleReviewsPage;
      if (!response.ok) throw new BadGatewayException("Google Business reviews could not be read.");
      const reviews = Array.isArray(body.reviews) ? body.reviews : [];
      rowsRead += reviews.length;
      providerReviews.push(...reviews.map(parseReview).filter((review): review is ProviderReview => review !== null));
      averageRating = finiteRating(body.averageRating) ?? averageRating;
      totalReviewCount = nonnegativeInteger(body.totalReviewCount) ?? totalReviewCount;
      nextPageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : null;
      if (!nextPageToken) break;
    }
    return { reviews: providerReviews, rowsRead, averageRating, totalReviewCount };
  }

  private async persist(context: TrustedCompanyActorContext, active: ActiveRead, reviews: readonly ProviderReview[], rowsRead: number, sourceFreshAt: Date, averageRating: number | null, totalReviewCount: number | null) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-google-reviews:${context.tenantId}:${context.companyId}`}, 0))`;
      const connection = await tx.marketingProviderConnection.findFirst({ where: { id: active.connectionId, tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: "AUTHORIZED_READ_ONLY_SELECTED" }, select: { id: true } });
      const mapping = await tx.marketingGoogleBusinessLocationMapping.findFirst({ where: { id: active.mappingId, tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" }, select: { id: true } });
      if (!connection || !mapping) throw new ForbiddenException("Google Business connection changed before synchronization completed.");
      const retentionCutoff = new Date(sourceFreshAt.valueOf() - REVIEW_RETENTION_MS);
      await tx.marketingGoogleBusinessReviewFact.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, fetchedAt: { lt: retentionCutoff } } });
      for (const review of reviews) {
        const contentHash = hash(JSON.stringify(review));
        await tx.marketingGoogleBusinessReviewFact.upsert({
          where: { tenantId_companyId_locationMappingId_providerReviewResourceName: { tenantId: context.tenantId, companyId: context.companyId, locationMappingId: active.mappingId, providerReviewResourceName: review.resourceName } },
          create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, locationMappingId: active.mappingId, provider: "GOOGLE_BUSINESS", providerReviewResourceName: review.resourceName, rating: review.rating, reviewerDisplayName: review.reviewerDisplayName, reviewComment: review.reviewComment, reviewCreatedAt: review.reviewCreatedAt, reviewUpdatedAt: review.reviewUpdatedAt, replyComment: review.replyComment, replyUpdatedAt: review.replyUpdatedAt, fetchedAt: sourceFreshAt, contentHash },
          update: { rating: review.rating, reviewerDisplayName: review.reviewerDisplayName, reviewComment: review.reviewComment, reviewCreatedAt: review.reviewCreatedAt, reviewUpdatedAt: review.reviewUpdatedAt, replyComment: review.replyComment, replyUpdatedAt: review.replyUpdatedAt, fetchedAt: sourceFreshAt, contentHash },
        });
      }
      const checksum = hash(JSON.stringify(reviews.map((review) => ({ resourceName: review.resourceName, rating: review.rating, updatedAt: review.reviewUpdatedAt.toISOString(), replyUpdatedAt: review.replyUpdatedAt?.toISOString() ?? null }))));
      await tx.marketingProviderSyncRun.update({ where: { id: active.runId }, data: { status: "COMPLETED", rowsRead, rowsWritten: reviews.length, sourceChecksum: checksum, sourceFreshAt, providerAverageRating: averageRating === null ? null : averageRating.toFixed(1), providerTotalReviewCount: totalReviewCount, safeErrorCode: null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "marketing.google_business_reviews.synchronized", entityType: "MarketingProviderSyncRun", entityId: active.runId, requestId: randomUUID(), beforeJson: Prisma.JsonNull, afterJson: { status: "COMPLETED", rowsRead, rowsWritten: reviews.length, sourceFreshAt: sourceFreshAt.toISOString() } } });
      return reviews.length;
    });
  }

  private async fail(context: TrustedCompanyActorContext, runId: string, code: string) {
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await tx.marketingProviderSyncRun.updateMany({ where: { id: runId, tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: "RUNNING" }, data: { status: "FAILED", safeErrorCode: code } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "marketing.google_business_reviews.sync_failed", entityType: "MarketingProviderSyncRun", entityId: runId, requestId: randomUUID(), beforeJson: Prisma.JsonNull, afterJson: { status: "FAILED", safeErrorCode: code } } });
    });
  }
}

function parseReview(value: GoogleReview): ProviderReview | null {
  const resourceName = text(value.name, 512);
  const rating = starRating(value.starRating);
  const reviewCreatedAt = date(value.createTime);
  const reviewUpdatedAt = date(value.updateTime) ?? reviewCreatedAt;
  if (!/^accounts\/[A-Za-z0-9_-]{1,128}\/locations\/[A-Za-z0-9_-]{1,128}\/reviews\/[A-Za-z0-9_-]{1,256}$/.test(resourceName) || !rating || !reviewCreatedAt || !reviewUpdatedAt) return null;
  return { resourceName, rating, reviewerDisplayName: nullableText(value.reviewer?.displayName, 256), reviewComment: nullableText(value.comment, 10_000), reviewCreatedAt, reviewUpdatedAt, replyComment: nullableText(value.reviewReply?.comment, 10_000), replyUpdatedAt: date(value.reviewReply?.updateTime) };
}
function starRating(value: unknown) { return typeof value === "string" ? ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as Record<string, number>)[value] ?? null : null; }
function finiteRating(value: unknown) { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) && number >= 1 && number <= 5 ? Math.round(number * 10) / 10 : null; }
function nonnegativeInteger(value: unknown) { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null; }
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function nullableText(value: unknown, max: number) { const normalized = text(value, max); return normalized || null; }
function date(value: unknown) { if (typeof value !== "string") return null; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? null : parsed; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function safeErrorCode(error: unknown) { if (error instanceof ForbiddenException) return "CONNECTION_NOT_READY"; if (error instanceof ConflictException) return "SYNC_IN_PROGRESS"; if (error instanceof ServiceUnavailableException) return "CONFIGURATION_UNAVAILABLE"; return "GOOGLE_READ_FAILED"; }
function isUniqueConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002"; }
function encodeCursor(updatedAt: Date, id: string) { return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id })).toString("base64url"); }
function decodeCursor(value: string | undefined): { updatedAt: Date; id: string } | null { if (!value) return null; try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown }; const updatedAt = date(parsed.updatedAt); return updatedAt && typeof parsed.id === "string" && /^[0-9a-f-]{36}$/i.test(parsed.id) ? { updatedAt, id: parsed.id } : null; } catch { return null; } }
function emptyRead(sourceStatus: "NOT_CONNECTED" | "NO_DATA") { return { sourceStatus, asOf: null, summary: { averageRating: null, totalReviewCount: null, storedReviewCount: 0, repliedReviewCount: 0, responseRatePercent: null, analysisAr: sourceStatus === "NOT_CONNECTED" ? "اربط Google Business أولاً لعرض التقييمات." : "لا توجد تقييمات متزامنة بعد؛ اضغط مزامنة الآن.", analysisEn: sourceStatus === "NOT_CONNECTED" ? "Connect Google Business first to view reviews." : "No reviews have been synchronized yet. Choose Sync now." }, sync: null, reviews: [], nextCursor: null }; }
function analysisAr(average: number | null, total: number, response: number | null) { if (average === null) return "وصلت بيانات التقييمات، لكن متوسط النجوم غير متاح من Google حالياً."; const quality = average >= 4.5 ? "الانطباع العام قوي" : average >= 3.5 ? "الانطباع العام جيد ويحتاج متابعة" : "الانطباع العام يحتاج متابعة قريبة"; const reply = response === null ? "" : `، ونسبة الردود الظاهرة ${response}%`; return `${quality}: متوسط ${average.toFixed(1)} من 5 عبر ${total} تقييماً${reply}. هذا وصف لبيانات Google وليس مبيعات أو سبباً مالياً.`; }
function analysisEn(average: number | null, total: number, response: number | null) { if (average === null) return "Review data arrived, but Google did not provide an average rating."; const quality = average >= 4.5 ? "Overall sentiment is strong" : average >= 3.5 ? "Overall sentiment is good and needs follow-up" : "Overall sentiment needs close follow-up"; const reply = response === null ? "" : `, with ${response}% showing a Google reply`; return `${quality}: ${average.toFixed(1)} out of 5 across ${total} reviews${reply}. This describes Google data, not sales or financial causation.`; }
