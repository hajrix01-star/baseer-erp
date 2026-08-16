import {
  companyFinanceSetupReceiptSchema,
  financeFoundationRefreshReceiptSchema,
  companyFinanceSetupRequestSchema,
  companyIdSchema,
  standardSupplierSyncReceiptSchema,
  standardSupplierSyncRequestSchema,
} from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { CompanyFinanceSetupService } from './company-finance-setup.service.js';

@Controller('finance/company-setup')
export class CompanyFinanceSetupController {
  constructor(private readonly companyContext: CompanyContextService, private readonly setup: CompanyFinanceSetupService) {}

  @Post('refresh-foundation')
  async refreshFoundation(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const authorized = await this.authorize(authorization, companyId);
    return financeFoundationRefreshReceiptSchema.parse(await this.setup.refreshFoundation(authorized));
  }

  @Post('standard-suppliers')
  async syncStandardSuppliers(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = standardSupplierSyncRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid standard-supplier sync request.');
    const authorized = await this.authorize(authorization, companyId);
    return standardSupplierSyncReceiptSchema.parse(await this.setup.syncStandardSuppliers(authorized, request.data.selectedStandardSupplierKeys, request.data.idempotencyKey));
  }

  @Post()
  @HttpCode(201)
  async initialize(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = companyFinanceSetupRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid company-finance setup request.');
    const authorized = await this.authorize(authorization, companyId);
    const receipt = await this.setup.initialize(authorized, {
      fiscalPeriodNameAr: request.data.fiscalPeriodNameAr,
      fiscalPeriodNameEn: request.data.fiscalPeriodNameEn,
      fiscalPeriodStartDate: request.data.fiscalPeriodStartDate,
      fiscalPeriodEndDate: request.data.fiscalPeriodEndDate,
      selectedVaults: request.data.selectedVaults,
      selectedStandardSupplierKeys: request.data.selectedStandardSupplierKeys,
    }, request.data.idempotencyKey);
    return companyFinanceSetupReceiptSchema.parse(receipt);
  }

  private async authorize(authorization?: string, companyId?: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: ['finance.setup.write'] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
