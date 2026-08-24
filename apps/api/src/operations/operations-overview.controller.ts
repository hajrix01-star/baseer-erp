import { companyIdSchema, operationsOverviewReadSchema } from "@baseer-erp/contracts";
import { Controller, ForbiddenException, Get, Headers, UnauthorizedException } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { OperationsOverviewService } from "./operations-overview.service.js";

@Controller("operations/overview")
export class OperationsOverviewController {
  constructor(private readonly companyContext: CompanyContextService, private readonly overview: OperationsOverviewService) {}

  @Get()
  async currentMonth(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const context = await this.authorize(authorization, companyId);
    return operationsOverviewReadSchema.parse(await this.overview.currentMonth(context));
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
