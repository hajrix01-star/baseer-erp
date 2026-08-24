import { companyIdSchema, expensesObligationsWorkspaceReceiptSchema } from '@baseer-erp/contracts';
import { Controller, ForbiddenException, Get, Headers, UnauthorizedException } from '@nestjs/common';

import { ExpensesObligationsReadService } from './expenses-obligations-read.service.js';

@Controller('finance/expenses-obligations-workspace')
export class ExpensesObligationsReadController {
  constructor(private readonly workspace: ExpensesObligationsReadService) {}

  @Get()
  async read(
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    return expensesObligationsWorkspaceReceiptSchema.parse(await this.workspace.read(this.input(authorization, companyId)));
  }

  @Get('items')
  async items(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    return this.workspace.readItems(this.input(authorization, companyId));
  }

  @Get('batch')
  async batch(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    return this.workspace.readBatch(this.input(authorization, companyId));
  }

  @Get('history')
  async history(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    return this.workspace.readHistory(this.input(authorization, companyId));
  }

  private input(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    return { accessToken, companyId: parsedCompanyId.data };
  }
}
