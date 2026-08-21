import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { buildSaudiContextCatalogDocument } from "./saudi-context-catalog.js";

type ContextSourceDefinition = Readonly<{ sourceCode: string; displayNameAr: string; sourceUrl: string; scheduleCode: string; mode: "LOCAL_CATALOG" | "EXTERNAL_DOCUMENT"; allowedHosts: readonly string[] }>;
type NormalizedEvent = Readonly<{ externalKey: string; eventKind: string; titleAr: string; startsOn: string; endsOn: string; sourceUpdatedAt: string | null; checksum: string }>;
type NormalizationResult = Readonly<{ events: NormalizedEvent[]; duplicateCount: number; conflicts: Array<{ externalKey: string; reason: string }> }>;
type OfficialDocument = Readonly<{ sourceUpdatedAt?: unknown; events?: unknown }>;

/**
 * The recurring Saudi calendar is local and deterministic, exactly as in the
 * Noorix calendar. It never scrapes a government page at runtime. The Ministry
 * URL is provenance for the reviewed academic catalogue, not a runtime feed.
 */
export const APPROVED_CONTEXT_SOURCES: readonly ContextSourceDefinition[] = [
  { sourceCode: "SA_UMM_AL_QURA_OCCASIONS", displayNameAr: "التقويم السعودي وأم القرى", sourceUrl: "baseer://local/umm-al-qura", scheduleCode: "DAILY_0300_ASIA_RIYADH", mode: "LOCAL_CATALOG", allowedHosts: [] },
  { sourceCode: "SA_MOE_ACADEMIC_CALENDAR", displayNameAr: "وزارة التعليم — التقويم الدراسي", sourceUrl: "https://www.moe.gov.sa/ar/education/generaleducation/Pages/AcademicCalendar.aspx", scheduleCode: "DAILY_0315_ASIA_RIYADH", mode: "LOCAL_CATALOG", allowedHosts: [] },
];

/** A transport-safe format emitted by a source-specific official adapter. */
export type OfficialContextDocumentV1 = Readonly<{
  sourceUpdatedAt?: string;
  events: readonly Readonly<{ externalKey?: string; eventKind: string; titleAr: string; startsOn: string; endsOn: string; sourceUpdatedAt?: string }> [];
}>;

@Injectable()
export class DecisionContextImportService implements OnModuleInit, OnModuleDestroy {
  private scheduledTimer: ReturnType<typeof setInterval> | null = null;
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logger = new Logger(DecisionContextImportService.name);

  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  onModuleInit() {
    // A scheduler is an explicit deployment concern, even for local catalogues.
    // Interactive/API instances must never acquire background work by default.
    if (process.env.BASEER_CONTEXT_IMPORT_ENABLED !== "true") return;
    const intervalMs = safeInterval(process.env.BASEER_CONTEXT_IMPORT_INTERVAL_MS);
    this.bootstrapTimer = setTimeout(() => { void this.runScheduledImportsSafely(); }, 5_000);
    this.scheduledTimer = setInterval(() => { void this.runScheduledImportsSafely(); }, intervalMs);
  }

  onModuleDestroy() {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    if (this.scheduledTimer) clearInterval(this.scheduledTimer);
  }

