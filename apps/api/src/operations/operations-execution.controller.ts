import { cancelOperationsPurchaseRequestSchema, companyIdSchema, createOperationsPurchaseRequestSchema, operationsCustodyMonthlyReportReceiptSchema, operationsEntityReceiptSchema, operationsExecutionWorkspaceReceiptSchema, operationsMaterialsReceivedReportReceiptSchema, operationsRecipePreviewReceiptSchema, operationsRecipeWorkspaceReceiptSchema, operationsReportQuerySchema, previewOperationsRecipeRequestSchema, publishOperationsRecipeRequestSchema, receiveOperationsPurchaseRequestSchema, returnOperationsCustodyRequestSchema, reverseOperationsPurchaseReceiptSchema } from "@baseer-erp/contracts";
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { TenantAdministrationContextService } from "../administration/tenant-administration-context.service.js";
import { OperationsExecutionService } from "./operations-execution.service.js";

@Controller("operations")
export class OperationsExecutionController {
  constructor(private readonly companyContext: CompanyContextService, private readonly tenantAdministration: TenantAdministrationContextService, private readonly operations: OperationsExecutionService) {}

  @Get("execution-workspace")
  async workspace(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return operationsExecutionWorkspaceReceiptSchema.parse(await this.operations.workspace(await this.authorize(authorization, companyId, "operations.catalog.manage")));
  }

  @Get("reports/materials-received")
  async materialsReceivedReport(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = operationsReportQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid operations report period.");
    return operationsMaterialsReceivedReportReceiptSchema.parse(await this.operations.materialsReceivedReport(await this.authorize(authorization, companyId, "operations.purchase_request.read"), parsed.data));
  }

  @Get("reports/custody-monthly")
  async custodyMonthlyReport(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = operationsReportQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException("Invalid operations report period.");
    return operationsCustodyMonthlyReportReceiptSchema.parse(await this.operations.custodyMonthlyReport(await this.authorize(authorization, companyId, "operations.custody.read"), parsed.data));
  }

  @Get("recipe-workspace")
  async recipeWorkspace(@Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    return operationsRecipeWorkspaceReceiptSchema.parse(await this.operations.recipeWorkspace(await this.authorize(authorization, companyId, "operations.recipe.read")));
  }

  @Post("recipes/preview")
  async previewRecipe(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = previewOperationsRecipeRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid recipe preview request.");
    return operationsRecipePreviewReceiptSchema.parse(await this.operations.previewRecipe(await this.authorize(authorization, companyId, "operations.recipe.read"), request.data));
  }

  @Post("recipes/publish") @HttpCode(201)
  async publishRecipe(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = publishOperationsRecipeRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid recipe publish request.");
    return operationsEntityReceiptSchema.parse(await this.operations.publishRecipe(await this.authorize(authorization, companyId, "operations.recipe.publish"), request.data));
  }

  @Post("purchase-requests") @HttpCode(201)
  async createRequest(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = createOperationsPurchaseRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid purchase request.");
    return operationsEntityReceiptSchema.parse(await this.operations.createPurchaseRequest(await this.authorize(authorization, companyId, "operations.purchase_request.create"), request.data));
  }

  @Post("purchase-requests/complete") @HttpCode(201)
  async completeRequest(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = receiveOperationsPurchaseRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid purchase completion.");
    return operationsEntityReceiptSchema.parse(await this.operations.receivePurchaseRequest(await this.authorize(authorization, companyId, "operations.purchase_request.receive"), request.data));
  }

  @Post("purchase-requests/cancel") @HttpCode(201)
  async cancelRequest(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = cancelOperationsPurchaseRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid purchase request cancellation.");
    return operationsEntityReceiptSchema.parse(await this.operations.cancelPurchaseRequest(await this.authorize(authorization, companyId, "operations.purchase_request.cancel"), request.data));
  }

  @Post("purchase-receipts/reverse") @HttpCode(201)
  async reverseReceipt(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = reverseOperationsPurchaseReceiptSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid purchase receipt reversal.");
    return operationsEntityReceiptSchema.parse(await this.operations.reversePurchaseReceipt(await this.authorizeOwner(authorization, companyId, "operations.purchase_receipt.reverse"), request.data));
  }

  @Post("custody/returns") @HttpCode(201)
  async returnCustody(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const request = returnOperationsCustodyRequestSchema.safeParse(body); if (!request.success) throw new BadRequestException("Invalid custody return.");
    return operationsEntityReceiptSchema.parse(await this.operations.returnCustody(await this.authorize(authorization, companyId, "operations.custody.return"), request.data, request.data.idempotencyKey));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string | string[]) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]; if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new ForbiddenException("Company operations scope is not permitted.");
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: Array.isArray(capability) ? capability : [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }

  /** A correction reverses a posted operational snapshot; it is deliberately
   * reserved to the tenant owner, not a broadly assignable manager permission. */
  private async authorizeOwner(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]; if (!accessToken) throw new UnauthorizedException("Invalid authentication credentials.");
    const owner = await this.tenantAdministration.authorizeOwner(accessToken);
    const company = await this.authorize(authorization, companyId, capability);
    if (company.tenantId !== owner.tenantId || company.actorUserId !== owner.actorUserId) throw new ForbiddenException("Tenant owner access is not permitted.");
    return company;
  }
}
