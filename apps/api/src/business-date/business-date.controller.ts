import {
  businessDateResolveRequestSchema,
  businessDateResolutionSchema,
  companyIdSchema,
} from '@baseer-erp/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { BusinessDateService } from './business-date.service.js';

@Controller('business-date')
export class BusinessDateController {
  constructor(private readonly businessDate: BusinessDateService) {}

  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = businessDateResolveRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid business date request.');
    const value = await this.businessDate.resolve({
      accessToken: this.accessToken(authorization),
      companyId: this.companyId(companyId),
      intent: request.data.intent,
    });
    return businessDateResolutionSchema.parse(value);
  }

  private accessToken(value: string | undefined): string {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    if (!match?.[1]) throw new UnauthorizedException('Invalid authentication credentials.');
    return match[1];
  }

  private companyId(value: string | undefined): string {
    const parsed = companyIdSchema.safeParse(value);
    if (!parsed.success) throw new ForbiddenException('Company business-date scope is not permitted.');
    return parsed.data;
  }
}
