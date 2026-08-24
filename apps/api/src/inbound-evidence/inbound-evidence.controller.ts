import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  createInboundEvidenceLabelRequestSchema,
  createInboundEvidenceRuleRequestSchema,
  deleteInboundEvidenceLabelRequestSchema,
  deleteInboundEvidenceRuleRequestSchema,
  inboundEvidenceEntityReceiptSchema,
  inboundEvidenceAuthorizationStartSchema,
  inboundEvidenceGmailConnectionSchema,
  inboundEvidenceGmailReadinessSchema,
  inboundEvidenceMessagesReadSchema,
  analyzeInboundEvidenceAttachmentRequestSchema,
  inboundEvidenceAttachmentAnalysesReadSchema,
  inboundEvidenceDocumentAnalysisSchema,
  inboundEvidenceSyncReceiptSchema,
  inboundEvidenceSyncRequestSchema,
  inboundEvidenceHubWorkspaceSchema,
  updateInboundEvidenceLabelRequestSchema,
  updateInboundEvidenceRuleRequestSchema,
} from "@baseer-erp/contracts";
import { TenantAdministrationContextService } from "../administration/tenant-administration-context.service.js";
import { InboundEvidenceService } from "./inbound-evidence.service.js";
import { InboundEvidenceGmailService } from "./inbound-evidence-gmail.service.js";
import { InboundEvidenceDocumentIntelligenceService } from "./inbound-evidence-document-intelligence.service.js";

@Controller("inbound-evidence")
export class InboundEvidenceController {
  constructor(private readonly context: TenantAdministrationContextService, private readonly inboundEvidence: InboundEvidenceService, private readonly gmail: InboundEvidenceGmailService, private readonly documentIntelligence: InboundEvidenceDocumentIntelligenceService) {}

  @Get()
  async workspace(@Headers("authorization") authorization?: string) {
    return inboundEvidenceHubWorkspaceSchema.parse(await this.inboundEvidence.workspace(await this.owner(authorization)));
  }

  @Post("labels") @HttpCode(201)
  async createLabel(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = createInboundEvidenceLabelRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid inbound evidence Label request.");
    return inboundEvidenceEntityReceiptSchema.parse(await this.inboundEvidence.createLabel(await this.owner(authorization), request.data));
  }

  @Put("labels/:labelId")
  async updateLabel(@Param("labelId") labelId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = updateInboundEvidenceLabelRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid inbound evidence Label update.");
    return inboundEvidenceEntityReceiptSchema.parse(await this.inboundEvidence.updateLabel(await this.owner(authorization), labelId, request.data));
  }

  @Delete("labels/:labelId")
  async deleteLabel(@Param("labelId") labelId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = deleteInboundEvidenceLabelRequestSchema.safeParse(body ?? {});
    if (!request.success) throw new BadRequestException("Invalid inbound evidence Label deletion.");
    return inboundEvidenceEntityReceiptSchema.parse(await this.inboundEvidence.deleteLabel(await this.owner(authorization), labelId, request.data.idempotencyKey));
  }

  @Post("rules") @HttpCode(201)
  async createRule(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = createInboundEvidenceRuleRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid inbound evidence rule request.");
    return inboundEvidenceEntityReceiptSchema.parse(await this.inboundEvidence.createRule(await this.owner(authorization), request.data));
  }

  @Put("rules/:ruleId")
  async updateRule(@Param("ruleId") ruleId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = updateInboundEvidenceRuleRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid inbound evidence rule update.");
    return inboundEvidenceEntityReceiptSchema.parse(await this.inboundEvidence.updateRule(await this.owner(authorization), ruleId, request.data));
  }

  @Delete("rules/:ruleId")
  async deleteRule(@Param("ruleId") ruleId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = deleteInboundEvidenceRuleRequestSchema.safeParse(body ?? {});
    if (!request.success) throw new BadRequestException("Invalid inbound evidence rule deletion.");
    return inboundEvidenceEntityReceiptSchema.parse(await this.inboundEvidence.deleteRule(await this.owner(authorization), ruleId, request.data.idempotencyKey));
  }

  @Get("gmail")
  async gmailConnection(@Headers("authorization") authorization?: string) {
    return inboundEvidenceGmailConnectionSchema.parse(await this.gmail.connection(await this.owner(authorization)));
  }

  @Get("gmail/readiness")
  async gmailReadiness(@Headers("authorization") authorization?: string) {
    return inboundEvidenceGmailReadinessSchema.parse(this.gmail.readiness(await this.owner(authorization)));
  }

  @Post("gmail/authorization")
  async beginGmailAuthorization(@Headers("authorization") authorization?: string) {
    return inboundEvidenceAuthorizationStartSchema.parse(await this.gmail.beginAuthorization(await this.owner(authorization)));
  }

  /** OAuth callback is public by design; the single-use state binds it to one tenant and owner. */
  @Get("gmail/callback")
  async gmailCallback(@Query("state") state: string | undefined, @Query("code") code: string | undefined, @Query("error") error: string | undefined, @Res() reply: FastifyReply) {
    if (error || !state || !code) return reply.code(400).type("text/html; charset=utf-8").send("<h1>تعذر ربط Gmail</h1><p>ألغيت الموافقة أو لم تكتمل. أعد المحاولة من Baseer.</p>");
    const connected = await this.gmail.completeAuthorization(state, code);
    return reply.type("text/html; charset=utf-8").send(`<h1>تم ربط Gmail بنجاح</h1><p>${this.escape(connected.mailboxEmail)} مرتبط للقراءة فقط. يمكنك العودة إلى Baseer وإجراء المزامنة.</p>`);
  }

  @Post("gmail/sync")
  async syncGmail(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = inboundEvidenceSyncRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid Gmail synchronization request.");
    return inboundEvidenceSyncReceiptSchema.parse(await this.gmail.syncWithKey(await this.owner(authorization), request.data.maxMessages, request.data.idempotencyKey));
  }

  @Get("messages")
  async messages(@Headers("authorization") authorization?: string) {
    return inboundEvidenceMessagesReadSchema.parse(await this.gmail.messages(await this.owner(authorization)));
  }

  @Get("attachments/:attachmentId/download")
  async downloadAttachment(@Param("attachmentId") attachmentId: string, @Headers("authorization") authorization: string | undefined, @Res() reply: FastifyReply) {
    const file = await this.gmail.downloadAttachment(await this.owner(authorization), attachmentId);
    return reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`).type(file.mimeType).send(file.bytes);
  }

  @Post("attachments/:attachmentId/analyze")
  async analyzeAttachment(@Param("attachmentId") attachmentId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    const request = analyzeInboundEvidenceAttachmentRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid document-analysis request.");
    return inboundEvidenceDocumentAnalysisSchema.parse(await this.documentIntelligence.analyze(await this.owner(authorization), attachmentId, request.data));
  }

  @Get("attachments/:attachmentId/analyses")
  async attachmentAnalyses(@Param("attachmentId") attachmentId: string, @Headers("authorization") authorization?: string) {
    return inboundEvidenceAttachmentAnalysesReadSchema.parse({ analyses: await this.documentIntelligence.list(await this.owner(authorization), attachmentId) });
  }

  private owner(value?: string) {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
    if (!match?.[1]) throw new UnauthorizedException("Invalid authentication credentials.");
    return this.context.authorizeOwner(match[1]);
  }
  private escape(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character)); }
}
