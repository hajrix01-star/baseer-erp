import { archiveOperationsItemRequestSchema, companyIdSchema, configureOperationsItemUnitsRequestSchema, createOperationsItemRequestSchema, createOperationsSectionRequestSchema, createOperationsUnitRequestSchema, installOperationsRestaurantUnitPresetsRequestSchema, operationsCatalogQuerySchema, operationsCatalogReceiptSchema, operationsEntityReceiptSchema, publishOperationsConversionsRequestSchema, updateOperationsItemRequestSchema, updateOperationsItemUnitPriceRequestSchema, updateOperationsSectionRequestSchema, updateOperationsUnitRequestSchema } from "@baseer-erp/contracts";
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { OperationsCatalogService } from "./operations-catalog.service.js";

@Controller("operations/catalog")
export class OperationsCatalogController {
  constructor(private readonly companyContext: CompanyContextService, private readonly catalog: OperationsCatalogService) {}

  @Get()
  async read(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = operationsCatalogQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid operations catalog query.");
    return operationsCatalogReceiptSchema.parse(await this.catalog.catalog(await this.authorize(authorization, companyId, "operations.catalog.read"), parsed.data));
  }

  @Post("units") @HttpCode(201)
  async createUnit(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createOperationsUnitRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations unit request.");
    const { idempotencyKey, ...payload } = request.data;
    return operationsEntityReceiptSchema.parse(await this.catalog.createUnit(await this.authorize(authorization, companyId, "operations.catalog.manage"), payload, idempotencyKey));
  }

  @Post("units/restaurant-presets") @HttpCode(201)
  async installRestaurantUnitPresets(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = installOperationsRestaurantUnitPresetsRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid restaurant unit preset request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.installRestaurantUnitPresets(await this.authorize(authorization, companyId, "operations.catalog.manage"), request.data.idempotencyKey));
  }

  @Post("units/update")
  async updateUnit(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateOperationsUnitRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations unit update request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.updateUnit(await this.authorize(authorization, companyId, "operations.catalog.manage"), request.data, request.data.idempotencyKey));
  }

  @Post("sections") @HttpCode(201)
  async createSection(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createOperationsSectionRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations section request.");
    const { idempotencyKey, ...payload } = request.data;
    return operationsEntityReceiptSchema.parse(await this.catalog.createSection(await this.authorize(authorization, companyId, "operations.catalog.manage"), payload, idempotencyKey));
  }

  @Post("sections/update")
  async updateSection(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateOperationsSectionRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations section update request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.updateSection(await this.authorize(authorization, companyId, "operations.catalog.manage"), request.data, request.data.idempotencyKey));
  }

  @Post("items") @HttpCode(201)
  async createItem(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createOperationsItemRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations item request.");
    const { idempotencyKey, ...payload } = request.data;
    return operationsEntityReceiptSchema.parse(await this.catalog.createItem(await this.authorize(authorization, companyId, "operations.catalog.manage"), payload, idempotencyKey));
  }

  @Post("items/update")
  async updateItem(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateOperationsItemRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations item update request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.updateItem(await this.authorize(authorization, companyId, "operations.catalog.manage"), request.data, request.data.idempotencyKey));
  }

  @Post("item-units/configure")
  async configureItemUnits(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = configureOperationsItemUnitsRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations item-unit configuration request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.configureItemUnits(await this.authorize(authorization, companyId, "operations.catalog.manage"), request.data, request.data.idempotencyKey));
  }

  @Post("items/archive")
  async archiveItem(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = archiveOperationsItemRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations archive request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.archiveItem(await this.authorize(authorization, companyId, "operations.catalog.manage"), request.data.itemId, request.data.idempotencyKey));
  }

  @Post("item-units/price")
  async updateItemUnitPrice(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = updateOperationsItemUnitPriceRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations item-unit price request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.updateItemUnitPrice(await this.authorize(authorization, companyId, "operations.catalog.manage"), request.data.itemId, request.data.unitId, request.data.price, request.data.idempotencyKey));
  }

  @Post("conversions/publish") @HttpCode(201)
  async publishConversions(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = publishOperationsConversionsRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid operations conversion request.");
    return operationsEntityReceiptSchema.parse(await this.catalog.publishConversions(await this.authorize(authorization, companyId, "operations.conversions.publish"), request.data.itemId, request.data.edges, request.data.baseUnitId, request.data.idempotencyKey));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]; if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new ForbiddenException("Company operations scope is not permitted.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
