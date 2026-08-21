import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Put, Query, UnauthorizedException } from "@nestjs/common";
import {
  archiveDecisionCompanyContextEventRequestSchema,
  archiveDecisionGlobalContextEventRequestSchema,
  basiraDecisionAlertBriefSchema,
  createDecisionCompanyContextEventRequestSchema,
  createDecisionGlobalContextEventRequestSchema,
  decisionAlertFeedbackRequestSchema,
  decisionAlertListQuerySchema,
  decisionContextCandidateListQuerySchema,
  decisionContextTimelineQuerySchema,
  resolveDecisionContextCandidateRequestSchema,
  resolveDecisionGlobalContextReviewRequestSchema,
  runDecisionSalesChangeEvaluationRequestSchema,
  runDecisionSalesQualityEvaluationRequestSchema,
  updateDecisionAlertStatusRequestSchema,
  updateDecisionCompanyContextEventRequestSchema,
  updateDecisionGlobalContextEventRequestSchema,
  updateDecisionSalesChangePolicyRequestSchema,
} from "@baseer-erp/contracts";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { DecisionIntelligenceService } from "./decision-intelligence.service.js";
import { DecisionContextImportService } from "./decision-context-import.service.js";
import { DecisionContextResearchService } from "./decision-context-research.service.js";

const METRICS_READ = "decision.metrics.read";
const ALERTS_READ = "decision.alerts.read";
const ALERTS_MANAGE = "decision.alerts.manage";
const FEEDBACK_WRITE = "decision.feedback.write";
const CONTEXT_READ = "decision.context.read";
const CONTEXT_COMPANY_MANAGE = "decision.context.company.manage";
const AI_USE = "platform.ai.use";

@Controller("decision-intelligence")
export class DecisionIntelligenceController {
  constructor(private readonly contexts: CompanyContextService, private readonly decisions: DecisionIntelligenceService, private readonly contextImports: DecisionContextImportService, private readonly contextResearch: DecisionContextResearchService) {}

  @Post("context/sources/bootstrap")
  async bootstrapContextSources(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.contextImports.ensureApprovedSources(await this.context(authorization, companyId, "decision.context.global.manage"));
  }

  @Post("context/sources/:sourceCode/sync")
  async syncContextSource(@Param("sourceCode") sourceCode: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.contextImports.syncSource(await this.context(authorization, companyId, "decision.context.global.manage"), sourceCode, "MANUAL");
  }

  @Get("context/sources/import-runs")
  async contextImportRuns(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.contextImports.latestRuns(await this.context(authorization, companyId, "decision.context.global.manage"));
  }

  @Get("context/sources/health")
  async contextSourceHealth(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const context = await this.context(authorization, companyId, "decision.context.global.manage");
    // Source registration is a deterministic, idempotent code-owned seed. Do
    // it before reporting health so a new tenant sees "ready to scan" rather
    // than a misleading "not registered" state until someone presses a
    // separate bootstrap button.
    await Promise.all([this.contextImports.ensureApprovedSources(context), this.contextResearch.ensureApprovedSources(context)]);
    const [publicContext, research] = await Promise.all([this.contextImports.sourceHealth(context), this.contextResearch.sourceHealth(context)]);
    return [...publicContext, ...research];
  }

  @Get("context/reviews")
  async contextReviews(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.contextImports.listPendingReviews(await this.context(authorization, companyId, "decision.context.global.manage"));
  }

  @Post("context/reviews/resolve")
  async resolveContextReview(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = resolveDecisionGlobalContextReviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid global context-review resolution.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.contextImports.resolveReview(await this.context(authorization, companyId, "decision.context.global.manage"), input, idempotencyKey);
  }

  @Post("context/research/sources/bootstrap")
  async bootstrapContextResearchSources(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.contextResearch.ensureApprovedSources(await this.context(authorization, companyId, "decision.context.global.manage"));
  }

  @Post("context/research/sources/:sourceCode/sync")
  async syncContextResearchSource(@Param("sourceCode") sourceCode: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.contextResearch.syncSource(await this.context(authorization, companyId, "decision.context.global.manage"), sourceCode, "MANUAL");
  }

  @Get("context/research/candidates")
  async contextResearchCandidates(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = decisionContextCandidateListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid context-research candidate query.");
    return this.contextResearch.listCandidates(await this.context(authorization, companyId, "decision.context.global.manage"), parsed.data.status);
  }

  @Post("context/research/candidates/resolve")
  async resolveContextResearchCandidate(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = resolveDecisionContextCandidateRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid context-research candidate resolution.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.contextResearch.resolveCandidate(await this.context(authorization, companyId, "decision.context.global.manage"), input, idempotencyKey);
  }

  @Get("metrics/sales-daily")
  async salesMetric(@Query("from") from: string | undefined, @Query("to") to: string | undefined, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.decisions.readSalesMetric(await this.context(authorization, companyId, METRICS_READ), { from: date(from), to: date(to) });
  }

  @Get("metrics/sales-comparison")
  async salesComparison(@Query("from") from: string | undefined, @Query("to") to: string | undefined, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.decisions.readSalesComparison(await this.context(authorization, companyId, METRICS_READ), { from: date(from), to: date(to) });
  }

