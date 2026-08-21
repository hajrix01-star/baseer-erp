import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { canonicalJson, IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

type ResearchSourceDefinition = Readonly<{
  sourceCode: string;
  displayNameAr: string;
  sourceUrl: string;
  scheduleCode: string;
  allowedHosts: readonly string[];
  documentUrlEnvironment: "BASEER_NCM_WEATHER_DOCUMENT_URL" | "BASEER_SPL_FIXTURES_DOCUMENT_URL";
}>;
type ResearchCandidate = Readonly<{
  externalKey: string;
  eventKind: string;
  titleAr: string;
  startsOn: string;
  endsOn: string;
  scope: "TENANT_GLOBAL" | "AREA";
  locationCode: string | null;
  locationLabelAr: string | null;
  relevanceReasonAr: string | null;
  sourceUpdatedAt: string | null;
  payload: Prisma.InputJsonValue;
  checksum: string;
}>;
type ResearchNormalization = Readonly<{ candidates: ResearchCandidate[]; duplicateCount: number; conflicts: Array<{ externalKey: string; reason: string }> }>;

/**
 * The researcher has no open-web mode. Each source owns a structured document
 * URL in deployment configuration and may only point to its allow-listed
 * official host. A missing approved feed is visible as unavailable, never
 * replaced with scraped search results.
 */
export const APPROVED_CONTEXT_RESEARCH_SOURCES: readonly ResearchSourceDefinition[] = [
  {
    sourceCode: "SA_NCM_WEATHER_FORECAST",
    displayNameAr: "المركز الوطني للأرصاد — توقعات الطقس",
    sourceUrl: "https://api-doc.ncm.gov.sa/",
    scheduleCode: "WEEKLY_MON_0400_ASIA_RIYADH",
    allowedHosts: ["api-mm.ncm.gov.sa"],
    documentUrlEnvironment: "BASEER_NCM_WEATHER_DOCUMENT_URL",
  },
  {
    sourceCode: "SA_SPL_FIXTURES",
    displayNameAr: "رابطة الدوري السعودي للمحترفين — جدول المباريات",
    sourceUrl: "https://www.spl.com.sa/ar/fixtures-results",
    scheduleCode: "WEEKLY_MON_0415_ASIA_RIYADH",
    allowedHosts: ["www.spl.com.sa", "spl.com.sa"],
    documentUrlEnvironment: "BASEER_SPL_FIXTURES_DOCUMENT_URL",
  },
];

/** Strict adapter output; source-specific connectors own their transformation. */
export type ContextResearchDocumentV1 = Readonly<{
  sourceUpdatedAt?: string;
  candidates: readonly Readonly<{
    externalKey?: string;
    eventKind: string;
    titleAr: string;
    startsOn: string;
    endsOn: string;
    locationCode?: string;
    locationLabelAr?: string;
    relevanceReasonAr?: string;
    sourceUpdatedAt?: string;
    payload?: Record<string, unknown>;
  }>[];
}>;

@Injectable()
export class DecisionContextResearchService implements OnModuleInit, OnModuleDestroy {
  private weeklyTimer: ReturnType<typeof setInterval> | null = null;
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
  ) {}

  onModuleInit() {
    if (process.env.BASEER_CONTEXT_RESEARCH_ENABLED !== "true") return;
    this.bootstrapTimer = setTimeout(() => { void this.runScheduledResearch(); }, 8_000);
    this.weeklyTimer = setInterval(() => { void this.runScheduledResearch(); }, 7 * 24 * 60 * 60 * 1_000);
  }

  onModuleDestroy() {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    if (this.weeklyTimer) clearInterval(this.weeklyTimer);
  }

  async ensureApprovedSources(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, (transaction) => Promise.all(APPROVED_CONTEXT_RESEARCH_SOURCES.map((definition) => transaction.decisionContextSource.upsert({
      where: { tenantId_sourceCode: { tenantId: context.tenantId, sourceCode: definition.sourceCode } },
      update: { displayNameAr: definition.displayNameAr, sourceUrl: definition.sourceUrl, scheduleCode: definition.scheduleCode },
      create: { id: randomUUID(), tenantId: context.tenantId, ...definition },
      select: { sourceCode: true, displayNameAr: true, sourceUrl: true, scheduleCode: true, enabled: true },
    }))));
  }

  async syncSource(context: TrustedCompanyActorContext, sourceCode: string, triggerCode = "MANUAL") {
    const definition = approvedResearchSource(sourceCode);
    await this.ensureApprovedSources(context);
    const source = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.decisionContextSource.findFirstOrThrow({
      where: { tenantId: context.tenantId, sourceCode: definition.sourceCode, enabled: true },
      select: { id: true, sourceCode: true },
    }));
    const runId = await this.startRun(context.tenantId, source.id, triggerCode);
    const documentUrl = process.env[definition.documentUrlEnvironment];
    if (!documentUrl) return this.finishRun(context.tenantId, runId, "UNAVAILABLE", {
      reason: "An approved structured source adapter has not been configured for this environment.",
      documentUrlEnvironment: definition.documentUrlEnvironment,
    });
    try {
      const response = await fetchResearchDocument(documentUrl, definition.allowedHosts);
      const normalized = normalizeResearchCandidates(source.sourceCode, parseResearchDocument(response.document));
      return await this.applyDocument(context, source, runId, response.checksum, normalized, triggerCode);
    } catch (error) {
      return this.finishRun(context.tenantId, runId, "NEEDS_REVIEW", { reason: safeError(error) });
    }
  }

  async runScheduledResearch() {
    const locked = await this.database.withSystemSchedulerLock("decision-context-research-v1", () => this.runScheduledResearchUnlocked());
    return locked.acquired ? locked.result : { status: "SKIPPED_LOCKED" as const };
  }

  private async runScheduledResearchUnlocked() {
    const tenantIds = await this.database.listTenantIdsForSystemScheduler();
    for (const tenantId of tenantIds) {
      const systemContext: TrustedCompanyActorContext = { tenantId, companyId: "00000000-0000-0000-0000-000000000000", actorUserId: "00000000-0000-0000-0000-000000000000" };
      await this.ensureApprovedSources(systemContext);
      for (const source of APPROVED_CONTEXT_RESEARCH_SOURCES) {
        if (process.env[source.documentUrlEnvironment]) await this.syncSource(systemContext, source.sourceCode, "SCHEDULED");
      }
    }
    return { status: "COMPLETED" as const, tenantCount: tenantIds.length };
  }

  async listCandidates(context: TrustedCompanyActorContext, status?: "PENDING_REVIEW" | "APPROVED" | "DISMISSED" | "DUPLICATE") {
    return this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.decisionContextCandidate.findMany({
      where: { tenantId: context.tenantId, ...(status ? { status } : {}) },
      orderBy: [{ startsOn: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true, eventKind: true, titleAr: true, startsOn: true, endsOn: true, scope: true, locationCode: true, locationLabelAr: true, relevanceReasonAr: true,
        status: true, sourceUpdatedAt: true, createdAt: true, resolutionJson: true,
        source: { select: { sourceCode: true, displayNameAr: true, sourceUrl: true } },
      },
    }));
  }

  async sourceHealth(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => Promise.all(APPROVED_CONTEXT_RESEARCH_SOURCES.map(async (definition) => {
      const source = await transaction.decisionContextSource.findUnique({
        where: { tenantId_sourceCode: { tenantId: context.tenantId, sourceCode: definition.sourceCode } },
        select: {
          enabled: true,
          researchRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true, startedAt: true, finishedAt: true } },
        },
      });
      const configured = Boolean(process.env[definition.documentUrlEnvironment]);
      return {
        category: "RESEARCH" as const,
        sourceCode: definition.sourceCode,
        displayNameAr: definition.displayNameAr,
        sourceUrl: definition.sourceUrl,
        scheduleCode: definition.scheduleCode,
        readiness: !source ? "NOT_REGISTERED" : !source.enabled ? "DISABLED" : !configured ? "NOT_CONFIGURED" : "READY_TO_SYNC",
        readinessReason: !configured ? `يتطلب إعداد الموصل المعتمد ${definition.documentUrlEnvironment} على الخادم.` : "الموصل مهيأ؛ تبقى النتائج مرشحات للمراجعة البشرية قبل النشر.",
        lastRun: source?.researchRuns[0] ?? null,
      };
    })));
  }

  async resolveCandidate(context: TrustedCompanyActorContext, input: Readonly<{ candidateId: string; action: "APPROVE" | "DISMISS"; note?: string | undefined }>, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const receipt = await this.idempotency.beginInTransaction(transaction, context, {
        operation: "decision.context.research.resolve", key: idempotencyKey,
        request: { candidateId: input.candidateId, action: input.action, note: input.note ?? null }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
      if (receipt.kind === "replay") return receipt.response.body;
      if (receipt.kind === "in-progress") throw new ConflictException("The context-candidate resolution is already in progress.");
      const candidate = await transaction.decisionContextCandidate.findFirst({
        where: { id: input.candidateId, tenantId: context.tenantId },
        include: { source: { select: { sourceCode: true } } },
      });
      if (!candidate) throw new ConflictException("The context candidate was not found.");
      if (candidate.status !== "PENDING_REVIEW") throw new ConflictException("Only a pending context candidate can be resolved.");
      const resolutionJson = { action: input.action, note: input.note ?? null, resolvedAt: new Date().toISOString() } as Prisma.InputJsonValue;
      if (input.action === "DISMISS") {
        const body = { id: candidate.id, status: "DISMISSED" as const };
        await transaction.decisionContextCandidate.update({ where: { id_tenantId: { id: candidate.id, tenantId: context.tenantId } }, data: { status: "DISMISSED", resolutionJson, resolvedByUserId: context.actorUserId, resolvedAt: new Date() } });
        await this.auditResolution(transaction, context, candidate.id, body);
        await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
        return body;
      }
      const duplicate = await publishedDuplicate(transaction, context.tenantId, candidate.sourceId, candidate.externalKey, candidate.eventKind, candidate.titleAr, candidate.startsOn, candidate.endsOn, candidate.scope, candidate.locationCode);
      if (duplicate) {
        const body = { id: candidate.id, status: "DUPLICATE" as const, publishedEventId: duplicate.id };
        await transaction.decisionContextCandidate.update({ where: { id_tenantId: { id: candidate.id, tenantId: context.tenantId } }, data: { status: "DUPLICATE", resolutionJson: { action: input.action, note: input.note ?? null, resolvedAt: new Date().toISOString(), duplicateEventId: duplicate.id }, publishedEventId: duplicate.id, resolvedByUserId: context.actorUserId, resolvedAt: new Date() } });
        await this.auditResolution(transaction, context, candidate.id, body);
        await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 200, headers: null, body } });
        return body;
      }
      const eventId = randomUUID();
      await transaction.decisionGlobalContextEvent.create({ data: { id: eventId, tenantId: context.tenantId, sourceId: candidate.sourceId, externalKey: candidate.externalKey, eventKind: candidate.eventKind, scope: candidate.scope, locationCode: candidate.locationCode, locationLabelAr: candidate.locationLabelAr, currentRevision: 1 } });
      await transaction.decisionGlobalContextEventRevision.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, eventId, revision: 1, titleAr: candidate.titleAr, startsOn: candidate.startsOn, endsOn: candidate.endsOn,
        sourceUpdatedAt: candidate.sourceUpdatedAt, sourceChecksum: candidate.sourceChecksum,
        importReceipt: { researchRunId: candidate.researchRunId, sourceCode: candidate.source.sourceCode, candidateId: candidate.id },
        verificationStatus: "HUMAN_CONFIRMED", status: "PUBLISHED",
      } });
      const body = { id: candidate.id, status: "APPROVED" as const, publishedEventId: eventId };
      await transaction.decisionContextCandidate.update({ where: { id_tenantId: { id: candidate.id, tenantId: context.tenantId } }, data: { status: "APPROVED", resolutionJson, publishedEventId: eventId, resolvedByUserId: context.actorUserId, resolvedAt: new Date() } });
      await this.auditResolution(transaction, context, candidate.id, body);
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: receipt.receiptId, response: { status: 201, headers: null, body } });
      return body;
    });
  }

  private async startRun(tenantId: string, sourceId: string, triggerCode: string) {
    const id = randomUUID();
    await this.database.inTenantTransaction(tenantId, (transaction) => transaction.decisionContextResearchRun.create({ data: { id, tenantId, sourceId, triggerCode, status: "RUNNING", diagnosticsJson: {} } }));
    return id;
  }

  private async applyDocument(context: TrustedCompanyActorContext, source: Readonly<{ id: string; sourceCode: string }>, runId: string, documentChecksum: string, normalized: ResearchNormalization, triggerCode: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      let pendingCandidates = 0;
      let duplicateCandidates = normalized.conflicts.length;
      for (const item of normalized.candidates) {
        const published = await publishedDuplicate(transaction, context.tenantId, source.id, item.externalKey, item.eventKind, item.titleAr, item.startsOn, item.endsOn, item.scope, item.locationCode);
        const current = await transaction.decisionContextCandidate.findUnique({ where: { tenantId_sourceId_externalKey: { tenantId: context.tenantId, sourceId: source.id, externalKey: item.externalKey } } });
        const status = published ? "DUPLICATE" as const : "PENDING_REVIEW" as const;
        const data = {
          eventKind: item.eventKind, titleAr: item.titleAr, startsOn: asDate(item.startsOn), endsOn: asDate(item.endsOn), scope: item.scope, locationCode: item.locationCode, locationLabelAr: item.locationLabelAr,
          relevanceReasonAr: item.relevanceReasonAr, sourceUpdatedAt: item.sourceUpdatedAt ? new Date(item.sourceUpdatedAt) : null, sourceChecksum: item.checksum,
          payloadJson: item.payload, status, resolutionJson: published ? { reason: "Matches an already published context event.", publishedEventId: published.id } as Prisma.InputJsonValue : Prisma.DbNull,
          publishedEventId: published?.id ?? null, resolvedAt: published ? new Date() : null,
        };
        if (!current) await transaction.decisionContextCandidate.create({ data: { id: randomUUID(), tenantId: context.tenantId, sourceId: source.id, researchRunId: runId, externalKey: item.externalKey, ...data } });
        else if (current.sourceChecksum !== item.checksum || current.status === "PENDING_REVIEW") await transaction.decisionContextCandidate.update({ where: { id_tenantId: { id: current.id, tenantId: context.tenantId } }, data: { ...data, researchRunId: runId } });
        if (status === "DUPLICATE") duplicateCandidates += 1; else pendingCandidates += 1;
      }
      const status = normalized.conflicts.length ? "NEEDS_REVIEW" : "SUCCEEDED";
      await transaction.decisionContextResearchRun.update({ where: { id_tenantId: { id: runId, tenantId: context.tenantId } }, data: {
        status, documentChecksum, receivedCandidates: normalized.candidates.length + normalized.duplicateCount + normalized.conflicts.length,
        pendingCandidates, duplicateCandidates,
        diagnosticsJson: { sourceCode: source.sourceCode, duplicateCount: normalized.duplicateCount, conflicts: normalized.conflicts, triggerCode }, finishedAt: new Date(),
      } });
      return { runId, status, receivedCandidates: normalized.candidates.length + normalized.duplicateCount + normalized.conflicts.length, pendingCandidates, duplicateCandidates };
    });
  }

  private async finishRun(tenantId: string, runId: string, status: string, diagnostics: Prisma.InputJsonValue) {
    return this.database.inTenantTransaction(tenantId, (transaction) => transaction.decisionContextResearchRun.update({ where: { id_tenantId: { id: runId, tenantId } }, data: { status, diagnosticsJson: diagnostics, finishedAt: new Date() }, select: { id: true, status: true } }));
  }

  private async auditResolution(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, candidateId: string, body: Prisma.InputJsonValue) {
    await transaction.auditEvent.create({ data: {
      id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
      action: "decision.context.research.resolved", entityType: "DecisionContextCandidate", entityId: candidateId,
      requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: body,
    } });
  }
}

