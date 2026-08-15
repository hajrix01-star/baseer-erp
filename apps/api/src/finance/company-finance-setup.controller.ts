import {
  companyFinanceSetupReceiptSchema,
  companyFinanceSetupRequestSchema,
  companyIdSchema,
} from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { CompanyFinanceSetupService } from './company-finance-setup.service.js';

@Controller('finance/company-setup')
export class CompanyFinanceSetupController {
  constructor(private readonly companyContext: CompanyContextService, private readonly setup: CompanyFinanceSetupService) {}

  @Post()
  @HttpCode(201)
  async initialize(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = companyFinanceSetupRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid company-finance setup request.');
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: ['finance.setup.write'] });
    const receipt = await this.setup.initialize({ tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId }, {
      fiscalPeriodNameAr: request.data.fiscalPeriodNameAr,
      fiscalPeriodNameEn: request.data.fiscalPeriodNameEn,
      fiscalPeriodStartDate: request.data.fiscalPeriodStartDate,
      fiscalPeriodEndDate: request.data.fiscalPeriodEndDate,
      selectedVaults: request.data.selectedVaults,
    }, request.data.idempotencyKey);
    return companyFinanceSetupReceiptSchema.parse(receipt);
  }
}