  async ensureApprovedSources(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => Promise.all(APPROVED_CONTEXT_SOURCES.map((definition) => transaction.decisionContextSource.upsert({
      where: { tenantId_sourceCode: { tenantId: context.tenantId, sourceCode: definition.sourceCode } },
      update: { displayNameAr: definition.displayNameAr, sourceUrl: definition.sourceUrl, scheduleCode: definition.scheduleCode },
      create: {
        id: randomUUID(),
        tenantId: context.tenantId,
        sourceCode: definition.sourceCode,
        displayNameAr: definition.displayNameAr,
        sourceUrl: definition.sourceUrl,
        scheduleCode: definition.scheduleCode,
      },
      select: { sourceCode: true, displayNameAr: true, sourceUrl: true, scheduleCode: true, enabled: true },
    }))));
  }

  async syncSource(context: TrustedCompanyActorContext, sourceCode: string, triggerCode = "MANUAL") {
    const definition = approvedSource(sourceCode);
    await this.ensureApprovedSources(context);
    const source = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.decisionContextSource.findFirstOrThrow({
      where: { tenantId: context.tenantId, sourceCode: definition.sourceCode, enabled: true },
      select: { id: true, sourceCode: true, sourceUrl: true },
    }));
    const runId = await this.startRun(context.tenantId, source.id, triggerCode);
    try {
      const localDocument = definition.mode === "LOCAL_CATALOG" ? buildLocalCatalogDocument(definition.sourceCode) : null;
      const response = localDocument
        ? { document: localDocument, checksum: sha(localDocument) }
        : await fetchOfficialDocument(source.sourceUrl, definition.allowedHosts);
      const parsed = parseOfficialDocument(response.document);
      const normalized = normalizeOfficialEvents(source.sourceCode, parsed);
      return await this.applyDocument(context, source, runId, response.checksum, normalized, triggerCode);
    } catch (error) {
      return this.finishRun(context.tenantId, runId, "NEEDS_REVIEW", { reason: safeError(error) });
    }
  }

  async latestRuns(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.decisionContextImportRun.findMany({
      where: { tenantId: context.tenantId }, orderBy: { startedAt: "desc" }, take: 50,
      select: { id: true, triggerCode: true, status: true, documentChecksum: true, receivedEvents: true, publishedEvents: true, reviewEvents: true, diagnosticsJson: true, startedAt: true, finishedAt: true, source: { select: { sourceCode: true, displayNameAr: true } } },
    }));
  }

  async sourceHealth(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => Promise.all(APPROVED_CONTEXT_SOURCES.map(async (definition) => {
      const source = await transaction.decisionContextSource.findUnique({
        where: { tenantId_sourceCode: { tenantId: context.tenantId, sourceCode: definition.sourceCode } },
        select: {
          enabled: true,
          importRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true, startedAt: true, finishedAt: true } },
        },
      });
      return {
        category: "PUBLIC_CONTEXT" as const,
        sourceCode: definition.sourceCode,
        displayNameAr: definition.displayNameAr,
        sourceUrl: definition.sourceUrl,
        scheduleCode: definition.scheduleCode,
        readiness: !source ? "NOT_REGISTERED" : !source.enabled ? "DISABLED" : "READY_LOCAL_CATALOG",
        readinessReason: definition.sourceCode === "SA_UMM_AL_QURA_OCCASIONS"
          ? "يُحسب محلياً من أم القرى؛ لا يستخدم API أو بحثاً في الويب. المناسبات الهجرية ظاهرة كتقديرية إلى تأكيد رسمي."
          : "كتالوج دراسي موثق داخل النظام مع رابط وزارة التعليم؛ يُحدّث عند اعتماد التقويم الدراسي الجديد، ولا يكشط صفحة الويب وقت التشغيل.",
        lastRun: source?.importRuns[0] ?? null,
      };
    })));
  }

  async listPendingReviews(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [events, actions] = await Promise.all([
        transaction.decisionGlobalContextEvent.findMany({
          where: { tenantId: context.tenantId, revisions: { some: { status: "NEEDS_REVIEW" } } },
          orderBy: { updatedAt: "desc" }, take: 100,
          select: {
            id: true, eventKind: true, scope: true, locationLabelAr: true, currentRevision: true,
            source: { select: { sourceCode: true, displayNameAr: true } },
            revisions: { where: { status: "NEEDS_REVIEW" }, orderBy: { revision: "asc" }, select: { revision: true, titleAr: true, startsOn: true, endsOn: true, sourceUpdatedAt: true, sourceChecksum: true } },
          },
        }),
        transaction.decisionGlobalContextReviewAction.findMany({ where: { tenantId: context.tenantId }, select: { eventId: true, revision: true } }),
      ]);
      const resolved = new Set(actions.map((action) => `${action.eventId}:${action.revision}`));
      return events.map((event) => ({ ...event, revisions: event.revisions.filter((revision) => !resolved.has(`${event.id}:${revision.revision}`)) })).filter((event) => event.revisions.length > 0);
    });
  }

  async resolveReview(
    context: TrustedCompanyActorContext,
    input: Readonly<{ eventId: string; revision: number; action: "APPROVE" | "DISMISS"; reason: string }>,
    idempotencyKey: string,
  ) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.global_review.resolve",
        key: idempotencyKey,
        request: input,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The global context-review request is already in progress.");
      const event = await transaction.decisionGlobalContextEvent.findFirst({
        where: { id: input.eventId, tenantId: context.tenantId },
        select: {
          id: true, currentRevision: true,
          revisions: { where: { revision: input.revision }, select: { revision: true, titleAr: true, startsOn: true, endsOn: true, sourceUpdatedAt: true, sourceChecksum: true, importReceipt: true, verificationStatus: true, status: true } },
        },
      });
      const candidate = event?.revisions[0];
      if (!event || !candidate) throw new ConflictException("The global context revision was not found.");
      if (candidate.status !== "NEEDS_REVIEW") throw new ConflictException("Only a pending global context revision can be resolved.");
      const existingAction = await transaction.decisionGlobalContextReviewAction.findUnique({ where: { eventId_revision: { eventId: event.id, revision: candidate.revision } }, select: { id: true } });
      if (existingAction) throw new ConflictException("This global context revision has already been resolved.");
      const action = input.action === "APPROVE" ? "APPROVED" : "DISMISSED" as const;
      const actionId = randomUUID();
      await transaction.decisionGlobalContextReviewAction.create({ data: { id: actionId, tenantId: context.tenantId, eventId: event.id, revision: candidate.revision, action, reason: input.reason, createdByUserId: context.actorUserId } });
      let publishedRevision: number | null = null;
      if (input.action === "APPROVE") {
        publishedRevision = candidate.revision + 1;
        await transaction.decisionGlobalContextEventRevision.create({
          data: {
            id: randomUUID(), tenantId: context.tenantId, eventId: event.id, revision: publishedRevision,
            titleAr: candidate.titleAr, startsOn: candidate.startsOn, endsOn: candidate.endsOn, sourceUpdatedAt: candidate.sourceUpdatedAt,
            sourceChecksum: candidate.sourceChecksum, importReceipt: { candidateRevision: candidate.revision, actionId, reason: input.reason, originalReceipt: candidate.importReceipt } as Prisma.InputJsonValue,
            verificationStatus: "HUMAN_CONFIRMED", status: "PUBLISHED",
          },
        });
        await transaction.decisionGlobalContextEvent.update({ where: { id_tenantId: { id: event.id, tenantId: context.tenantId } }, data: { currentRevision: publishedRevision, status: "PUBLISHED" } });
      }
      const body = { eventId: event.id, revision: candidate.revision, action, publishedRevision };
      await transaction.auditEvent.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: null, actorUserId: context.actorUserId, action: "decision.context.global_review.resolved", entityType: "DecisionGlobalContextEventRevision", entityId: `${event.id}:${candidate.revision}`, requestId: randomUUID(), afterJson: { ...body, reason: input.reason } },
      });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
      return body;
    });
  }

  /**
   * An advisory lock prevents every API replica from fetching the same source.
   * Import data remains tenant-isolated inside the fan-out transactions.
   */
  async runScheduledImports() {
    const locked = await this.database.withSystemSchedulerLock("decision-context-imports-v1", () => this.runScheduledImportsUnlocked());
    return locked.acquired ? locked.result : { status: "SKIPPED_LOCKED" as const };
  }

  private async runScheduledImportsSafely() {
    try {
      await this.runScheduledImports();
    } catch (error) {
      // A failed optional job must never become an unhandled rejection that
      // terminates the HTTP process. The next scheduled attempt can retry.
      this.logger.error(`Decision-context import run failed: ${safeError(error)}`);
    }
  }

  private async runScheduledImportsUnlocked() {
    const tenantIds = await this.database.listTenantIdsForSystemScheduler();
    for (const tenantId of tenantIds) {
      const context = { tenantId, companyId: "00000000-0000-0000-0000-000000000000", actorUserId: "00000000-0000-0000-0000-000000000000" };
      await this.ensureApprovedSources(context);
      for (const source of APPROVED_CONTEXT_SOURCES) await this.syncSource(context, source.sourceCode, "SCHEDULED");
    }
    return { status: "COMPLETED" as const, tenantCount: tenantIds.length };
  }

  private async startRun(tenantId: string, sourceId: string, triggerCode: string) {
    const id = randomUUID();
    await this.database.inTenantTransaction(tenantId, (transaction) => transaction.decisionContextImportRun.create({ data: { id, tenantId, sourceId, triggerCode, status: "RUNNING", diagnosticsJson: {} } }));
    return id;
  }

  private async applyDocument(context: TrustedCompanyActorContext, source: Readonly<{ id: string; sourceCode: string }>, runId: string, documentChecksum: string, normalized: NormalizationResult, triggerCode: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      let publishedEvents = 0;
      let reviewEvents = normalized.conflicts.length;
      for (const event of normalized.events) {
        const current = await transaction.decisionGlobalContextEvent.findFirst({
          where: { tenantId: context.tenantId, sourceId: source.id, externalKey: event.externalKey },
          include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
        });
        if (!current) {
          const eventId = randomUUID();
          await transaction.decisionGlobalContextEvent.create({ data: { id: eventId, tenantId: context.tenantId, sourceId: source.id, externalKey: event.externalKey, eventKind: event.eventKind, currentRevision: 1 } });
          await transaction.decisionGlobalContextEventRevision.create({ data: revisionData(context.tenantId, eventId, 1, event, runId, source.sourceCode, documentChecksum, "PUBLISHED") });
          publishedEvents += 1;
          continue;
        }
        const latest = current.revisions[0];
        if (!latest) throw new ConflictException("A public-context event is missing its immutable revision.");
        if (latest.sourceChecksum === event.checksum) continue;
        // A changed official record is evidence, not silent truth. Preserve the
        // last published revision and append an explicit review candidate.
        await transaction.decisionGlobalContextEventRevision.create({ data: revisionData(context.tenantId, current.id, latest.revision + 1, event, runId, source.sourceCode, documentChecksum, "NEEDS_REVIEW") });
        reviewEvents += 1;
      }
      const status = reviewEvents ? "NEEDS_REVIEW" : "SUCCEEDED";
      await transaction.decisionContextImportRun.update({ where: { id_tenantId: { id: runId, tenantId: context.tenantId } }, data: { status, documentChecksum, receivedEvents: normalized.events.length + normalized.duplicateCount + normalized.conflicts.length, publishedEvents, reviewEvents, diagnosticsJson: { sourceCode: source.sourceCode, duplicateCount: normalized.duplicateCount, conflicts: normalized.conflicts, triggerCode }, finishedAt: new Date() } });
      return { runId, status, receivedEvents: normalized.events.length + normalized.duplicateCount + normalized.conflicts.length, publishedEvents, reviewEvents, duplicateCount: normalized.duplicateCount };
    });
  }

  private async finishRun(tenantId: string, runId: string, status: string, diagnostics: Prisma.InputJsonValue) {
    return this.database.inTenantTransaction(tenantId, (transaction) => transaction.decisionContextImportRun.update({ where: { id_tenantId: { id: runId, tenantId } }, data: { status, diagnosticsJson: diagnostics, finishedAt: new Date() }, select: { id: true, status: true } }));
  }
}

