import { companyIdSchema, operationsInventoryBalanceQuerySchema, operationsInventoryBalancesReceiptSchema, operationsInventoryLedgerQuerySchema, operationsInventoryLedgerReceiptSchema } from "@baseer-erp/contracts";
import { BadRequestException, Controller, ForbiddenException, Get, Headers, Query, UnauthorizedException } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { OperationsInventoryReportingService } from "./operations-inventory-reporting.service.js";

@Controller("operations/inventory")
export class OperationsInventoryReportingController {
  constructor(private readonly companyContext: CompanyContextService, private readonly inventory: OperationsInventoryReportingService) {}

  @Get("balances")
  async balances(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = operationsInventoryBalanceQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid inventory balance query.");
    return operationsInventoryBalancesReceiptSchema.parse(await this.inventory.balances(await this.authorize(authorization, companyId), parsed.data));
  }

  @Get("ledger")
  async ledger(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = operationsInventoryLedgerQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid inventory ledger query.");
    return operationsInventoryLedgerReceiptSchema.parse(await this.inventory.ledger(await this.authorize(authorization, companyId), parsed.data));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]; if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new ForbiddenException("Company operations scope is not permitted.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: ["operations.inventory.read"] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
