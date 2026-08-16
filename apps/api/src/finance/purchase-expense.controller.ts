import { createFinanceOutflowDocumentRequestSchema, companyIdSchema, financeOutflowDocumentReceiptSchema } from '@baseer-erp/contracts';
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { PurchaseExpenseService } from './purchase-expense.service.js';

const CREATE_CAPABILITY = 'finance.purchase_expense.create';

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

  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [CREATE_CAPABILITY] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}