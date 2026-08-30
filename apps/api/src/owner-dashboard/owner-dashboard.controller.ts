import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { ownerFinancialMovementDashboardReceiptSchema } from "@baseer-erp/contracts";

import { TenantAdministrationContextService } from "../administration/tenant-administration-context.service.js";
import { OwnerDashboardService } from "./owner-dashboard.service.js";

/** The owner dashboard never accepts a company id: the server scopes it to
 * all active companies in the authenticated owner's tenant. */
@Controller("owner/dashboard")
export class OwnerDashboardController {
  constructor(
    private readonly tenantAdministration: TenantAdministrationContextService,
    private readonly ownerDashboard: OwnerDashboardService,
  ) {}

  @Get("financial-movement")
  async financialMovement(@Headers("authorization") authorization?: string) {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new UnauthorizedException("Invalid authentication credentials.");
    return ownerFinancialMovementDashboardReceiptSchema.parse(
      await this.ownerDashboard.financialMovement(await this.tenantAdministration.authorizeOwner(token)),
    );
  }
}
