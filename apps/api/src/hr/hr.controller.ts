import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UnauthorizedException } from '@nestjs/common';
import {
  companyIdSchema,
  createHrEmployeeRequestSchema,
  onboardHrEmployeeRequestSchema,
  createHrEmployeePromotionRequestSchema,
  createHrEmployeeServiceRequestSchema,
  recordHrEmployeeServiceAndIssueCostRequestSchema,
  recordHrEmployeeServiceAndIssueCostReceiptSchema,
  reverseHrEmployeeServiceCostRequestSchema,
  hrEmployeeServiceCostReversalReceiptSchema,
  updateHrEmployeeServiceRequestSchema,
  cancelHrEmployeeServiceRequestSchema,
  renewHrEmployeeServiceRequestSchema,
  hrEmployeeServicesQuerySchema,
  financeOutflowDocumentReceiptSchema,
  hrEmployeeDetailQuerySchema,
  hrEmployeeDetailReceiptSchema,
  hrEmployeePromotionsQuerySchema,
  hrEmployeePromotionsReceiptSchema,
  hrEmployeePromotionReceiptSchema,
  hrEmployeePayrollHistoryQuerySchema,
  hrEmployeePayrollHistoryReceiptSchema,
  hrEmployeeAdvanceIssueReceiptSchema,
  hrEmployeeAdvanceReversalReceiptSchema,
  hrEmployeeAdvanceSettlementReceiptSchema,
  hrEmployeeAdvanceDeferralReceiptSchema,
  hrEmployeeAdvancesQuerySchema,
  hrEmployeeAdvancesReceiptSchema,
  hrEmployeeAdvanceDetailQuerySchema,
  hrEmployeeAdvanceDetailReceiptSchema,
  hrEmployeeAdministrativeDeductionDetailQuerySchema,
  hrEmployeeAdministrativeDeductionDetailReceiptSchema,
  hrEmployeeAdministrativeDeductionsQuerySchema,
  hrEmployeeAdministrativeDeductionsReceiptSchema,
  hrEmployeeAdministrativeDeductionReceiptSchema,
  hrEmployeeEntityReceiptSchema,
  hrEmployeeOnboardingReceiptSchema,
  hrEmployeesQuerySchema,
  hrEmployeesReceiptSchema,
  issueHrEmployeeAdvanceRequestSchema,
  reverseHrEmployeeAdvanceIssueRequestSchema,
  settleHrEmployeeAdvanceDirectlyRequestSchema,
  deferHrEmployeeAdvanceRequestSchema,
  createHrEmployeeAdministrativeDeductionRequestSchema,
  deferHrEmployeeAdministrativeDeductionRequestSchema,
  cancelHrEmployeeAdministrativeDeductionRequestSchema,
  setHrEmployeeCompensationRequestSchema,
  createHrCompensationPolicyRequestSchema,
  createHrCompensationPolicyVersionRequestSchema,
  approveHrCompensationPolicyVersionRequestSchema,
  createHrPayrollRunRequestSchema,
  updateHrPayrollDraftRequestSchema,
  previewHrPayrollRunRequestSchema,
  approveHrPayrollRunRequestSchema,
  discardHrPayrollRunRequestSchema,
  payHrPayrollRunRequestSchema,
  reverseHrPayrollRunRequestSchema,
  reverseHrPayrollPaymentRequestSchema,
  hrPayrollPaymentReversalReceiptSchema,
  reverseHrFinalSettlementPaymentRequestSchema,
  hrFinalSettlementPaymentReversalReceiptSchema,
  createHrEmployeeLeaveRequestSchema,
  returnHrEmployeeLeaveRequestSchema,
  hrEmployeeCompensationProfileReceiptSchema,
  hrEmployeeCompensationHistoryQuerySchema,
  hrEmployeeCompensationHistoryReceiptSchema,
  hrCompensationPoliciesReceiptSchema,
  hrCompensationPolicyReceiptSchema,
  hrPayrollRunsReceiptSchema,
  hrPayrollRunsQuerySchema,
  hrPayrollRunDetailQuerySchema,
  hrPayrollRunDetailReceiptSchema,
  hrPayrollRunReceiptSchema,
  hrPayrollPreviewReceiptSchema,
  hrHistoricalPayrollEvidenceQuerySchema,
  hrHistoricalPayrollEvidenceReceiptSchema,
  hrHistoricalPayrollEvidenceDetailQuerySchema,
  hrHistoricalPayrollEvidenceDetailReceiptSchema,
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
import { HrHistoricalPayrollEvidenceReadService } from './hr-historical-payroll-evidence-read.service.js';
import { HrPayrollService } from './hr-payroll.service.js';
import { HrLeaveService } from './hr-leave.service.js';
import { HrFinalSettlementService } from './hr-final-settlement.service.js';

const READ_CAPABILITY = 'hr.employees.read';
const WRITE_CAPABILITY = 'hr.employees.write';

@Controller('hr')
export class HrController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly hr: HrService,
    private readonly advances: HrAdvanceService,
    private readonly deductions: HrAdministrativeDeductionService,
    private readonly historicalPayrollEvidence: HrHistoricalPayrollEvidenceReadService,
    private readonly payroll: HrPayrollService,
    private readonly leaves: HrLeaveService,
    private readonly documents: PurchaseExpenseService,
    private readonly finalSettlements: HrFinalSettlementService,
  ) {}

  @Get('employees')
  async listEmployees(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee list query.');
    const access = await this.authorizeEmployeeRead(authorization, companyId);
    return hrEmployeesReceiptSchema.parse({ companyId: access.context.companyId, ...(await this.hr.listEmployees(access.context, { pageSize: parsed.data.pageSize, ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.search ? { search: parsed.data.search } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) }, { includePayroll: access.canReadPayroll })) });
  }

  @Get('employees/:employeeId')
  async employeeDetail(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeDetailQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-ledger query.');
    const access = await this.authorizeEmployeeRead(authorization, companyId);
    const result = await this.hr.employeeDetail(access.context, employeeId, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) }, {
      includePayroll: access.canReadPayroll,
      includeAdvances: access.canReadAdvances,
      includeLeaves: access.canReadLeaves,
      includeDocuments: access.canReadDocuments,
    });
    return hrEmployeeDetailReceiptSchema.parse({ companyId: access.context.companyId, ...result });
  }

  @Get('employees/:employeeId/payroll')
  async employeePayrollHistory(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeePayrollHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-payroll query.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrEmployeePayrollHistoryReceiptSchema.parse({ companyId: context.companyId, ...(await this.payroll.listForEmployee(context, employeeId, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Get('employees/:employeeId/compensation-history')
  async employeeCompensationHistory(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeCompensationHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-compensation-history query.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrEmployeeCompensationHistoryReceiptSchema.parse({ companyId: context.companyId, ...(await this.hr.compensationHistory(context, employeeId, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Get('employees/:employeeId/promotions')
  async employeePromotions(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeePromotionsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-promotion query.');
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return hrEmployeePromotionsReceiptSchema.parse({ companyId: context.companyId, ...(await this.hr.listPromotions(context, employeeId, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
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

  @Post('employees/onboard')
  @HttpCode(201)
  async onboardEmployee(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = onboardHrEmployeeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee onboarding request.');
    const context = await this.authorize(authorization, companyId, [WRITE_CAPABILITY, 'hr.payroll.create']);
    const { idempotencyKey, ...input } = parsed.data;
    return hrEmployeeOnboardingReceiptSchema.parse(await this.payroll.onboardEmployee(context, input, idempotencyKey));
  }

  @Post('employees/update')
  @HttpCode(200)
  async updateEmployee(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = updateHrEmployeeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee update request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...input } = parsed.data;
    return hrEmployeeEntityReceiptSchema.parse(await this.hr.updateEmployee(context, input, idempotencyKey));
  }

  @Post('employees/:employeeId/promotions')
  @HttpCode(201)
  async createEmployeePromotion(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const payload = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const parsed = createHrEmployeePromotionRequestSchema.safeParse({ ...payload, employeeId });
    if (!parsed.success) throw new BadRequestException('Invalid employee-promotion request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...input } = parsed.data;
    return hrEmployeePromotionReceiptSchema.parse(await this.hr.createPromotion(context, input, idempotencyKey));
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

  /** Records the service and its paid supplier invoice together; neither is committed alone. */
  @Post('services/record-and-issue')
  @HttpCode(201)
  async recordServiceAndIssueCost(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = recordHrEmployeeServiceAndIssueCostRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee service registration request.');
    const context = await this.authorize(authorization, companyId, [WRITE_CAPABILITY, 'finance.purchase_expense.create']);
    const { idempotencyKey, ...request } = parsed.data;
    return recordHrEmployeeServiceAndIssueCostReceiptSchema.parse(await this.documents.recordEmployeeServiceAndIssueCost({ context, idempotencyKey, request }));
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
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.expiryBefore ? { expiryBefore: parsed.data.expiryBefore } : {}),
      ...(parsed.data.expiryAfter ? { expiryAfter: parsed.data.expiryAfter } : {}),
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    });
    return hrEmployeeServicesReceiptSchema.parse({ companyId: context.companyId, ...result });
  }

  @Get('services/:serviceId')
  async serviceDetail(@Param('serviceId', ParseUUIDPipe) serviceId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, READ_CAPABILITY);
    return hrEmployeeServiceDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.hr.serviceDetail(context, serviceId)) });
  }

  @Post('services/update')
  @HttpCode(200)
  async updateService(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = updateHrEmployeeServiceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-service update request.');
    const context = await this.authorize(authorization, companyId, WRITE_CAPABILITY);
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeServiceReceiptSchema.parse(await this.hr.updateService(context, request, idempotencyKey));
  }

  @Post('services/cancel')
  @HttpCode(200)
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
    return hrEmployeeAdvancesReceiptSchema.parse({ companyId: context.companyId, ...(await this.advances.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.search ? { search: parsed.data.search } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Get('advances/entry-references')
  async advanceEntryReferences(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    return this.advances.entryReferences(await this.authorize(authorization, companyId, 'hr.advances.issue'));
  }

  @Get('advances/:advanceId')
  async advanceDetail(@Param('advanceId', ParseUUIDPipe) advanceId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeAdvanceDetailQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-advance detail query.');
    const context = await this.authorize(authorization, companyId, 'hr.advances.read');
    return hrEmployeeAdvanceDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.advances.detail(context, advanceId, { settlementPageSize: parsed.data.settlementPageSize, deferralPageSize: parsed.data.deferralPageSize, ...(parsed.data.settlementCursor ? { settlementCursor: parsed.data.settlementCursor } : {}), ...(parsed.data.deferralCursor ? { deferralCursor: parsed.data.deferralCursor } : {}) })) });
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

  @Post('advances/reverse')
  @HttpCode(200)
  async reverseAdvanceIssue(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = reverseHrEmployeeAdvanceIssueRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee-advance reversal request.');
    const context = await this.authorize(authorization, companyId, 'hr.advances.reverse');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdvanceReversalReceiptSchema.parse(await this.advances.reverseIssue(context, request, idempotencyKey));
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
    const context = await this.authorize(authorization, companyId, 'hr.deductions.read');
    return hrEmployeeAdministrativeDeductionsReceiptSchema.parse({ companyId: context.companyId, ...(await this.deductions.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.search ? { search: parsed.data.search } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  @Get('deductions/:deductionId')
  async administrativeDeductionDetail(@Param('deductionId', ParseUUIDPipe) deductionId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeAdministrativeDeductionDetailQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid administrative-deduction detail query.');
    const context = await this.authorize(authorization, companyId, 'hr.deductions.read');
    return hrEmployeeAdministrativeDeductionDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.deductions.detail(context, deductionId, { actionPageSize: parsed.data.actionPageSize, ...(parsed.data.actionCursor ? { actionCursor: parsed.data.actionCursor } : {}) })) });
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
  @HttpCode(200)
  async deferAdministrativeDeduction(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = deferHrEmployeeAdministrativeDeductionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid administrative-deduction deferral request.');
    const context = await this.authorize(authorization, companyId, 'hr.deductions.manage');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeAdministrativeDeductionReceiptSchema.parse(await this.deductions.defer(context, request, idempotencyKey));
  }

  @Post('deductions/cancel')
  @HttpCode(200)
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

  @Get('compensation-policies')
  async listCompensationPolicies(@Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrCompensationPoliciesReceiptSchema.parse({ companyId: context.companyId, ...(await this.payroll.listCompensationPolicies(context)) });
  }

  @Post('compensation-policies')
  @HttpCode(201)
  async createCompensationPolicy(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrCompensationPolicyRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid compensation policy request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.create');
    const { idempotencyKey, ...request } = parsed.data;
    return hrCompensationPolicyReceiptSchema.parse(await this.payroll.createCompensationPolicy(context, request, idempotencyKey));
  }

  @Post('compensation-policies/version')
  @HttpCode(201)
  async createCompensationPolicyVersion(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrCompensationPolicyVersionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid compensation policy version request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.create');
    const { idempotencyKey, ...request } = parsed.data;
    return hrCompensationPolicyReceiptSchema.parse(await this.payroll.createCompensationPolicyVersion(context, request, idempotencyKey));
  }

  @Post('compensation-policies/approve')
  @HttpCode(200)
  async approveCompensationPolicyVersion(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = approveHrCompensationPolicyVersionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid compensation policy approval request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.approve');
    const { idempotencyKey, ...request } = parsed.data;
    return hrCompensationPolicyReceiptSchema.parse(await this.payroll.approveCompensationPolicyVersion(context, request, idempotencyKey));
  }

  @Get('payroll-runs')
  async listPayrollRuns(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrPayrollRunsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid payroll-run query.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrPayrollRunsReceiptSchema.parse({ companyId: context.companyId, ...(await this.payroll.list(context, { pageSize: parsed.data.pageSize, ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.periodFrom ? { periodFrom: parsed.data.periodFrom } : {}), ...(parsed.data.periodTo ? { periodTo: parsed.data.periodTo } : {}), ...(parsed.data.search ? { search: parsed.data.search } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
  }

  /**
   * Noorix archival evidence is intentionally served outside HrPayrollRun.
   * This route has no write counterpart and evidence ids are not accepted by
   * operational payroll routes.
   */
  @Get('payroll-history/nurix')
  async listHistoricalNurixPayroll(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrHistoricalPayrollEvidenceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid historical payroll evidence query.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrHistoricalPayrollEvidenceReceiptSchema.parse(await this.historicalPayrollEvidence.list(context, {
      pageSize: 100,
      ...(parsed.data.periodFrom ? { periodFrom: parsed.data.periodFrom } : {}),
      ...(parsed.data.periodTo ? { periodTo: parsed.data.periodTo } : {}),
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
    }));
  }

  @Get('payroll-history/nurix/:evidenceId')
  async historicalNurixPayrollDetail(@Param('evidenceId', ParseUUIDPipe) evidenceId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrHistoricalPayrollEvidenceDetailQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid historical payroll evidence detail query.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrHistoricalPayrollEvidenceDetailReceiptSchema.parse(await this.historicalPayrollEvidence.detail(context, evidenceId, {
      linePageSize: parsed.data.linePageSize,
      ...(parsed.data.lineCursor ? { lineCursor: parsed.data.lineCursor } : {}),
    }));
  }

  @Get('payroll-runs/:payrollRunId')
  async payrollRunDetail(@Param('payrollRunId', ParseUUIDPipe) payrollRunId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrPayrollRunDetailQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid payroll-run detail query.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.read');
    return hrPayrollRunDetailReceiptSchema.parse({ companyId: context.companyId, ...(await this.payroll.detail(context, payrollRunId, {
      linePageSize: parsed.data.linePageSize,
      paymentPageSize: parsed.data.paymentPageSize,
      ...(parsed.data.lineCursor ? { lineCursor: parsed.data.lineCursor } : {}),
      ...(parsed.data.paymentCursor ? { paymentCursor: parsed.data.paymentCursor } : {}),
    })) });
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

  @Post('payroll-runs/preview')
  @HttpCode(200)
  async previewPayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = previewHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll-preview request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.create');
    return hrPayrollPreviewReceiptSchema.parse({ companyId: context.companyId, ...(await this.payroll.preview(context, parsed.data)) });
  }

  @Post('payroll-runs/update')
  @HttpCode(200)
  async updatePayrollDraft(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = updateHrPayrollDraftRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll draft update request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.create');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.updateDraft(context, request, idempotencyKey));
  }

  @Post('payroll-runs/approve')
  @HttpCode(200)
  async approvePayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = approveHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll approval request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.approve');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.approve(context, request, idempotencyKey));
  }

  @Post('payroll-runs/discard')
  @HttpCode(200)
  async discardPayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = discardHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll draft discard request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.create');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.discard(context, request, idempotencyKey));
  }

  @Post('payroll-runs/pay')
  @HttpCode(200)
  async payPayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = payHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll payment request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.pay');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.pay(context, request, idempotencyKey));
  }

  @Post('payroll-runs/reverse')
  @HttpCode(200)
  async reversePayrollRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = reverseHrPayrollRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll reversal request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.reverse');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollRunReceiptSchema.parse(await this.payroll.reverse(context, request, idempotencyKey));
  }

  @Post('payroll-payments/reverse')
  @HttpCode(200)
  async reversePayrollPayment(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = reverseHrPayrollPaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid payroll-payment reversal request.');
    const context = await this.authorize(authorization, companyId, 'hr.payroll.reverse');
    const { idempotencyKey, ...request } = parsed.data;
    return hrPayrollPaymentReversalReceiptSchema.parse(await this.payroll.reversePayment(context, request, idempotencyKey));
  }

  @Post('final-settlement-payments/reverse')
  @HttpCode(200)
  async reverseFinalSettlementPayment(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = reverseHrFinalSettlementPaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid final-settlement payment reversal request.');
    const context = await this.authorize(authorization, companyId, 'hr.final_settlements.reverse');
    const { idempotencyKey, ...request } = parsed.data;
    return hrFinalSettlementPaymentReversalReceiptSchema.parse(await this.finalSettlements.reversePayment(context, request, idempotencyKey));
  }

  @Get('leaves')
  async listLeaves(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeLeavesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid employee-leave query.');
    const context = await this.authorize(authorization, companyId, 'hr.leaves.read');
    return hrEmployeeLeavesReceiptSchema.parse({ companyId: context.companyId, ...(await this.leaves.list(context, { pageSize: parsed.data.pageSize, sortDirection: parsed.data.sortDirection, ...(parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.leaveType ? { leaveType: parsed.data.leaveType } : {}), ...(parsed.data.periodFrom ? { periodFrom: parsed.data.periodFrom } : {}), ...(parsed.data.periodTo ? { periodTo: parsed.data.periodTo } : {}), ...(parsed.data.search ? { search: parsed.data.search } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) })) });
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
  @HttpCode(200)
  async returnFromLeave(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = returnHrEmployeeLeaveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee return request.');
    const context = await this.authorize(authorization, companyId, 'hr.leaves.manage');
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeLeaveReceiptSchema.parse(await this.leaves.returnEmployee(context, request, idempotencyKey));
  }

  @Get('leaves/:leaveId')
  async leaveDetail(@Param('leaveId', ParseUUIDPipe) leaveId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
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

  @Post('services/reverse-cost')
  @HttpCode(200)
  async reverseServiceCost(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = reverseHrEmployeeServiceCostRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid employee service-cost reversal request.');
    const context = await this.authorize(authorization, companyId, [WRITE_CAPABILITY, 'finance.purchase_expense.cancel']);
    const { idempotencyKey, ...request } = parsed.data;
    return hrEmployeeServiceCostReversalReceiptSchema.parse(await this.documents.reverseEmployeeServiceCost({ context, idempotencyKey, request }));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string | readonly string[]) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company HR scope is not permitted.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: Array.isArray(capability) ? capability : [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }

  private async authorizeEmployeeRead(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new ForbiddenException('Company HR scope is not permitted.');
    const authorized = await this.companyContext.authorizeAvailable({
      accessToken,
      companyId: parsedCompanyId.data,
      requestedCapabilities: [READ_CAPABILITY, 'hr.payroll.read', 'hr.advances.read', 'hr.leaves.read', 'hr.employee_documents.read'],
    });
    if (!authorized.capabilities.includes(READ_CAPABILITY)) throw new ForbiddenException('Company HR scope is not permitted.');
    return {
      context: { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId },
      canReadPayroll: authorized.capabilities.includes('hr.payroll.read'),
      canReadAdvances: authorized.capabilities.includes('hr.advances.read'),
      canReadLeaves: authorized.capabilities.includes('hr.leaves.read'),
      canReadDocuments: authorized.capabilities.includes('hr.employee_documents.read'),
    };
  }
}
