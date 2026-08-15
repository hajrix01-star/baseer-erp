import {
  createSupplierDueRequestSchema,
  companyIdSchema,
  recordSupplierDuePaymentRequestSchema,
  reverseSupplierDuePaymentRequestSchema,
  supplierDuePaymentReceiptSchema,
  supplierDuePaymentReversalReceiptSchema,
  supplierDueReceiptSchema,
} from '@baseer-erp/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { SupplierDuesService } from './supplier-dues.service.js';

const DUES_WRITE_CAPABILITY = 'finance.supplier_dues.write';

/**
 * The public boundary for supplier dues. It never accepts a tenant or actor
 * from the client: both are resolved from the live access token and membership.
 */
@Controller('finance/supplier-dues')
export class SupplierDuesController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly dues: SupplierDuesService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = createSupplierDueRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid supplier-due request.');
    const context = await this.authorize(authorization, companyId);
    return supplierDueReceiptSchema.parse(await this.dues.createDue({
      context,
      idempotencyKey: request.data.idempotencyKey,
      request: {
        supplierId: request.data.supplierId,
        categoryId: request.data.categoryId,
        sourceDocumentNumber: request.data.sourceDocumentNumber,
        businessDate: request.data.businessDate,
        amount: request.data.amount,
        ...(request.data.dueDate ? { dueDate: request.data.dueDate } : {}),
        ...(request.data.notes ? { notes: request.data.notes } : {}),
      },
    }));
  }

  @Post('payments')
  @HttpCode(201)
  async recordPayment(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = recordSupplierDuePaymentRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid supplier-due payment request.');
    const context = await this.authorize(authorization, companyId);
    return supplierDuePaymentReceiptSchema.parse(await this.dues.recordPayment({
      context,
      idempotencyKey: request.data.idempotencyKey,
      request: {
        dueId: request.data.dueId,
        vaultId: request.data.vaultId,
        businessDate: request.data.businessDate,
        amount: request.data.amount,
      },
    }));
  }

  @Post('payments/reverse')
  @HttpCode(201)
  async reversePayment(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = reverseSupplierDuePaymentRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid supplier-due reversal request.');
    const context = await this.authorize(authorization, companyId);
    return supplierDuePaymentReversalReceiptSchema.parse(await this.dues.reversePayment({
      context,
      idempotencyKey: request.data.idempotencyKey,
      request: {
        paymentId: request.data.paymentId,
        businessDate: request.data.businessDate,
        reason: request.data.reason,
      },
    }));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({
      accessToken,
      companyId: parsedCompanyId.data,
      requiredCapabilities: [DUES_WRITE_CAPABILITY],
    });
    return {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
  }
}
