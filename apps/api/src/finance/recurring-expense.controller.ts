import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import {
  archiveFinanceRecurringExpenseProfileRequestSchema,
  restoreFinanceRecurringExpenseProfileRequestSchema,
  companyIdSchema,
  createFinanceRecurringExpensePaymentBatchRequestSchema,
  createFinanceRecurringExpensePaymentRequestSchema,
  createFinanceRecurringExpenseProfileRequestSchema,
  updateFinanceRecurringExpenseProfileRequestSchema,
  financeMasterDataEntityReceiptSchema,
  financeRecurringExpensePaymentBatchReceiptSchema,
  financeRecurringExpensePaymentReceiptSchema,
  financeRecurringExpenseProfilesReceiptSchema,
} from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { PurchaseExpenseService } from './purchase-expense.service.js';
import { RecurringExpenseService } from './recurring-expense.service.js';

const READ_CAPABILITY = 'finance.purchase_expense.read';
const CREATE_CAPABILITY = 'finance.purchase_expense.create';

@Controller('finance/recurring-expenses')
export class RecurringExpenseController {
  constructor(private readonly companyContext: CompanyContextService, private readonly profiles: RecurringExpenseService, private readonly documents: PurchaseExpenseService) {}

  @Get()
  async list(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return financeRecurringExpenseProfilesReceiptSchema.parse({ companyId: context.companyId, profiles: await this.profiles.list(context) });
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createFinanceRecurringExpenseProfileRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid recurring-expense profile request.');
    const context = await this.authorize(authorization, companyId, CREATE_CAPABILITY);
    const { idempotencyKey, ...profile } = request.data;
    return financeMasterDataEntityReceiptSchema.parse(await this.profiles.createProfile(context, profile, idempotencyKey));
  }

  @Post('update')
  async update(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = updateFinanceRecurringExpenseProfileRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid recurring-expense profile update request.');
    const context = await this.authorize(authorization, companyId, CREATE_CAPABILITY);
    const { profileId, idempotencyKey, ...profile } = request.data;
    return financeMasterDataEntityReceiptSchema.parse(await this.profiles.updateProfile(context, profileId, profile, idempotencyKey));
  }

  @Post('archive')
  async archive(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = archiveFinanceRecurringExpenseProfileRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid recurring-expense archive request.');
    const context = await this.authorize(authorization, companyId, CREATE_CAPABILITY);
    return financeMasterDataEntityReceiptSchema.parse(await this.profiles.archiveProfile(context, request.data.profileId, request.data.idempotencyKey));
  }

  @Post('restore')
  async restore(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = restoreFinanceRecurringExpenseProfileRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid recurring-expense restore request.');
    const context = await this.authorize(authorization, companyId, CREATE_CAPABILITY);
    return financeMasterDataEntityReceiptSchema.parse(await this.profiles.restoreProfile(context, request.data.profileId, request.data.idempotencyKey));
  }

  @Post('payments')
  @HttpCode(201)
  async pay(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createFinanceRecurringExpensePaymentRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid recurring-expense payment request.');
    const context = await this.authorize(authorization, companyId, CREATE_CAPABILITY);
    return financeRecurringExpensePaymentReceiptSchema.parse(await this.documents.createRecurringPayment({
      context,
      idempotencyKey: request.data.idempotencyKey,
      request: (() => { const { idempotencyKey: _key, ...payment } = request.data; return { ...payment, allocations: payment.allocations ?? [] }; })(),
    }));
  }

  @Post('payments/batch')
  @HttpCode(201)
  async payBatch(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createFinanceRecurringExpensePaymentBatchRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid recurring-expense batch payment request.');
    const context = await this.authorize(authorization, companyId, CREATE_CAPABILITY);
    return financeRecurringExpensePaymentBatchReceiptSchema.parse(await this.documents.createRecurringPaymentBatch({
      context,
      idempotencyKey: request.data.idempotencyKey,
      request: (() => { const { idempotencyKey: _key, ...batch } = request.data; return { ...batch, items: batch.items.map((item) => ({ ...item, allocations: item.allocations ?? [] })) }; })(),
    }));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company finance scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
