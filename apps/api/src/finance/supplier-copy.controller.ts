import {
  companyIdSchema,
  copySupplierRequestSchema,
  supplierCopyCandidatesReceiptSchema,
  supplierCopyReceiptSchema,
} from '@baseer-erp/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { SupplierCopyService } from './supplier-copy.service.js';

@Controller('finance/supplier-copy')
export class SupplierCopyController {
  constructor(private readonly supplierCopy: SupplierCopyService) {}

  @Get('candidates')
  async candidates(
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const receipt = await this.supplierCopy.listCandidates({
      accessToken: this.accessToken(authorization),
      targetCompanyId: this.companyId(companyId),
    });
    return supplierCopyCandidatesReceiptSchema.parse(receipt);
  }

  @Post()
  @HttpCode(201)
  async copy(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = copySupplierRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid supplier-copy request.');
    const receipt = await this.supplierCopy.copy({
      accessToken: this.accessToken(authorization),
      targetCompanyId: this.companyId(companyId),
      request: request.data,
    });
    return supplierCopyReceiptSchema.parse(receipt);
  }

  private accessToken(value: string | undefined): string {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    if (!match?.[1]) throw new UnauthorizedException('Invalid authentication credentials.');
    return match[1];
  }

  private companyId(value: string | undefined): string {
    const parsed = companyIdSchema.safeParse(value);
    if (!parsed.success) throw new ForbiddenException('Company supplier scope is not permitted.');
    return parsed.data;
  }
}