  @Get("metrics/sales-matched-weekday")
  async salesMatchedWeekday(@Query("date") businessDate: string | undefined, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.decisions.readSalesMatchedWeekdayComparison(await this.context(authorization, companyId, METRICS_READ), date(businessDate));
  }

  @Get("context/timeline")
  async timeline(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = decisionContextTimelineQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid context timeline request.");
    return this.decisions.listTimeline(await this.context(authorization, companyId, CONTEXT_READ), { from: date(parsed.data.from), to: date(parsed.data.to) });
  }

  @Post("context/company-events")
  async createCompanyEvent(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = createDecisionCompanyContextEventRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid company context-event request.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.createCompanyEvent(await this.context(authorization, companyId, CONTEXT_COMPANY_MANAGE), input, idempotencyKey);
  }

  @Post("context/company-events/:eventId/archive")
  async archiveCompanyEvent(@Param("eventId") eventId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = archiveDecisionCompanyContextEventRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid company context-event archive request.");
    return this.decisions.archiveCompanyEvent(await this.context(authorization, companyId, CONTEXT_COMPANY_MANAGE), eventId, parsed.data.reason, parsed.data.idempotencyKey);
  }

  @Put("context/company-events/:eventId")
  async updateCompanyEvent(@Param("eventId") eventId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateDecisionCompanyContextEventRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid company context-event update.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.updateCompanyEvent(await this.context(authorization, companyId, CONTEXT_COMPANY_MANAGE), eventId, input, idempotencyKey);
  }

  @Post("context/global-events")
  async createGlobalEvent(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = createDecisionGlobalContextEventRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid global context-event request.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.createManualGlobalEvent(await this.context(authorization, companyId, "decision.context.global.manage"), input, idempotencyKey);
  }

  @Put("context/global-events/:eventId")
  async updateGlobalEvent(@Param("eventId") eventId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateDecisionGlobalContextEventRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid global context-event update.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.updateManualGlobalEvent(await this.context(authorization, companyId, "decision.context.global.manage"), eventId, input, idempotencyKey);
  }

  @Post("context/global-events/:eventId/archive")
  async archiveGlobalEvent(@Param("eventId") eventId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = archiveDecisionGlobalContextEventRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid global context-event archive request.");
    return this.decisions.archiveManualGlobalEvent(await this.context(authorization, companyId, "decision.context.global.manage"), eventId, parsed.data.reason, parsed.data.idempotencyKey);
  }

  @Get("alerts")
  async alerts(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = decisionAlertListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid decision-alert query.");
    return this.decisions.listAlerts(await this.context(authorization, companyId, ALERTS_READ), parsed.data.status, parsed.data.pageSize);
  }

  @Get("alerts/:alertId/evidence")
  async alertEvidence(@Param("alertId") alertId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.decisions.readAlertEvidence(await this.context(authorization, companyId, ALERTS_READ), alertId);
  }

  /** Internal S2 Basira tool. It returns frozen, validated evidence only. */
  @Get("basira/alerts/:alertId/brief")
  async basiraAlertBrief(@Param("alertId") alertId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const context = await this.context(authorization, companyId, [AI_USE, ALERTS_READ, METRICS_READ, CONTEXT_READ]);
    return basiraDecisionAlertBriefSchema.parse(await this.decisions.readBasiraDecisionAlertBrief(context, alertId));
  }

  @Post("alerts/:alertId/status")
  async updateAlertStatus(@Param("alertId") alertId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateDecisionAlertStatusRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid decision-alert status request.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.updateAlertStatus(await this.context(authorization, companyId, ALERTS_MANAGE), alertId, input, idempotencyKey);
  }

  @Post("evaluations/sales-quality")
  async evaluateSalesQuality(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = runDecisionSalesQualityEvaluationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid sales-quality evaluation request.");
    return this.decisions.evaluateSalesQuality(await this.context(authorization, companyId, "decision.policy.manage"), { from: date(parsed.data.from), to: date(parsed.data.to) }, parsed.data.idempotencyKey);
  }

  @Get("policies/sales-change")
  async salesChangePolicy(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.decisions.salesChangePolicy(await this.context(authorization, companyId, "decision.policy.manage"));
  }

  @Put("policies/sales-change")
  async updateSalesChangePolicy(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = updateDecisionSalesChangePolicyRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid sales-change policy.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.updateSalesChangePolicy(await this.context(authorization, companyId, "decision.policy.manage"), input, idempotencyKey);
  }

  @Post("evaluations/sales-change")
  async evaluateSalesChange(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = runDecisionSalesChangeEvaluationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid sales-change evaluation request.");
    return this.decisions.evaluateSalesChange(await this.context(authorization, companyId, "decision.policy.manage"), { from: date(parsed.data.from), to: date(parsed.data.to) }, parsed.data.idempotencyKey);
  }

  @Post("alerts/feedback")
  async feedback(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = decisionAlertFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid decision-alert feedback request.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.feedback(await this.context(authorization, companyId, FEEDBACK_WRITE), input, idempotencyKey);
  }

  private async context(authorization: string | undefined, companyId: string | undefined, capability: string | readonly string[]) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    if (!companyId) throw new UnauthorizedException("Company decision scope is required.");
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: Array.isArray(capability) ? capability : [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

function date(value: string | undefined): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("A valid YYYY-MM-DD decision date is required.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException("A valid YYYY-MM-DD decision date is required.");
  return parsed;
}
