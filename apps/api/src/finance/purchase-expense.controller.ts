import { correctFinanceOutflowDocumentRequestSchema, createFinanceOutflowBatchRequestSchema, createFinanceOutflowDocumentRequestSchema, companyIdSchema, financeOutflowBatchReceiptSchema, financeOutflowDocumentReceiptSchema, financeOutflowDocumentsQuerySchema, financeOutflowDocumentsReceiptSchema, financeCreditWorkspaceQuerySchema, financeCreditWorkspaceReceiptSchema, reverseFinanceOutflowDocumentRequestSchema, reverseFinanceOutflowDocumentReceiptSchema } from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { TenantAdministrationContextService } from '../administration/tenant-administration-context.service.js';
import { PurchaseExpenseService } from './purchase-expense.service.js';

const CREATE_CAPABILITY = 'finance.purchase_expense.create';
const READ_CAPABILITY = 'finance.purchase_expense.read';

@Controller('finance/purchase-expense-documents')
export class PurchaseExpenseController {
  constructor(private readonly companyContext: CompanyContextService, private readonly tenantAdministration: TenantAdministrationContextService, private readonly documents: PurchaseExpenseService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createFinanceOutflowDocumentRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid purchase or expense document request.');
    const context = await this.authorize(authorization, companyId);
    return financeOutflowDocumentReceiptSchema.parse(await this.documents.create({
      context, idempotencyKey: request.data.idempotencyKey,
      request: {
        kind: request.data.kind, settlementKind: request.data.settlementKind, categoryId: request.data.categoryId,
        ...(request.data.supplierId ? { supplierId: request.data.supplierId } : {}),
        ...(request.data.supplierInvoiceNumber ? { supplierInvoiceNumber: request.data.supplierInvoiceNumber } : {}),
        ...(request.data.supplierInvoiceMissingReason ? { supplierInvoiceMissingReason: request.data.supplierInvoiceMissingReason } : {}),
        businessDate: request.data.businessDate, ...(request.data.supplierInvoiceDate ? { supplierInvoiceDate: request.data.supplierInvoiceDate } : {}),
        grossAmount: request.data.grossAmount, isTaxable: request.data.isTaxable, assetWarrantyFollowUp: request.data.assetWarrantyFollowUp, allocations: request.data.allocations,
        ...(request.data.notes ? { notes: request.data.notes } : {}),
      },
    }));
  }

  @Post('batch')
  @HttpCode(201)
  async createBatch(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createFinanceOutflowBatchRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid purchase batch request.');
    const context = await this.authorize(authorization, companyId);
    return financeOutflowBatchReceiptSchema.parse(await this.documents.createBatch({
      context, idempotencyKey: request.data.idempotencyKey,
      request: { businessDate: request.data.businessDate, ...(request.data.notes ? { notes: request.data.notes } : {}), items: request.data.items.map((item) => ({
        kind: item.kind, settlementKind: item.settlementKind, categoryId: item.categoryId,
        ...(item.supplierId ? { supplierId: item.supplierId } : {}),
        ...(item.supplierInvoiceNumber ? { supplierInvoiceNumber: item.supplierInvoiceNumber } : {}),
        ...(item.supplierInvoiceMissingReason ? { supplierInvoiceMissingReason: item.supplierInvoiceMissingReason } : {}),
        ...(item.supplierInvoiceDate ? { supplierInvoiceDate: item.supplierInvoiceDate } : {}),
        grossAmount: item.grossAmount, isTaxable: item.isTaxable, assetWarrantyFollowUp: item.assetWarrantyFollowUp, allocations: item.allocations,
        ...(item.notes ? { notes: item.notes } : {}),
      })) },
    }));
  }
  @Post('correct')
  @HttpCode(200)
  async correct(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = correctFinanceOutflowDocumentRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid purchase or expense amendment request.');
    const context = await this.authorizeOwner(authorization, companyId);
    return financeOutflowDocumentReceiptSchema.parse(await this.documents.correct({
      context, idempotencyKey: request.data.idempotencyKey,
      documentId: request.data.documentId,
      request: {
        kind: request.data.kind, settlementKind: request.data.settlementKind, categoryId: request.data.categoryId,
        ...(request.data.supplierId ? { supplierId: request.data.supplierId } : {}),
        ...(request.data.supplierInvoiceNumber ? { supplierInvoiceNumber: request.data.supplierInvoiceNumber } : {}),
        ...(request.data.supplierInvoiceMissingReason ? { supplierInvoiceMissingReason: request.data.supplierInvoiceMissingReason } : {}),
        businessDate: request.data.businessDate, ...(request.data.supplierInvoiceDate ? { supplierInvoiceDate: request.data.supplierInvoiceDate } : {}),
        grossAmount: request.data.grossAmount, isTaxable: request.data.isTaxable, assetWarrantyFollowUp: request.data.assetWarrantyFollowUp, allocations: request.data.allocations,
        ...(request.data.notes ? { notes: request.data.notes } : {}),
      },
    }));
  }
  @Post('reverse')
  async reverse(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = reverseFinanceOutflowDocumentRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid purchase or expense reversal request.');
    const context = await this.authorize(authorization, companyId, 'finance.purchase_expense.cancel');
    return reverseFinanceOutflowDocumentReceiptSchema.parse(await this.documents.reverse({
      context,
      idempotencyKey: request.data.idempotencyKey,
      request: { documentId: request.data.documentId, businessDate: request.data.businessDate, reason: request.data.reason },
    }));
  }
  @Get('credit-workspace')
  async creditWorkspace(@Query() query: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsedQuery = financeCreditWorkspaceQuerySchema.safeParse(query);
    if (!parsedQuery.success) throw new BadRequestException('Invalid credit workspace query.');
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return financeCreditWorkspaceReceiptSchema.parse(await this.documents.creditWorkspace(context, { pageSize: parsedQuery.data.pageSize, ...(parsedQuery.data.cursor ? { cursor: parsedQuery.data.cursor } : {}) }));
  }
  @Get()
  async list(@Query() query: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsedQuery = financeOutflowDocumentsQuerySchema.safeParse(query);
    if (!parsedQuery.success) throw new BadRequestException('Invalid document history query.');
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    const page = await this.documents.list(context, { pageSize: parsedQuery.data.pageSize, ...(parsedQuery.data.cursor ? { cursor: parsedQuery.data.cursor } : {}) });
    return financeOutflowDocumentsReceiptSchema.parse({
      companyId: context.companyId,
      ownerCanAmend: await this.isOwner(authorization, context),
      documents: page.documents,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  }
  private async authorize(authorization: string | undefined, companyId: string | undefined, capability = CREATE_CAPABILITY) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
  private async authorizeOwner(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const owner = await this.tenantAdministration.authorizeOwner(accessToken);
    const context = await this.authorize(authorization, companyId, 'finance.purchase_expense.correct');
    if (context.tenantId !== owner.tenantId || context.actorUserId !== owner.actorUserId) throw new ForbiddenException('Tenant owner access is not permitted.');
    return context;
  }
  private async isOwner(authorization: string | undefined, context: { tenantId: string; actorUserId: string }) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) return false;
    try {
      const owner = await this.tenantAdministration.authorizeOwner(accessToken);
      return owner.tenantId === context.tenantId && owner.actorUserId === context.actorUserId;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
}
