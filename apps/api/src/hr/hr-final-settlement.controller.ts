import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { approveHrFinalSettlementRequestSchema, companyIdSchema, createHrFinalSettlementRequestSchema, hrFinalSettlementPreviewSchema, hrFinalSettlementReceiptSchema, hrFinalSettlementsQuerySchema, hrFinalSettlementsReceiptSchema, payHrFinalSettlementRequestSchema, previewHrFinalSettlementRequestSchema, reverseHrFinalSettlementRequestSchema, verifyHrFinalSettlementReasonRequestSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { HrFinalSettlementService } from './hr-final-settlement.service.js';

@Controller('hr/final-settlements')
export class HrFinalSettlementController {
  constructor(private readonly companies: CompanyContextService, private readonly settlements: HrFinalSettlementService) {}

  @Get()
  async list(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrFinalSettlementsQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException('Invalid final-settlement query.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.read');
    return hrFinalSettlementsReceiptSchema.parse({ companyId: context.companyId, ...(await this.settlements.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}), ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}) })) });
  }

  @Post('preview')
  async preview(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = previewHrFinalSettlementRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid final-settlement preview request.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.create');
    return hrFinalSettlementPreviewSchema.parse(await this.settlements.preview(context, parsed.data));
  }

  @Post() @HttpCode(201)
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrFinalSettlementRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid final-settlement request.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.create');
    return hrFinalSettlementReceiptSchema.parse(await this.settlements.create(context, parsed.data));
  }

  @Post('approve')
  async approve(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = approveHrFinalSettlementRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid final-settlement approval request.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.approve'); const { idempotencyKey, ...input } = parsed.data;
    return hrFinalSettlementReceiptSchema.parse(await this.settlements.approve(context, input, idempotencyKey));
  }

  @Post('verify-reason')
  async verifyReason(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = verifyHrFinalSettlementReasonRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid final-settlement reason-verification request.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.verify'); const { idempotencyKey, ...input } = parsed.data;
    return hrFinalSettlementReceiptSchema.parse(await this.settlements.verifyReason(context, input, idempotencyKey));
  }

  @Post('pay')
  async pay(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = payHrFinalSettlementRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid final-settlement payment request.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.pay'); const { idempotencyKey, ...input } = parsed.data;
    return hrFinalSettlementReceiptSchema.parse(await this.settlements.pay(context, input, idempotencyKey));
  }

  @Post('reverse')
  async reverse(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = reverseHrFinalSettlementRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid final-settlement reversal request.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.reverse'); const { idempotencyKey, ...input } = parsed.data;
    return hrFinalSettlementReceiptSchema.parse(await this.settlements.reverse(context, input, idempotencyKey));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]; if (!token) throw new BadRequestException('A bearer access token is required.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new BadRequestException('A valid company context is required.');
    const authorized = await this.companies.authorize({ accessToken: token, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
