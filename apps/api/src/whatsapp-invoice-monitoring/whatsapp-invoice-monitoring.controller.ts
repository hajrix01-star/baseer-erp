import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, Patch, Post, Query, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { companyIdSchema, configureWhatsappInvoiceConnectionRequestSchema, createWhatsappInvoiceGroupBindingRequestSchema, deleteWhatsappInvoiceGroupBindingRequestSchema, updateWhatsappInvoiceGroupBindingRequestSchema, updateWhatsappInvoiceMonitoringRecordRequestSchema, whatsappInvoiceConnectionControlReceiptSchema, whatsappInvoiceConnectionQrReceiptSchema, whatsappInvoiceMonitoringDetailSchema, whatsappInvoiceMonitoringQuerySchema, whatsappInvoiceMonitoringRecordPageSchema, whatsappInvoiceMonitoringSettingsSchema, whatsappInvoiceMonitoringSummarySchema, whatsappInvoiceMonitoringWorkspaceSchema } from "@baseer-erp/contracts";
import { CompanyContextService } from "../company-context/company-context.service.js";
import { WhatsappInvoiceBaileysPilotConnectorService } from "./whatsapp-invoice-baileys-connector.service.js";
import { WhatsappInvoiceMonitoringService } from "./whatsapp-invoice-monitoring.service.js";
import { WhatsappInvoiceAssetStorageService } from "./whatsapp-invoice-asset-storage.service.js";
import { WhatsappInvoiceMonitoringSettingsService } from "./whatsapp-invoice-monitoring-settings.service.js";

