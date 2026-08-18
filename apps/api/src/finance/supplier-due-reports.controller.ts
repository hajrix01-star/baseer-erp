import {
  companyIdSchema,
  supplierDueCashProjectionQuerySchema,
  supplierDueCashProjectionReceiptSchema,
  supplierDueHistoryQuerySchema,
  supplierDueHistoryReceiptSchema,
  supplierDuePaymentHistoryQuerySchema,
  supplierDuePaymentHistoryReceiptSchema,
} from "@baseer-erp/contracts";
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Query,
  UnauthorizedException,
} from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { DatabaseService } from "../database/database.service.js";
import { SupplierDueQueriesService } from "./supplier-due-queries.service.js";
import { SupplierDuesService } from "./supplier-dues.service.js";

const DUES_READ_CAPABILITY = "finance.supplier_dues.read";

@Controller("finance/supplier-dues")
export class SupplierDueReportsController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly database: DatabaseService,
    private readonly dues: SupplierDuesService,
    private readonly dueQueries: SupplierDueQueriesService,
  ) {}

  @Get()
  async history(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const filters = supplierDueHistoryQuerySchema.safeParse(query);
    if (!filters.success)
      throw new BadRequestException("Invalid supplier-due history filters.");
    const context = await this.authorize(authorization, companyId);
    const dues = await this.dueQueries.list(context, {
      ...(filters.data.status ? { status: filters.data.status } : {}),
      ...(filters.data.supplierId
        ? { supplierId: filters.data.supplierId }
        : {}),
      pageSize: filters.data.pageSize,
      ...(filters.data.cursor ? { cursor: filters.data.cursor } : {}),
    });
    return supplierDueHistoryReceiptSchema.parse({
      companyId: context.companyId,
      dues: dues.dues,
      hasMore: dues.hasMore,
      nextCursor: dues.nextCursor,
    });
  }

  @Get(":dueId/payments")
  async paymentHistory(
    @Param("dueId") dueId: string,
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const filters = supplierDuePaymentHistoryQuerySchema.safeParse(query);
    if (!filters.success)
      throw new BadRequestException("Invalid supplier-due payment history filters.");
    const context = await this.authorize(authorization, companyId);
    const page = await this.dueQueries.listPayments(context, dueId, {
      pageSize: filters.data.pageSize,
      ...(filters.data.cursor ? { cursor: filters.data.cursor } : {}),
    });
    return supplierDuePaymentHistoryReceiptSchema.parse({
      companyId: context.companyId,
      dueId: page.dueId,
      payments: page.payments,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  }

  @Get("cash-payments")
  async cashPayments(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const filters = supplierDueCashProjectionQuerySchema.safeParse(query);
    if (!filters.success)
      throw new BadRequestException(
        "Invalid supplier-due cash projection filters.",
      );
    const context = await this.authorize(authorization, companyId);
    const page = await this.database.inTenantTransaction(
      context.tenantId,
      (transaction) =>
        this.dues.listPostedCashPaymentProjectionInTransaction(transaction, {
          tenantId: context.tenantId,
          companyId: context.companyId,
          ...(filters.data.fromBusinessDate
            ? { fromBusinessDate: filters.data.fromBusinessDate }
            : {}),
          ...(filters.data.toBusinessDate
            ? { toBusinessDate: filters.data.toBusinessDate }
            : {}),
          ...(filters.data.vaultId ? { vaultId: filters.data.vaultId } : {}),
          pageSize: filters.data.pageSize,
          ...(filters.data.cursor ? { cursor: filters.data.cursor } : {}),
        }),
    );
    return supplierDueCashProjectionReceiptSchema.parse({
      companyId: context.companyId,
      payments: page.payments,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  }

  private async authorize(
    authorization: string | undefined,
    companyId: string | undefined,
  ) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken)
      throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success)
      throw new ForbiddenException("Company finance scope is not permitted.");
    const authorized = await this.companyContext.authorize({
      accessToken,
      companyId: parsedCompanyId.data,
      requiredCapabilities: [DUES_READ_CAPABILITY],
    });
    return {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
  }
}