export function normalizeResearchCandidates(sourceCode: string, document: ContextResearchDocumentV1): ResearchNormalization {
  if (!Array.isArray(document.candidates) || document.candidates.length > 2_000) throw new ConflictException("The context researcher document has an invalid candidate list.");
  const byOccurrence = new Map<string, ResearchCandidate>();
  const conflicts: Array<{ externalKey: string; reason: string }> = [];
  let duplicateCount = 0;
  for (const raw of document.candidates) {
    const eventKind = requiredToken(raw.eventKind, "event kind", 80);
    const titleAr = requiredText(raw.titleAr, "Arabic title", 240);
    const startsOn = dateValue(raw.startsOn); const endsOn = dateValue(raw.endsOn);
    if (endsOn < startsOn) throw new ConflictException("A context candidate ends before it starts.");
    const locationCode = optionalToken(raw.locationCode, "location code", 80);
    const locationLabelAr = optionalText(raw.locationLabelAr, "location label", 160);
    if ((locationCode === null) !== (locationLabelAr === null)) throw new ConflictException("A context candidate location code and label must be supplied together.");
    const scope = locationCode ? "AREA" as const : "TENANT_GLOBAL" as const;
    const externalKey = requiredToken(raw.externalKey ?? `${sourceCode}:${eventKind}:${locationCode ?? "GLOBAL"}:${startsOn}:${endsOn}`, "external key", 240);
    const relevanceReasonAr = optionalText(raw.relevanceReasonAr, "relevance reason", 500);
    const sourceUpdatedAt = optionalInstant(raw.sourceUpdatedAt ?? document.sourceUpdatedAt);
    const payload = jsonObject(raw.payload);
    const checksum = sha({ sourceCode, externalKey, eventKind, titleAr, startsOn, endsOn, scope, locationCode, locationLabelAr, relevanceReasonAr, sourceUpdatedAt, payload });
    const candidate = { externalKey, eventKind, titleAr, startsOn, endsOn, scope, locationCode, locationLabelAr, relevanceReasonAr, sourceUpdatedAt, payload, checksum };
    const existing = byOccurrence.get(externalKey);
    if (!existing) { byOccurrence.set(externalKey, candidate); continue; }
    if (existing.checksum === checksum) { duplicateCount += 1; continue; }
    conflicts.push({ externalKey, reason: "The same candidate occurrence has conflicting fields in one document." });
  }
  return { candidates: [...byOccurrence.values()].filter((item) => !conflicts.some((conflict) => conflict.externalKey === item.externalKey)), duplicateCount, conflicts };
}

