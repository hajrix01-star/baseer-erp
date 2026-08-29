import {
  companyIdSchema,
  outputPrintIssuedRequestSchema,
  outputReportCodeSchema,
  outputRequestSchema,
  outputReceiptSchema,
} from '@baseer-erp/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { OutputService } from './output.service.js';

@Controller('outputs')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ authIp: true, authIdentity: true, report: true, fileWrite: true, attendancePin: true })
@Throttle({ output: { limit: 20, ttl: 60_000, blockDuration: 60_000 } })
export class OutputController {
  constructor(private readonly output: OutputService) {}

  @Post('print-issued')
  @HttpCode(204)
  async printIssued(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ): Promise<void> {
    const request = outputPrintIssuedRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid output print receipt.');
    await this.output.recordPrintIssued({
      accessToken: this.accessToken(authorization),
      companyId: this.companyId(companyId),
      idempotencyReceiptId: request.data.idempotencyReceiptId,
    });
  }

  @Post(':reportCode')
  @HttpCode(200)
  async generate(
    @Param('reportCode') reportCode: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = outputRequestSchema.safeParse(body);
    const code = outputReportCodeSchema.safeParse(reportCode);
    if (!request.success || !code.success) throw new BadRequestException('Invalid output request.');
    const receipt = await this.output.generate({
      accessToken: this.accessToken(authorization),
      companyId: this.companyId(companyId),
      reportCode: code.data,
      request: request.data,
    });
    return outputReceiptSchema.parse(receipt);
  }

  private accessToken(value: string | undefined): string {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    if (!match?.[1]) throw new UnauthorizedException('Invalid authentication credentials.');
    return match[1];
  }

  private companyId(value: string | undefined): string {
    const parsed = companyIdSchema.safeParse(value);
    if (!parsed.success) throw new ForbiddenException('Company output scope is not permitted.');
    return parsed.data;
  }
}
