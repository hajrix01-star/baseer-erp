import { availableCompaniesReceiptSchema } from '@baseer-erp/contracts';
import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';

import { CompanyAccessService } from './company-access.service.js';

@Controller('companies')
export class CompanyAccessController {
  constructor(private readonly access: CompanyAccessService) {}

  @Get('available')
  async listAvailable(@Headers('authorization') authorization?: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    return availableCompaniesReceiptSchema.parse({ companies: await this.access.listAvailableCompanies(accessToken) });
  }
}