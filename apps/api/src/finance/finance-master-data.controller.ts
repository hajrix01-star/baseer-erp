import { archiveFinanceCategoryRequestSchema, archiveFinanceSupplierRequestSchema, companyIdSchema, createFinanceCategoryRequestSchema, createFinanceSupplierRequestSchema, financeMasterDataEntityReceiptSchema, updateFinanceCategoryRequestSchema, updateFinanceSupplierRequestSchema } from "@baseer-erp/contracts";
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { FinanceMasterDataService } from "./finance-master-data.service.js";

@Controller("finance/master-data")
export class FinanceMasterDataController {
  constructor(private readonly companyContext: CompanyContextService, private readonly masterData: FinanceMasterDataService) {}

  @Post("categories")
  @HttpCode(201)
  async createCategory(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createFinanceCategoryRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid category request.");
    const context = await this.authorize(authorization, companyId, "finance.categories.write");
    return financeMasterDataEntityReceiptSchema.parse(await this.masterData.createCategory(context, request.data, request.data.idempotencyKey));
  }

  @Post("categories/update")
  async updateCategory(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateFinanceCategoryRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid category update request.");
    const context = await this.authorize(authorization, companyId, "finance.categories.write");
    const { categoryId, idempotencyKey, ...input } = request.data;
    return financeMasterDataEntityReceiptSchema.parse(await this.masterData.updateCategory(context, categoryId, input, idempotencyKey));
  }

  @Post("categories/archive")
  async archiveCategory(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = archiveFinanceCategoryRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid category archive request.");
    const context = await this.authorize(authorization, companyId, "finance.categories.write");
    return financeMasterDataEntityReceiptSchema.parse(await this.masterData.archiveCategory(context, request.data.categoryId, request.data.idempotencyKey));
  }

  @Post("suppliers")
  @HttpCode(201)
  async createSupplier(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createFinanceSupplierRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid supplier request.");
    const context = await this.authorize(authorization, companyId, "finance.suppliers.write");
    return financeMasterDataEntityReceiptSchema.parse(await this.masterData.createSupplier(context, request.data, request.data.idempotencyKey));
  }

  @Post("suppliers/update")
  async updateSupplier(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateFinanceSupplierRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid supplier update request.");
    const context = await this.authorize(authorization, companyId, "finance.suppliers.write");
    const { supplierId, idempotencyKey, ...input } = request.data;
    return financeMasterDataEntityReceiptSchema.parse(await this.masterData.updateSupplier(context, supplierId, input, idempotencyKey));
  }

  @Post("suppliers/archive")
  async archiveSupplier(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = archiveFinanceSupplierRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid supplier archive request.");
    const context = await this.authorize(authorization, companyId, "finance.suppliers.write");
    return financeMasterDataEntityReceiptSchema.parse(await this.masterData.archiveSupplier(context, request.data.supplierId, request.data.idempotencyKey));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException("Company finance scope is not permitted.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}