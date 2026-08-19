import { Controller, ForbiddenException, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { companyIdSchema, hrOverviewReceiptSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { HR_OVERVIEW_CAPABILITIES, HrOverviewService } from './hr-overview.service.js';

@Controller('hr/overview')
export class HrOverviewController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly overviewService: HrOverviewService,
  ) {}

  @Get()
  async overview(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company HR scope is not permitted.');
    const authorizationContext = await this.companyContext.authorizeAvailable({
      accessToken,
      companyId: parsedCompanyId.data,
      requestedCapabilities: HR_OVERVIEW_CAPABILITIES,
    });
    const context = {
      tenantId: authorizationContext.principal.tenantId,
      companyId: authorizationContext.company.id,
      actorUserId: authorizationContext.principal.userId,
    };
    return hrOverviewReceiptSchema.parse({
      companyId: context.companyId,
      ...(await this.overviewService.overview(context, authorizationContext.capabilities)),
    });
  }
}
