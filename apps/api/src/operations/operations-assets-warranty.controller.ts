import { archiveOperationsAssetWarrantyAssetRequestSchema, companyIdSchema, createOperationsAssetWarrantyAssetRequestSchema, operationsAssetWarrantyWorkspaceSchema, operationsEntityReceiptSchema, setOperationsAssetWarrantyFollowUpRequestSchema } from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { OperationsAssetsWarrantyService } from './operations-assets-warranty.service.js';

@Controller('operations/assets-warranty')
export class OperationsAssetsWarrantyController {
  constructor(private readonly companyContext: CompanyContextService, private readonly assets: OperationsAssetsWarrantyService) {}

  @Get()
  async workspace(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    return operationsAssetWarrantyWorkspaceSchema.parse(await this.assets.workspace(await this.authorize(authorization, companyId, 'operations.assets.read')));
  }

  @Post('follow-up')
  async setFollowUp(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = setOperationsAssetWarrantyFollowUpRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException('Invalid asset follow-up request.');
    return operationsEntityReceiptSchema.parse(await this.assets.setFollowUp(await this.authorize(authorization, companyId, 'operations.assets.manage'), request.data));
  }

  @Post() @HttpCode(201)
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createOperationsAssetWarrantyAssetRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException('Invalid asset record request.');
    return operationsEntityReceiptSchema.parse(await this.assets.createAsset(await this.authorize(authorization, companyId, 'operations.assets.manage'), request.data));
  }

  @Post('archive')
  async archive(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = archiveOperationsAssetWarrantyAssetRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException('Invalid asset archive request.');
    return operationsEntityReceiptSchema.parse(await this.assets.archiveAsset(await this.authorize(authorization, companyId, 'operations.assets.manage'), request.data));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]; if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new ForbiddenException('Company operations scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
