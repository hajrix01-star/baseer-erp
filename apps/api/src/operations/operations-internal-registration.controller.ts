import { createOperationsInternalRegistrationRequestSchema, companyIdSchema, operationsEntityReceiptSchema, operationsInternalRegistrationReportQuerySchema, operationsInternalRegistrationReportReceiptSchema, operationsInternalRegistrationWorkspaceSchema } from "@baseer-erp/contracts";
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { OperationsInternalRegistrationService } from "./operations-internal-registration.service.js";

@Controller("operations/internal-registration")
export class OperationsInternalRegistrationController {
  constructor(private readonly companyContext: CompanyContextService, private readonly registrations: OperationsInternalRegistrationService) {}

  @Get("workstation") async workstation(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) { return operationsInternalRegistrationWorkspaceSchema.parse(await this.registrations.workstation(await this.authorize(authorization, companyId))); }
  @Get("report") async report(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) { const parsed = operationsInternalRegistrationReportQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid internal registration report period."); return operationsInternalRegistrationReportReceiptSchema.parse(await this.registrations.report(await this.authorize(authorization, companyId, "operations.internal_registration.read"), parsed.data)); }
  @Post() @HttpCode(201) async create(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) { const request = createOperationsInternalRegistrationRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid internal registration."); return operationsEntityReceiptSchema.parse(await this.registrations.create(await this.authorize(authorization, companyId), request.data)); }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability = "operations.internal_registration.create") { const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]; if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials."); const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new ForbiddenException("Company operations scope is not permitted."); const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] }); return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId }; }
}
