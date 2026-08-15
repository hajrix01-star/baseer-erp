import { companyIdSchema, createVaultRequestSchema, financeVaultCreateReceiptSchema, financeVaultRemoveReceiptSchema, removeVaultRequestSchema } from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { VaultManagementService } from './vault-management.service.js';

@Controller('finance/vaults')
export class VaultManagementController {
  constructor(private readonly companyContext: CompanyContextService, private readonly vaults: VaultManagementService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createVaultRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid vault request.');
    const context = await this.authorize(authorization, companyId);
    const vaultId = await this.vaults.addCustomVault(context, { nameAr: request.data.nameAr, nameEn: request.data.nameEn, type: request.data.type, ...(request.data.isSalesChannel !== undefined ? { isSalesChannel: request.data.isSalesChannel } : {}), ...(request.data.isPaymentDestination !== undefined ? { isPaymentDestination: request.data.isPaymentDestination } : {}) }, request.data.idempotencyKey);
    return financeVaultCreateReceiptSchema.parse({ vaultId });
  }

  @Post('remove-or-archive')
  async removeOrArchive(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = removeVaultRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid vault removal request.');
    const context = await this.authorize(authorization, companyId);
    return financeVaultRemoveReceiptSchema.parse({ result: await this.vaults.removeOrArchive(context, request.data.vaultId, request.data.idempotencyKey) });
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: ['finance.vaults.write'] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
