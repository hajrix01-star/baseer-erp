import { companyIdSchema, createVaultRequestSchema, financeVaultCreateReceiptSchema, financeVaultOrderReceiptSchema, financeVaultRemoveReceiptSchema, removeVaultRequestSchema, reorderVaultsRequestSchema, restoreVaultRequestSchema, updateVaultRequestSchema } from "@baseer-erp/contracts";
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import { CompanyContextService } from "../company-context/company-context.service.js";
import { VaultManagementService } from "./vault-management.service.js";

@Controller("finance/vaults")
export class VaultManagementController {
  constructor(private readonly companyContext: CompanyContextService, private readonly vaults: VaultManagementService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createVaultRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid vault request.");
    const context = await this.authorize(authorization, companyId);
    const vaultId = await this.vaults.addCustomVault(context, { nameAr: request.data.nameAr, nameEn: request.data.nameEn, type: request.data.type, ...(request.data.paymentMethod === undefined ? {} : { paymentMethod: request.data.paymentMethod }), ...(request.data.paymentMethods === undefined ? {} : { paymentMethods: request.data.paymentMethods }), ...(request.data.isSalesChannel === undefined ? {} : { isSalesChannel: request.data.isSalesChannel }), ...(request.data.isPaymentDestination === undefined ? {} : { isPaymentDestination: request.data.isPaymentDestination }) }, request.data.idempotencyKey);
    return financeVaultCreateReceiptSchema.parse({ vaultId });
  }

  @Post("update")
  async update(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateVaultRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid vault update request.");
    const context = await this.authorize(authorization, companyId);
    return financeVaultCreateReceiptSchema.parse({ vaultId: await this.vaults.update(context, { ...request.data, ...(request.data.paymentMethod === undefined ? {} : { paymentMethod: request.data.paymentMethod }), ...(request.data.paymentMethods === undefined ? {} : { paymentMethods: request.data.paymentMethods }) }) });
  }

  @Post("reorder")
  async reorder(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = reorderVaultsRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid vault order request.");
    const context = await this.authorize(authorization, companyId);
    return financeVaultOrderReceiptSchema.parse(await this.vaults.reorder(context, request.data.vaultIds, request.data.idempotencyKey));
  }
  @Post("restore")
  async restore(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = restoreVaultRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid vault restore request.");
    const context = await this.authorize(authorization, companyId);
    return financeVaultCreateReceiptSchema.parse({ vaultId: await this.vaults.restore(context, request.data.vaultId, request.data.idempotencyKey) });
  }

  @Post("remove-or-archive")
  async removeOrArchive(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = removeVaultRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid vault removal request.");
    const context = await this.authorize(authorization, companyId);
    return financeVaultRemoveReceiptSchema.parse({ result: await this.vaults.removeOrArchive(context, request.data.vaultId, request.data.idempotencyKey) });
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException("Company finance scope is not permitted.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: ["finance.vaults.write"] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}