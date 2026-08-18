import {
  companyIdSchema,
  financeCategoryReferenceSearchReceiptSchema,
  financeConfigurationReceiptSchema,
  financeReferenceSearchQuerySchema,
  financeSupplierReferenceSearchReceiptSchema,
  updateCompanyVatRateRequestSchema,
  updateCompanyVatRateReceiptSchema,
} from "@baseer-erp/contracts";
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  BadRequestException,
  UnauthorizedException,
  Body,
  Post,
  Query,
} from "@nestjs/common";

import { FinanceConfigurationService } from "./finance-configuration.service.js";

@Controller("finance/configuration")
export class FinanceConfigurationController {
  constructor(private readonly configuration: FinanceConfigurationService) {}

  @Get()
  async read(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken)
      throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success)
      throw new ForbiddenException("Company finance scope is not permitted.");
    return financeConfigurationReceiptSchema.parse(
      await this.configuration.read({
        accessToken,
        companyId: parsedCompanyId.data,
      }),
    );
  }

  @Get('suppliers')
  async searchSuppliers(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = financeReferenceSearchQuerySchema.safeParse(query);
    if (!request.success) throw new BadRequestException("Invalid supplier search query.");
    const input = this.identity(authorization, companyId);
    return financeSupplierReferenceSearchReceiptSchema.parse(await this.configuration.searchSuppliers({
      ...input,
      pageSize: request.data.pageSize,
      ...(request.data.q ? { q: request.data.q } : {}),
    }));
  }

  @Get('categories')
  async searchCategories(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = financeReferenceSearchQuerySchema.safeParse(query);
    if (!request.success) throw new BadRequestException("Invalid category search query.");
    const input = this.identity(authorization, companyId);
    return financeCategoryReferenceSearchReceiptSchema.parse(await this.configuration.searchCategories({
      ...input,
      pageSize: request.data.pageSize,
      ...(request.data.q ? { q: request.data.q } : {}),
      ...(request.data.kind ? { kind: request.data.kind } : {}),
    }));
  }

  @Post('vat-rate')
  async updateVatRate(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    const request = updateCompanyVatRateRequestSchema.safeParse(body);
    if (!parsedCompanyId.success) throw new ForbiddenException("Company finance scope is not permitted.");
    if (!request.success) throw new ForbiddenException("Invalid company tax-rate request.");
    return updateCompanyVatRateReceiptSchema.parse(await this.configuration.updateVatRate({
      accessToken, companyId: parsedCompanyId.data, ...request.data,
    }));
  }

  private identity(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException("Company finance scope is not permitted.");
    return { accessToken, companyId: parsedCompanyId.data };
  }
}
