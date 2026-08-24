import { companyIdSchema, operationsOverviewQuerySchema, operationsOverviewReadSchema } from "@baseer-erp/contracts";
import { BadRequestException, Controller, ForbiddenException, Get, Headers, Query, UnauthorizedException } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { OperationsOverviewService } from "./operations-overview.service.js";

@Controller("operations/overview")
export class OperationsOverviewController {
  constructor(private readonly companyContext: CompanyContextService, private readonly overview: OperationsOverviewService) {}

  @Get()
  async currentMonth(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = operationsOverviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid operations overview period.");
    const context = await this.authorize(authorization, companyId);
    return operationsOverviewReadSchema.parse(await this.overview.period(context, {
      ...(parsed.data.fromBusinessDate ? { fromBusinessDate: parsed.data.fromBusinessDate } : {}),
      ...(parsed.data.toBusinessDate ? { toBusinessDate: parsed.data.toBusinessDate } : {}),
    }));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException("Company operations scope is not permitted.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: ["finance.daily_sales.read", "finance.purchase_expense.read"] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