async function publishedDuplicate(transaction: Prisma.TransactionClient, tenantId: string, sourceId: string, externalKey: string, eventKind: string, titleAr: string, startsOn: Date | string, endsOn: Date | string, scope: "TENANT_GLOBAL" | "AREA", locationCode: string | null) {
  const exact = await transaction.decisionGlobalContextEvent.findFirst({ where: { tenantId, sourceId, externalKey, status: "PUBLISHED" }, select: { id: true } });
  if (exact) return exact;
  const start = typeof startsOn === "string" ? asDate(startsOn) : startsOn;
  const end = typeof endsOn === "string" ? asDate(endsOn) : endsOn;
  const matches = await transaction.decisionGlobalContextEvent.findMany({
    where: { tenantId, eventKind, scope, locationCode, status: "PUBLISHED", revisions: { some: { status: "PUBLISHED", startsOn: start, endsOn: end } } },
    select: { id: true, currentRevision: true, revisions: { select: { revision: true, titleAr: true, startsOn: true, endsOn: true, status: true } } },
    take: 10,
  });
  const title = titleAr.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar-SA");
  return matches.find((event) => event.revisions.some((revision) => revision.revision === event.currentRevision && revision.status === "PUBLISHED" && revision.startsOn.getTime() === start.getTime() && revision.endsOn.getTime() === end.getTime() && revision.titleAr.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar-SA") === title)) ?? null;
}

async function fetchResearchDocument(url: string, allowedHosts: readonly string[]) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname)) throw new ConflictException("The context researcher URL is not an approved HTTPS host.");
  const response = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("application/json")) throw new ConflictException("The approved researcher source did not provide a verified JSON document.");
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 2 * 1024 * 1024) throw new ConflictException("The context researcher document exceeds the size limit.");
  return { document: JSON.parse(raw) as unknown, checksum: sha(raw) };
}
function parseResearchDocument(value: unknown): ContextResearchDocumentV1 { if (!value || typeof value !== "object" || !Array.isArray((value as { candidates?: unknown }).candidates)) throw new ConflictException("The context researcher document has an unsupported schema."); return value as ContextResearchDocumentV1; }
function approvedResearchSource(sourceCode: string) { const source = APPROVED_CONTEXT_RESEARCH_SOURCES.find((item) => item.sourceCode === sourceCode); if (!source) throw new ConflictException("The requested context researcher source is not approved."); return source; }
function requiredText(value: unknown, label: string, max: number) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ConflictException(`A valid ${label} is required.`); return value.trim(); }
function optionalText(value: unknown, label: string, max: number) { if (value === undefined || value === null || value === "") return null; return requiredText(value, label, max); }
function requiredToken(value: unknown, label: string, max: number) { const result = requiredText(value, label, max).replace(/\s+/g, "_").toUpperCase(); if (!/^[A-Z0-9:_-]+$/.test(result)) throw new ConflictException(`A valid ${label} is required.`); return result; }
function optionalToken(value: unknown, label: string, max: number) { if (value === undefined || value === null || value === "") return null; return requiredToken(value, label, max); }
function dateValue(value: unknown) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ConflictException("A valid context candidate date is required."); const parsed = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new ConflictException("A valid context candidate date is required."); return value; }
function asDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function optionalInstant(value: unknown) { if (value === undefined || value === null || value === "") return null; if (typeof value !== "string" || Number.isNaN(new Date(value).valueOf())) throw new ConflictException("A context-source timestamp is invalid."); return new Date(value).toISOString(); }
function jsonObject(value: unknown): Prisma.InputJsonValue { if (value === undefined) return {}; if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException("A context candidate payload must be an object."); return value as Prisma.InputJsonValue; }
function sha(value: unknown) { return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex"); }
function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "Unknown context researcher failure."; }