@Controller("whatsapp-invoice-monitoring")
export class WhatsappInvoiceMonitoringController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly monitoring: WhatsappInvoiceMonitoringService,
    private readonly assetStorage: WhatsappInvoiceAssetStorageService,
    private readonly settingsService: WhatsappInvoiceMonitoringSettingsService,
    private readonly connector: WhatsappInvoiceBaileysPilotConnectorService,
  ) {}

  @Get("workspace")
  async workspace(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = whatsappInvoiceMonitoringQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid WhatsApp invoice monitoring query.");
    return whatsappInvoiceMonitoringWorkspaceSchema.parse(await this.monitoring.workspace(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.read"), parsed.data));
  }

  @Get("summary")
  async summary(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = whatsappInvoiceMonitoringQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid WhatsApp invoice monitoring query.");
    return whatsappInvoiceMonitoringSummarySchema.parse(await this.monitoring.summary(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.read"), parsed.data));
  }

  @Get("records")
  async records(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = whatsappInvoiceMonitoringQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid WhatsApp invoice monitoring query.");
    return whatsappInvoiceMonitoringRecordPageSchema.parse(await this.monitoring.records(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.read"), parsed.data));
  }

  @Get("settings")
  async settings(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return whatsappInvoiceMonitoringSettingsSchema.parse(await this.monitoring.settings(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.read")));
  }

  @Post("settings/connection")
  async configureConnection(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = configureWhatsappInvoiceConnectionRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid WhatsApp personal connection configuration.");
    return whatsappInvoiceMonitoringSettingsSchema.shape.connection.parse(await this.settingsService.configureConnection(await this.authorizeConnectionControl(authorization, companyId), request.data));
  }

  @Post("settings/connection/start")
  async startConnection(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const context = await this.authorizeConnectionControl(authorization, companyId);
    const scope = await this.settingsService.connectionControlScope(context);
    await this.connector.start(scope);
    await this.settingsService.auditConnectionControl(context, scope, "start_requested");
    const settings = await this.monitoring.settings(context);
    return whatsappInvoiceConnectionControlReceiptSchema.parse({ connectionId: scope.connectionId, status: settings.connection.status });
  }

  @Post("settings/connection/stop")
  async stopConnection(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const context = await this.authorizeConnectionControl(authorization, companyId);
    const scope = await this.settingsService.connectionControlScope(context);
    await this.connector.stop(scope);
    await this.settingsService.auditConnectionControl(context, scope, "stop_requested");
    const settings = await this.monitoring.settings(context);
    return whatsappInvoiceConnectionControlReceiptSchema.parse({ connectionId: scope.connectionId, status: settings.connection.status });
  }

  @Get("settings/connection/qr")
  async connectionQr(@Headers("authorization") authorization: string | undefined, @Headers("x-baseer-company-id") companyId: string | undefined, @Res() reply: FastifyReply) {
    const scope = await this.settingsService.connectionControlScope(await this.authorizeConnectionControl(authorization, companyId));
    const result = this.connector.qr(scope);
    const qr = whatsappInvoiceConnectionQrReceiptSchema.parse({ qr: result.qr, expiresAt: result.expiresAt?.toISOString() ?? null });
    return reply.header("Cache-Control", "private, no-store").header("Pragma", "no-cache").send(qr);
  }

  @Get("settings/pilot/groups")
  async pilotGroups(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const scope = await this.settingsService.connectionControlScope(await this.authorizeConnectionControl(authorization, companyId));
    return this.connector.groups(scope);
  }

  @Post("settings/groups")
  @HttpCode(201)
  async createGroupBinding(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createWhatsappInvoiceGroupBindingRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid WhatsApp group binding.");
    return whatsappInvoiceMonitoringSettingsSchema.shape.groupBindings.element.parse(await this.settingsService.createGroupBinding(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.review"), request.data));
  }

  @Patch("settings/groups/:bindingId")
  async updateGroupBinding(@Param("bindingId") bindingId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsedId = companyIdSchema.safeParse(bindingId); if (!parsedId.success) throw new BadRequestException("Invalid WhatsApp group binding identifier.");
    const request = updateWhatsappInvoiceGroupBindingRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid WhatsApp group binding update.");
    return whatsappInvoiceMonitoringSettingsSchema.shape.groupBindings.element.parse(await this.settingsService.updateGroupBinding(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.review"), parsedId.data, request.data));
  }

  @Delete("settings/groups/:bindingId")
  async deleteGroupBinding(@Param("bindingId") bindingId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsedId = companyIdSchema.safeParse(bindingId); if (!parsedId.success) throw new BadRequestException("Invalid WhatsApp group binding identifier.");
    const request = deleteWhatsappInvoiceGroupBindingRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid WhatsApp group binding deletion.");
    return whatsappInvoiceMonitoringSettingsSchema.shape.groupBindings.element.parse(await this.settingsService.deleteGroupBinding(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.review"), parsedId.data, request.data));
  }

  @Get("assets/:assetId/content")
  async assetContent(@Param("assetId") assetId: string, @Query("disposition") disposition: string | undefined, @Headers("authorization") authorization: string | undefined, @Headers("x-baseer-company-id") companyId: string | undefined, @Res() reply: FastifyReply) {
    const parsedAssetId = companyIdSchema.safeParse(assetId); if (!parsedAssetId.success) throw new BadRequestException("Invalid WhatsApp invoice asset identifier.");
    if (disposition !== undefined && disposition !== "inline" && disposition !== "attachment") throw new BadRequestException("Invalid WhatsApp invoice asset content disposition.");
    const content = await this.assetStorage.readAuthorized(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.read"), parsedAssetId.data);
    const filename = encodeURIComponent(content.fileName).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return reply
      .header("Cache-Control", "private, no-store")
      .header("Pragma", "no-cache")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox")
      .header("Content-Disposition", `${disposition === "attachment" ? "attachment" : "inline"}; filename*=UTF-8''${filename}`)
      .type(content.mimeType)
      .send(content.bytes);
  }

  @Get("records/:recordId")
  async detail(@Param("recordId") recordId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return whatsappInvoiceMonitoringDetailSchema.parse(await this.monitoring.detail(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.read"), recordId));
  }

  @Patch("records/:recordId")
  async update(@Param("recordId") recordId: string, @Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateWhatsappInvoiceMonitoringRecordRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid WhatsApp invoice monitoring correction.");
    return whatsappInvoiceMonitoringDetailSchema.shape.record.parse(await this.monitoring.updateRecord(await this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.review"), recordId, request.data));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]; if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new ForbiddenException("Company WhatsApp invoice monitoring scope is not permitted.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }

  private async authorizeConnectionControl(authorization: string | undefined, companyId: string | undefined) {
    return this.authorize(authorization, companyId, "operations.whatsapp_invoice_monitoring.connection.manage");
  }
}
