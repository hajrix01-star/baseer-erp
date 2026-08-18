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
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    return expensesObligationsWorkspaceReceiptSchema.parse(
      await this.workspace.read({ accessToken, companyId: parsedCompanyId.data }),
    );
  }
}