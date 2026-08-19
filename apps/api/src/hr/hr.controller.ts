import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import {
  companyIdSchema,
  createHrEmployeeRequestSchema,
  createHrEmployeeServiceRequestSchema,
  updateHrEmployeeServiceRequestSchema,
  cancelHrEmployeeServiceRequestSchema,
  renewHrEmployeeServiceRequestSchema,
  hrEmployeeServicesQuerySchema,
  financeOutflowDocumentReceiptSchema,
  hrEmployeeDetailQuerySchema,
  hrEmployeeDetailReceiptSchema,
  hrEmployeeAdvanceIssueReceiptSchema,
  hrEmployeeAdvanceSettlementReceiptSchema,
  hrEmployeeAdvanceDeferralReceiptSchema,
  hrEmployeeAdvancesQuerySchema,
  hrEmployeeAdvancesReceiptSchema,
  hrEmployeeAdvanceDetailReceiptSchema,
  hrEmployeeAdministrativeDeductionDetailReceiptSchema,
  hrEmployeeAdministrativeDeductionsQuerySchema,
  hrEmployeeAdministrativeDeductionsReceiptSchema,
  hrEmployeeAdministrativeDeductionReceiptSchema,
  hrEmployeeEntityReceiptSchema,
  hrEmployeesQuerySchema,
  hrEmployeesReceiptSchema,
  issueHrEmployeeAdvanceRequestSchema,
  settleHrEmployeeAdvanceDirectlyRequestSchema,
  deferHrEmployeeAdvanceRequestSchema,
  createHrEmployeeAdministrativeDeductionRequestSchema,
  deferHrEmployeeAdministrativeDeductionRequestSchema,
  cancelHrEmployeeAdministrativeDeductionRequestSchema,
  setHrEmployeeCompensationRequestSchema,
  createHrPayrollRunRequestSchema,
  approveHrPayrollRunRequestSchema,
  payHrPayrollRunRequestSchema,
  reverseHrPayrollRunRequestSchema,
  createHrEmployeeLeaveRequestSchema,
  returnHrEmployeeLeaveRequestSchema,
  hrEmployeeCompensationProfileReceiptSchema,
  hrPayrollRunsReceiptSchema,
  hrPayrollRunsQuerySchema,
  hrPayrollRunDetailReceiptSchema,
  hrPayrollRunReceiptSchema,
  hrEmployeeLeavesReceiptSchema,
  hrEmployeeLeavesQuerySchema,
  hrEmployeeLeaveDetailReceiptSchema,
  hrEmployeeLeaveReceiptSchema,
  hrEmployeeServicesReceiptSchema,
  hrEmployeeServiceDetailReceiptSchema,
  hrEmployeeServiceReceiptSchema,
  issueHrEmployeeServiceCostRequestSchema,
  updateHrEmployeeRequestSchema,
} from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { PurchaseExpenseService } from '../finance/purchase-expense.service.js';
import { HrService } from './hr.service.js';
import { HrAdvanceService } from './hr-advance.service.js';
import { HrAdministrativeDeductionService } from './hr-administrative-deduction.service.js';
import { HrPayrollService } from './hr-payroll.service.js';
import { HrLeaveService } from './hr-leave.service.js';

const READ_CAPABILITY = 'hr.employees.read';
const WRITE_CAPABILITY = 'hr.employees.write';

