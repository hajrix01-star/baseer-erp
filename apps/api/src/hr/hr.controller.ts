import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import {
  companyIdSchema,
  createHrEmployeeRequestSchema,
  createHrEmployeeServiceRequestSchema,
  financeOutflowDocumentReceiptSchema,
  hrEmployeeDetailQuerySchema,
  hrEmployeeDetailReceiptSchema,
  hrEmployeeAdvanceIssueReceiptSchema,
  hrEmployeeAdvanceSettlementReceiptSchema,
  hrEmployeeAdvanceDeferralReceiptSchema,
  hrEmployeeAdvancesReceiptSchema,
  hrEmployeeAdministrativeDeductionsReceiptSchema,
  hrEmployeeAdministrativeDeductionReceiptSchema,
  hrEmployeeEntityReceiptSchema,
  hrEmployeesReceiptSchema,
  issueHrEmployeeAdvanceRequestSchema,
  settleHrEmployeeAdvanceDirectlyRequestSchema,
  deferHrEmployeeAdvanceRequestSchema,
  createHrEmployeeAdministrativeDeductionRequestSchema,
  deferHrEmployeeAdministrativeDeductionRequestSchema,
  cancelHrEmployeeAdministrativeDeductionRequestSchema,
  issueHrEmployeeServiceCostRequestSchema,
  updateHrEmployeeRequestSchema,
} from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { PurchaseExpenseService } from '../finance/purchase-expense.service.js';
import { HrService } from './hr.service.js';
import { HrAdvanceService } from './hr-advance.service.js';
import { HrAdministrativeDeductionService } from './hr-administrative-deduction.service.js';

const READ_CAPABILITY = 'hr.employees.read';
const WRITE_CAPABILITY = 'hr.employees.write';

@Controller('hr')
export class HrController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly hr: HrService,
    private readonly advances: HrAdvanceService,
    private readonly deductions: HrAdministrativeDeductionService,
    private readonly documents: PurchaseExpenseService,
  ) {}

  @Get('employees')
  async listEmployees(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return hrEmployeesReceiptSchema.parse({ companyId: context.companyId, employees: await this.hr.listEmployees(context) });
  }

  @Get('employees/:employeeId')
  async employeeDetail(@Param('employeeId') employeeId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeDetailQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-ledger query.');
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    const result = await this.hr.employeeDetail(context, employeeId, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) });
    return hrEmployeeDetailReceiptSchema.parse({ companyId: context.companyId, ...result });
  }

  @Post('employees')
  @HttpCode(201)
  async createEmployee(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrEmployeeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...input } = parsed.data;
    return hrEmployeeEntityReceiptSchema.parse(await this.hr.createEmployee(context, input, idempotencyKey));
  }

  @Post('employees/update')
  async updateEmployee(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = updateHrEmployeeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee update request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...input } = parsed.data;
    return hrEmployeeEntityReceiptSchema.parse(await this.hr.updateEmployee(context, input, idempotencyKey));
  }

  @Post('services')
  @HttpCode(201)
  async createService(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrEmployeeServiceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee service request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...input } = parsed.data;
    return hrEmployeeEntityReceiptSchema.parse(await this.hr.createService(context, input, idempotencyKey));
  }

  @Get('advances')
  async listAdvances(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.advances.read');
    return hrEmployeeAdvancesReceiptSchema.parse({ companyId: context.companyId, advances: await this.advances.list(context) });
  }

  @Post('advances')
  @HttpCode(201)
  async issueAdvance(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = issueHrEmployeeAdvanceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-advance request.');
    const context = await this.authorize(authorization, companyId, 'hr.advances.issue');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdvanceIssueReceiptSchema.parse(await this.advances.issue(context, request, idempotencyKey));
  }

  @Post('advances/settle-directly')
  @HttpCode(201)
  async settleAdvanceDirectly(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = settleHrEmployeeAdvanceDirectlyRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-advance settlement request.');
    const context = await this.authorize(authorization, companyId, 'hr.advances.settle');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdvanceSettlementReceiptSchema.parse(await this.advances.settleDirectly(context, request, idempotencyKey));
  }

  @Post('advances/defer')
  @HttpCode(201)
  async deferAdvance(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = deferHrEmployeeAdvanceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-advance deferral request.');
    const context = await this.authorize(authorization, companyId, 'hr.advances.settle');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdvanceDeferralReceiptSchema.parse(await this.advances.defer(context, request, idempotencyKey));
  }

  @Get('deductions')
  async listAdministrativeDeductions(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.deductions.manage');
    return hrEmployeeAdministrativeDeductionsReceiptSchema.parse({ companyId: context.companyId, deductions: await this.deductions.list(context) });
  }

  @Post('deductions')
  @HttpCode(201)
  async createAdministrativeDeduction(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrEmployeeAdministrativeDeductionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid administrative-deduction request.');
    const context = await this.authorize(authorization, companyId, 'hr.deductions.manage');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdministrativeDeductionReceiptSchema.parse(await this.deductions.create(context, request, idempotencyKey));
  }

  @Post('deductions/defer')
  async deferAdministrativeDeduction(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = deferHrEmployeeAdministrativeDeductionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid administrative-deduction deferral request.');
    const context = await this.authorize(authorization, companyId, 'hr.deductions.manage');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdministrativeDeductionReceiptSchema.parse(await this.deductions.defer(context, request, idempotencyKey));
  }

  @Post('deductions/cancel')
  async cancelAdministrativeDeduction(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = cancelHrEmployeeAdministrativeDeductionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid administrative-deduction cancellation request.');
    const context = await this.authorize(authorization, companyId, 'hr.deductions.manage');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdministrativeDeductionReceiptSchema.parse(await this.deductions.cancel(context, request, idempotencyKey));
  }

  /** A service becomes financial only when its actual supplier cost is issued. */
  @Post('services/issue-cost')
  @HttpCode(201)
  async issueServiceCost(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = issueHrEmployeeServiceCostRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee service-cost request.');
    const context = await this.authorize(authorization, companyId, [WRITE_CAPABILITY, 'finance.purchase_expense.create']);
    const { idempotencyKey, ...request } = parsed.data;
    return financeOutflowDocumentReceiptSchema.parse(await this.documents.issueEmployeeServiceCost({ context, idempotencyKey, request }));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string | readonly string[]) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company HR scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: Array.isArray(capability) ? capability : [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