export function normalizeOfficialEvents(sourceCode: string, document: OfficialContextDocumentV1): NormalizationResult {
  if (!Array.isArray(document.events) || document.events.length > 2_000) throw new ConflictException("The official context document has an invalid event list.");
  const byOccurrence = new Map<string, NormalizedEvent>();
  const conflicts: Array<{ externalKey: string; reason: string }> = [];
  let duplicateCount = 0;
  for (const raw of document.events) {
    const eventKind = requiredToken(raw.eventKind, "event kind", 80);
    const titleAr = requiredText(raw.titleAr, "Arabic title", 240);
    const startsOn = dateValue(raw.startsOn); const endsOn = dateValue(raw.endsOn);
    if (endsOn < startsOn) throw new ConflictException("An official context event ends before it starts.");
    // The occurrence key intentionally excludes title text: a punctuation or
    // translation change must become a review candidate, never a second Eid.
    const externalKey = requiredToken(raw.externalKey ?? `${sourceCode}:${eventKind}:${startsOn}:${endsOn}`, "external key", 240);
    const sourceUpdatedAt = optionalInstant(raw.sourceUpdatedAt ?? document.sourceUpdatedAt);
    const checksum = sha({ sourceCode, externalKey, eventKind, titleAr, startsOn, endsOn, sourceUpdatedAt });
    const existing = byOccurrence.get(externalKey);
    if (!existing) { byOccurrence.set(externalKey, { externalKey, eventKind, titleAr, startsOn, endsOn, sourceUpdatedAt, checksum }); continue; }
    if (existing.checksum === checksum) { duplicateCount += 1; continue; }
    conflicts.push({ externalKey, reason: "The same official occurrence has conflicting fields in one document." });
  }
  return { events: [...byOccurrence.values()].filter((event) => !conflicts.some((conflict) => conflict.externalKey === event.externalKey)), duplicateCount, conflicts };
}