@Controller('hr')
export class HrController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly hr: HrService,
    private readonly advances: HrAdvanceService,
    private readonly deductions: HrAdministrativeDeductionService,
    private readonly payroll: HrPayrollService,
    private readonly leaves: HrLeaveService,
    private readonly documents: PurchaseExpenseService,
  ) {}

  @Get('employees')
  async listEmployees(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee list query.');
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return hrEmployeesReceiptSchema.parse({ companyId: context.companyId, ...(await this.hr.listEmployees(context, { pageSize: parsed.data.pageSize, ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.search ? { search: parsed.data.search } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
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

  @Get('services')
  async listServices(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeServicesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-services query.');
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    const result = await this.hr.listServices(context, {
      pageSize: parsed.data.pageSize,
      ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}),
      ...(parsed.data.serviceType ? { serviceType: parsed.data.serviceType } : {}),
      ...(parsed.data.complianceStatus ? { complianceStatus: parsed.data.complianceStatus } : {}),
      ...(parsed.data.expiryBefore ? { expiryBefore: parsed.data.expiryBefore } : {}),
      ...(parsed.data.expiryAfter ? { expiryAfter: parsed.data.expiryAfter } : {}),
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    });
    return hrEmployeeServicesReceiptSchema.parse({ companyId: context.companyId, ...result });
  }

  @Get('services/:serviceId')
  async serviceDetail(@Param('serviceId') serviceId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return hrEmployeeServiceDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.hr.serviceDetail(context, serviceId)) });
  }

  @Post('services/update')
  async updateService(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = updateHrEmployeeServiceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-service update request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeServiceReceiptSchema.parse(await this.hr.updateService(context, request, idempotencyKey));
  }

  @Post('services/cancel')
  async cancelService(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = cancelHrEmployeeServiceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-service cancellation request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeServiceReceiptSchema.parse(await this.hr.cancelService(context, request, idempotencyKey));
  }

  @Post('services/renew')
  @HttpCode(201)
  async renewService(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = renewHrEmployeeServiceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-service renewal request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeServiceReceiptSchema.parse(await this.hr.renewService(context, request, idempotencyKey));
  }

  @Get('advances')
  async listAdvances(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeAdvancesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-advance query.');
    const context = await this.authorize(authorization, companyId, 'hr.advances.read');
    return hrEmployeeAdvancesReceiptSchema.parse({ companyId: context.companyId, ...(await this.advances.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Get('advances/:advanceId')
  async advanceDetail(@Param('advanceId') advanceId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.advances.read');
    return hrEmployeeAdvanceDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.advances.detail(context, advanceId)) });
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
  async listAdministrativeDeductions(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeAdministrativeDeductionsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid administrative-deduction query.');
    const context = await this.authorize(authorization, companyId, 'hr.deductions.manage');
    return hrEmployeeAdministrativeDeductionsReceiptSchema.parse({ companyId: context.companyId, ...(await this.deductions.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Get('deductions/:deductionId')
  async administrativeDeductionDetail(@Param('deductionId') deductionId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.deductions.manage');
    return hrEmployeeAdministrativeDeductionDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.deductions.detail(context, deductionId)) });
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

  @Post('compensation')
  @HttpCode(201)
  async setCompensation(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = setHrEmployeeCompensationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee compensation request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.create');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeCompensationProfileReceiptSchema.parse(await this.payroll.setCompensation(context, request, idempotencyKey));
  }

  @Get('payroll-runs')
  async listPayrollRuns(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrPayrollRunsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid payroll-run query.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrPayrollRunsReceiptSchema.parse({ companyId: context.companyId, ...(await this.payroll.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Get('payroll-runs/:payrollRunId')
  async payrollRunDetail(@Param('payrollRunId') payrollRunId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrPayrollRunDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.payroll.detail(context, payrollRunId)) });
  }

  @Post('payroll-runs')
  @HttpCode(201)
  async createPayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll-run request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.create');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.create(context, request, idempotencyKey));
  }

  @Post('payroll-runs/approve')
  async approvePayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = approveHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll approval request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.approve');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.approve(context, request, idempotencyKey));
  }

  @Post('payroll-runs/pay')
  async payPayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = payHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll payment request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.pay');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.pay(context, request, idempotencyKey));
  }

  @Post('payroll-runs/reverse')
  async reversePayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = reverseHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll reversal request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.reverse');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.reverse(context, request, idempotencyKey));
  }

  @Get('leaves')
  async listLeaves(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeLeavesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-leave query.');
    const context = await this.authorize(authorization, companyId, 'hr.leaves.read');
    return hrEmployeeLeavesReceiptSchema.parse({ companyId: context.companyId, ...(await this.leaves.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.leaveType ? { leaveType: parsed.data.leaveType } : {}), ...(parsed.data.periodFrom ? { periodFrom: parsed.data.periodFrom } : {}), ...(parsed.data.periodTo ? { periodTo: parsed.data.periodTo } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Post('leaves')
  @HttpCode(201)
  async createLeave(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrEmployeeLeaveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee leave request.');
    const context = await this.authorize(authorization, companyId, 'hr.leaves.manage');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeLeaveReceiptSchema.parse(await this.leaves.create(context, request, idempotencyKey));
  }

  @Post('leaves/return')
  async returnFromLeave(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = returnHrEmployeeLeaveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee return request.');
    const context = await this.authorize(authorization, companyId, 'hr.leaves.manage');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeLeaveReceiptSchema.parse(await this.leaves.returnEmployee(context, request, idempotencyKey));
  }

  @Get('leaves/:leaveId')
  async leaveDetail(@Param('leaveId') leaveId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.leaves.read');
    return hrEmployeeLeaveDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.leaves.detail(context, leaveId)) });
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
