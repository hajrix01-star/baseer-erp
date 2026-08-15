import { companyIdSchema, financePeriodActionReceiptSchema, financePeriodActionRequestSchema } from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { FinancePeriodCommandService } from './finance-period-command.service.js';

const PERIODS_WRITE_CAPABILITY = 'finance.periods.write';

@Controller('finance/periods')
export class FinancePeriodCommandController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly periods: FinancePeriodCommandService,
  ) {}

  @Post('close')
  @HttpCode(200)
  async close(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = this.request(body);
    if (!request.reason) throw new BadRequestException('A close reason is required.');
    return financePeriodActionReceiptSchema.parse(
      await this.periods.close(await this.context(authorization, companyId), request.periodId, request.reason, request.idempotencyKey),
    );
  }

  @Post('lock')
  @HttpCode(200)
  async lock(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = this.request(body);
    return financePeriodActionReceiptSchema.parse(
      await this.periods.lock(await this.context(authorization, companyId), request.periodId, request.idempotencyKey),
    );
  }

  @Post('reopen')
  @HttpCode(200)
  async reopen(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = this.request(body);
    if (!request.reason) throw new BadRequestException('A reopen reason is required.');
    return financePeriodActionReceiptSchema.parse(
      await this.periods.reopen(await this.context(authorization, companyId), request.periodId, request.reason, request.idempotencyKey),
    );
  }

  private request(body: unknown) {
    const parsed = financePeriodActionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid fiscal-period request.');
    return parsed.data;
  }

  private async context(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({
      accessToken,
      companyId: parsedCompanyId.data,
      requiredCapabilities: [PERIODS_WRITE_CAPABILITY],
    });
    return {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
  }
}