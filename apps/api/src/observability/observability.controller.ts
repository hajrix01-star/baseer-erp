import {
  companyIdSchema,
  observabilitySummaryReceiptSchema,
} from '@baseer-erp/contracts';
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { ObservabilityService } from './observability.service.js';

@Controller('observability')
export class ObservabilityController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly observability: ObservabilityService,
  ) {}

  @Get('summary')
  async summary(
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    await this.companyContext.authorize({
      accessToken: this.accessToken(authorization),
      companyId: this.companyId(companyId),
      requiredCapabilities: ['platform.observability.read'],
    });
    return observabilitySummaryReceiptSchema.parse(await this.observability.summary());
  }

  private accessToken(value: string | undefined): string {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    if (!match?.[1]) throw new UnauthorizedException('Invalid authentication credentials.');
    return match[1];
  }

  private companyId(value: string | undefined): string {
    const parsed = companyIdSchema.safeParse(value);
    if (!parsed.success) throw new ForbiddenException('Company observability scope is not permitted.');
    return parsed.data;
  }
}