function revisionData(tenantId: string, eventId: string, revision: number, event: NormalizedEvent, runId: string, sourceCode: string, documentChecksum: string, status: "PUBLISHED" | "NEEDS_REVIEW") {
  const verificationStatus = sourceCode === "SA_MOE_ACADEMIC_CALENDAR" ? "HUMAN_CONFIRMED" : "NOT_APPLICABLE";
  return { id: randomUUID(), tenantId, eventId, revision, titleAr: event.titleAr, startsOn: new Date(`${event.startsOn}T00:00:00.000Z`), endsOn: new Date(`${event.endsOn}T00:00:00.000Z`), sourceUpdatedAt: event.sourceUpdatedAt ? new Date(event.sourceUpdatedAt) : null, sourceChecksum: event.checksum, importReceipt: { runId, sourceCode, documentChecksum }, verificationStatus, status } as Prisma.DecisionGlobalContextEventRevisionUncheckedCreateInput;
}
async function fetchOfficialDocument(url: string, allowedHosts: readonly string[]) {
  const parsed = new URL(url); if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname)) throw new ConflictException("The context source URL is not an approved HTTPS host.");
  const response = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("application/json")) throw new ConflictException("The approved source did not provide its verified JSON event document.");
  const raw = await response.text(); if (Buffer.byteLength(raw, "utf8") > 2 * 1024 * 1024) throw new ConflictException("The approved context document exceeds the size limit.");
  return { document: JSON.parse(raw) as unknown, checksum: sha(raw) };
}
function parseOfficialDocument(value: unknown): OfficialContextDocumentV1 { if (!value || typeof value !== "object" || !Array.isArray((value as OfficialDocument).events)) throw new ConflictException("The approved source document has an unsupported schema."); return value as OfficialContextDocumentV1; }
function approvedSource(sourceCode: string) { const source = APPROVED_CONTEXT_SOURCES.find((item) => item.sourceCode === sourceCode); if (!source) throw new ConflictException("The requested context source is not approved."); return source; }
function buildLocalCatalogDocument(sourceCode: string): OfficialContextDocumentV1 {
  if (sourceCode !== "SA_UMM_AL_QURA_OCCASIONS" && sourceCode !== "SA_MOE_ACADEMIC_CALENDAR") throw new ConflictException("The requested local catalogue is not supported.");
  return buildSaudiContextCatalogDocument(sourceCode);
}
function requiredText(value: unknown, label: string, max: number) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ConflictException(`A valid ${label} is required.`); return value.trim(); }
function requiredToken(value: unknown, label: string, max: number) { const result = requiredText(value, label, max).replace(/\s+/g, "_").toUpperCase(); if (!/^[A-Z0-9:_-]+$/.test(result)) throw new ConflictException(`A valid ${label} is required.`); return result; }
function dateValue(value: unknown) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ConflictException("A valid official event date is required."); const parsed = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new ConflictException("A valid official event date is required."); return value; }
function optionalInstant(value: unknown) { if (value === undefined || value === null || value === "") return null; if (typeof value !== "string" || Number.isNaN(new Date(value).valueOf())) throw new ConflictException("An official source timestamp is invalid."); return new Date(value).toISOString(); }
function sha(value: unknown) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function safeInterval(value: string | undefined) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 60 * 60 * 1000 && parsed <= 7 * 24 * 60 * 60 * 1000 ? parsed : 24 * 60 * 60 * 1000; }
function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "Unknown import failure."; }
