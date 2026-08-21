import { Controller, ForbiddenException, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { CompanyContextService } from '../company-context/company-context.service.js';
import { ReportCatalogService, REPORTS_READ_CAPABILITY } from './report-catalog.service.js';

@Controller('reports')
export class ReportCatalogController {
  constructor(private readonly contexts: CompanyContextService, private readonly reportCatalog: ReportCatalogService) {}
  @Get('catalogue') async catalogue(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [REPORTS_READ_CAPABILITY] });
    return { companyId: authorized.company.id, reports: await this.reportCatalog.list({
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    }) };
  }
}
