import {
  companyIdSchema,
  createFileMetadataRequestSchema,
  fileMetadataIdSchema,
  fileMetadataReceiptSchema,
} from '@baseer-erp/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { FileMetadataService } from './file-metadata.service.js';

@Controller('file-metadata')
export class FileMetadataController {
  constructor(private readonly files: FileMetadataService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = createFileMetadataRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid file metadata request.');
    const receipt = await this.files.create({
      accessToken: this.accessToken(authorization),
      companyId: this.companyId(companyId),
      request: request.data,
    });
    return fileMetadataReceiptSchema.parse(receipt);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const parsedId = fileMetadataIdSchema.safeParse(id);
    if (!parsedId.success) throw new BadRequestException('Invalid file metadata identifier.');
    const receipt = await this.files.findOne({
      accessToken: this.accessToken(authorization),
      companyId: this.companyId(companyId),
      id: parsedId.data,
    });
    return fileMetadataReceiptSchema.parse(receipt);
  }

  private accessToken(value: string | undefined): string {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    if (!match?.[1]) throw new UnauthorizedException('Invalid authentication credentials.');
    return match[1];
  }

  private companyId(value: string | undefined): string {
    const parsed = companyIdSchema.safeParse(value);
    if (!parsed.success) throw new ForbiddenException('Company file scope is not permitted.');
    return parsed.data;
  }
}
