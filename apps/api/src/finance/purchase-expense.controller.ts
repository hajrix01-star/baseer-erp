import { createFinanceOutflowBatchRequestSchema, createFinanceOutflowDocumentRequestSchema, companyIdSchema, financeOutflowBatchReceiptSchema, financeOutflowDocumentReceiptSchema, financeOutflowDocumentsReceiptSchema, financeCreditWorkspaceQuerySchema, financeCreditWorkspaceReceiptSchema } from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { PurchaseExpenseService } from './purchase-expense.service.js';

const CREATE_CAPABILITY = 'finance.purchase_expense.create';
const READ_CAPABILITY = 'finance.purchase_expense.read';

@Controller('finance/purchase-expense-documents')
export class PurchaseExpenseController {
  constructor(private readonly companyContext: CompanyContextService, private readonly documents: PurchaseExpenseService) {}

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
        grossAmount: request.data.grossAmount, isTaxable: request.data.isTaxable, allocations: request.data.allocations,
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
        grossAmount: item.grossAmount, isTaxable: item.isTaxable, allocations: item.allocations,
        ...(item.notes ? { notes: item.notes } : {}),
      })) },
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
  async list(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return financeOutflowDocumentsReceiptSchema.parse({
      companyId: context.companyId,
      documents: await this.documents.list(context),
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
}
