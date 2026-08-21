import { BadRequestException, Body, Controller, Get, Headers, Post, Query, UnauthorizedException } from "@nestjs/common";
import {
  createDecisionCompanyContextEventRequestSchema,
  decisionAlertFeedbackRequestSchema,
  decisionAlertListQuerySchema,
  decisionContextTimelineQuerySchema,
  runDecisionSalesQualityEvaluationRequestSchema,
} from "@baseer-erp/contracts";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { DecisionIntelligenceService } from "./decision-intelligence.service.js";

const METRICS_READ = "decision.metrics.read";
const ALERTS_READ = "decision.alerts.read";
const FEEDBACK_WRITE = "decision.feedback.write";
const CONTEXT_READ = "decision.context.read";
const CONTEXT_COMPANY_MANAGE = "decision.context.company.manage";

@Controller("decision-intelligence")
export class DecisionIntelligenceController {
  constructor(private readonly contexts: CompanyContextService, private readonly decisions: DecisionIntelligenceService) {}

  @Get("metrics/sales-daily")
  async salesMetric(@Query("from") from: string | undefined, @Query("to") to: string | undefined, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return this.decisions.readSalesMetric(await this.context(authorization, companyId, METRICS_READ), { from: date(from), to: date(to) });
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

  @Get("alerts")
  async alerts(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = decisionAlertListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid decision-alert query.");
    return this.decisions.listAlerts(await this.context(authorization, companyId, ALERTS_READ), parsed.data.status, parsed.data.pageSize);
  }

  @Post("evaluations/sales-quality")
  async evaluateSalesQuality(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = runDecisionSalesQualityEvaluationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid sales-quality evaluation request.");
    return this.decisions.evaluateSalesQuality(await this.context(authorization, companyId, "decision.policy.manage"), { from: date(parsed.data.from), to: date(parsed.data.to) }, parsed.data.idempotencyKey);
  }

  @Post("alerts/feedback")
  async feedback(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = decisionAlertFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid decision-alert feedback request.");
    const { idempotencyKey, ...input } = parsed.data;
    return this.decisions.feedback(await this.context(authorization, companyId, FEEDBACK_WRITE), input, idempotencyKey);
  }

  private async context(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    if (!companyId) throw new UnauthorizedException("Company decision scope is required.");
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

function date(value: string | undefined): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("A valid YYYY-MM-DD decision date is required.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException("A valid YYYY-MM-DD decision date is required.");
  return parsed;
}
