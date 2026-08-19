import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ApproveHrPayrollRunRequest,
  CreateHrPayrollRunRequest,
  PayHrPayrollRunRequest,
  ReverseHrPayrollRunRequest,
  SetHrEmployeeCompensationRequest,
} from '@baseer-erp/contracts';

import { BusinessDateService } from '../business-date/business-date.service.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  HrEmployeeAdministrativeDeductionActionType,
  HrEmployeeAdministrativeDeductionStatus,
  HrEmployeeAdvanceSettlementSource,
  HrEmployeeAdvanceStatus,
  HrEmployeeFinancialMovementType,
  HrEmployeeStatus,
  HrCompensationMethod,
  HrPayrollRunStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { FinanceVaultService } from '../finance/finance-vault.service.js';
import { JournalPostingService } from '../finance/journal/journal-posting.service.js';

const COMPENSATION_OPERATION = 'hr.compensation.set';
const CREATE_OPERATION = 'hr.payroll.create';
const APPROVE_OPERATION = 'hr.payroll.approve';
const PAY_OPERATION = 'hr.payroll.pay';
const REVERSE_OPERATION = 'hr.payroll.reverse';
const PAYROLL_EXPENSE = 'PAYROLL_EXPENSE';
const PAYROLL_PAYABLE = 'PAYROLL_PAYABLE';
const EMPLOYEE_ADVANCES = 'EMPLOYEE_ADVANCES';
const ADMIN_DEDUCTION_RECOVERY = 'EMPLOYEE_ADMIN_DEDUCTION_RECOVERY';

type CreateInput = Omit<CreateHrPayrollRunRequest, 'idempotencyKey'>;
type ApproveInput = Omit<ApproveHrPayrollRunRequest, 'idempotencyKey'>;
type PayInput = Omit<PayHrPayrollRunRequest, 'idempotencyKey'>;
type ReverseInput = Omit<ReverseHrPayrollRunRequest, 'idempotencyKey'>;
type CompensationInput = Omit<SetHrEmployeeCompensationRequest, 'idempotencyKey'>;
type PayrollRunListQuery = Readonly<{ status?: HrPayrollRunStatus; cursor?: string; pageSize: number }>;

@Injectable()
export class HrPayrollService {
  constructor(
    private readonly database: DatabaseService,
    private readonly dates: BusinessDateService,
    private readonly serials: DocumentSerialService,
    private readonly idempotency: IdempotencyService,
    private readonly vaults: FinanceVaultService,
    private readonly journals: JournalPostingService,
  ) {}

  async setCompensation(context: TrustedCompanyActorContext, input: CompensationInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.effectiveFrom, 'Compensation cannot start in the future.');
      const begun = await this.begin(tx, context, COMPENSATION_OPERATION, key, input);
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      const employee = await tx.hrEmployee.findFirst({ where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true } });
      if (!employee) throw new NotFoundException('The employee is not available for compensation.');
      const current = await tx.hrEmployeeCompensationProfile.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (current && current.effectiveFrom.getTime() >= input.effectiveFrom.getTime()) {
        throw new ConflictException('The effective compensation date must be later than the current profile.');
      }
      if (current) await tx.hrEmployeeCompensationProfile.update({ where: { id: current.id }, data: { effectiveTo: previousDay(input.effectiveFrom) } });
      const compensation = calculateCompensation({
        monthlyGross: amount(input.monthlyGross),
        compensationMethod: input.compensationMethod,
        foodAllowance: nonNegativeAmount(input.foodAllowance),
        otherAllowance: nonNegativeAmount(input.otherAllowance),
        scheduledHoursPerDay: input.scheduledHoursPerDay ?? null,
        scheduledWorkDays: input.scheduledWorkDays ?? null,
      });
      const id = randomUUID();
      await tx.hrEmployeeCompensationProfile.create({ data: {
        id, tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, effectiveFrom: input.effectiveFrom,
        monthlyGross: compensation.gross, compensationMethod: compensation.method, foodAllowance: compensation.foodAllowance,
        otherAllowance: compensation.otherAllowance, scheduledHoursPerDay: compensation.scheduledHoursPerDay,
        scheduledWorkDays: compensation.scheduledWorkDays, notes: nullable(input.notes), createdByUserId: context.actorUserId,
      } });
      const receipt = { id, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.compensation.set', 'HrEmployeeCompensationProfile', id, receipt);
      return receipt;
    });
  }

  async list(context: TrustedCompanyActorContext, query: PayrollRunListQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const cursor = query.cursor ? await tx.hrPayrollRun.findFirst({ where: { id: query.cursor, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, payrollMonth: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The payroll-run cursor is invalid.');
      const rows = await tx.hrPayrollRun.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          ...(query.status ? { status: query.status } : {}),
          ...(cursor ? { OR: [{ payrollMonth: { lt: cursor.payrollMonth } }, { payrollMonth: cursor.payrollMonth, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ payrollMonth: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
      });
      const hasMore = rows.length > query.pageSize;
      const runs = hasMore ? rows.slice(0, query.pageSize) : rows;
      return { payrollRuns: runs.map(mapRun), hasMore, nextCursor: hasMore ? runs.at(-1)?.id ?? null : null };
    });
  }

  async detail(context: TrustedCompanyActorContext, payrollRunId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.findRun(tx, context, payrollRunId, true);
      return {
        payrollRun: mapRun(run),
        lines: run.lines.map((line) => ({
          id: line.id, employeeId: line.employeeId, employeeNumber: line.employeeNumberSnapshot, employeeNameAr: line.employeeNameArSnapshot, employeeNameEn: line.employeeNameEnSnapshot,
          grossSalary: fixed(line.grossSalary), compensationMethod: line.compensationMethod,
          basicSalary: fixed(line.basicSalary), foodAllowance: fixed(line.foodAllowance), otherAllowance: fixed(line.otherAllowance), overtimeAmount: fixed(line.overtimeAmount), overtimeHours: fixed(line.overtimeHours),
          scheduledHoursPerDay: line.scheduledHoursPerDay, scheduledWorkDays: line.scheduledWorkDays,
          advanceSettlementAmount: fixed(line.advanceSettlementAmount), administrativeDeductionAmount: fixed(line.administrativeDeductionAmount), netPayableAmount: fixed(line.netPayableAmount), paidAmount: fixed(line.paidAmount),
          advances: line.advanceApplications.map((app) => ({ id: app.id, amount: fixed(app.amount), referenceNumber: app.advance.advanceNumber })),
          administrativeDeductions: line.deductionApplications.map((app) => ({ id: app.id, amount: fixed(app.amount), referenceNumber: app.deduction.deductionNumber })),
        })),
        payments: run.payments.map((payment) => ({ id: payment.id, paymentNumber: payment.paymentNumber, businessDate: ymd(payment.businessDate), amount: fixed(payment.amount), journalEntryId: payment.journalEntryId })),
      };
    });
  }

  async create(context: TrustedCompanyActorContext, input: CreateInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, CREATE_OPERATION, key, input);
      if (begun.kind === 'replay') return begun.response.body as { id: string; runNumber: string; replayed: boolean };
      const payrollMonth = firstOfMonth(input.payrollMonth);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:payroll:${ymd(payrollMonth)}`}, 0))`;
      const existing = await tx.hrPayrollRun.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, payrollMonth }, select: { id: true } });
      if (existing) throw new ConflictException('A payroll run already exists for this month.');
      const requestedEmployeeIds = [...new Set(input.lines.map((line) => line.employeeId))];
      if (requestedEmployeeIds.length !== input.lines.length) throw new BadRequestException('An employee can appear once in a payroll run.');
      const employees = await tx.hrEmployee.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] },
          ...(!input.includeAllEligible ? { id: { in: requestedEmployeeIds } } : {}),
        },
        select: { id: true, employeeNumber: true, nameAr: true, nameEn: true },
      });
      if (!employees.length) throw new BadRequestException('No active or on-leave employees are available for this payroll run.');
      if (!input.includeAllEligible && employees.length !== requestedEmployeeIds.length) throw new BadRequestException('Every payroll employee must be active or on leave in this company.');
      const requestedLines = new Map(input.lines.map((line) => [line.employeeId, line]));
      const lines = employees.map((employee) => requestedLines.get(employee.id) ?? { employeeId: employee.id, advances: [], administrativeDeductions: [] });
      const uniqueEmployeeIds = employees.map((employee) => employee.id);
      const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
      const profileRows = await tx.hrEmployeeCompensationProfile.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: uniqueEmployeeIds }, effectiveFrom: { lte: payrollMonth }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: payrollMonth } }] }, orderBy: { effectiveFrom: 'desc' } });
      const profileByEmployee = new Map<string, typeof profileRows[number]>();
      for (const profile of profileRows) if (!profileByEmployee.has(profile.employeeId)) profileByEmployee.set(profile.employeeId, profile);
      if (profileByEmployee.size !== uniqueEmployeeIds.length) throw new BadRequestException('Every payroll employee must have an active monthly compensation profile.');
      const runId = randomUUID();
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'PAYROLL_RUN', businessDate: ymd(input.businessDate) });
      const runNumber = `PAY-${ymd(payrollMonth).slice(0, 7).replace('-', '')}-${serial.toString().padStart(4, '0')}`;
      const rows = await Promise.all(lines.map(async (line) => {
        const employee = employeeById.get(line.employeeId)!;
        const compensation = calculateCompensation(profileByEmployee.get(line.employeeId)!);
        const gross = compensation.gross;
        const advances = await this.resolveAdvanceApplications(tx, context, line.employeeId, line.advances);
        const deductions = await this.resolveDeductionApplications(tx, context, line.employeeId, line.administrativeDeductions);
        const advanceAmount = sum(advances.map((item) => item.amount));
        const deductionAmount = sum(deductions.map((item) => item.amount));
        if (advanceAmount.plus(deductionAmount).gt(gross)) throw new BadRequestException('Employee deductions cannot exceed the gross salary.');
        return { id: randomUUID(), employee, compensation, gross, advances, deductions, advanceAmount, deductionAmount, net: gross.minus(advanceAmount).minus(deductionAmount) };
      }));
      const grossAmount = sum(rows.map((row) => row.gross));
      const advanceSettlementAmount = sum(rows.map((row) => row.advanceAmount));
      const administrativeDeductionAmount = sum(rows.map((row) => row.deductionAmount));
      const netPayableAmount = grossAmount.minus(advanceSettlementAmount).minus(administrativeDeductionAmount);
      await tx.hrPayrollRun.create({ data: { id: runId, tenantId: context.tenantId, companyId: context.companyId, runNumber, payrollMonth, businessDate: input.businessDate, employeeCount: rows.length, grossAmount, advanceSettlementAmount, administrativeDeductionAmount, netPayableAmount, notes: nullable(input.notes), createdByUserId: context.actorUserId } });
      for (const row of rows) {
        await tx.hrPayrollLine.create({ data: {
          id: row.id, tenantId: context.tenantId, companyId: context.companyId, payrollRunId: runId, employeeId: row.employee.id,
          employeeNumberSnapshot: row.employee.employeeNumber, employeeNameArSnapshot: row.employee.nameAr, employeeNameEnSnapshot: row.employee.nameEn,
          grossSalary: row.gross, compensationMethod: row.compensation.method, basicSalary: row.compensation.basicSalary,
          foodAllowance: row.compensation.foodAllowance, otherAllowance: row.compensation.otherAllowance,
          overtimeAmount: row.compensation.overtimeAmount, overtimeHours: row.compensation.overtimeHours,
          scheduledHoursPerDay: row.compensation.scheduledHoursPerDay, scheduledWorkDays: row.compensation.scheduledWorkDays,
          advanceSettlementAmount: row.advanceAmount, administrativeDeductionAmount: row.deductionAmount, netPayableAmount: row.net,
        } });
        if (row.advances.length) await tx.hrPayrollAdvanceApplication.createMany({ data: row.advances.map((app) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, payrollLineId: row.id, advanceId: app.id, amount: app.amount })) });
        if (row.deductions.length) await tx.hrPayrollAdministrativeDeductionApplication.createMany({ data: row.deductions.map((app) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, payrollLineId: row.id, deductionId: app.id, amount: app.amount })) });
      }
      const receipt = { id: runId, runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.created', 'HrPayrollRun', runId, receipt);
      return receipt;
    });
  }

  async approve(context: TrustedCompanyActorContext, input: ApproveInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, APPROVE_OPERATION, key, input);
      if (begun.kind === 'replay') return begun.response.body as { id: string; runNumber: string; replayed: boolean };
      const run = await this.findRun(tx, context, input.payrollRunId, true);
      if (run.status !== HrPayrollRunStatus.DRAFT) throw new ConflictException('Only a draft payroll run can be approved.');
      const accounts = await this.systemAccounts(tx, context, [PAYROLL_EXPENSE, PAYROLL_PAYABLE, EMPLOYEE_ADVANCES, ADMIN_DEDUCTION_RECOVERY]);
      const journal = await this.journals.postInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `payroll-accrual:${run.id}`, sourceType: 'hr_payroll_accrual', sourceReference: run.id, businessDate: input.businessDate, description: `Payroll accrual ${run.runNumber}`, lines: [
        { accountId: accounts.get(PAYROLL_EXPENSE)!, debitAmount: fixed(run.grossAmount), description: run.runNumber },
        ...(run.advanceSettlementAmount.gt(0) ? [{ accountId: accounts.get(EMPLOYEE_ADVANCES)!, creditAmount: fixed(run.advanceSettlementAmount), description: `${run.runNumber} advance settlements` }] : []),
        ...(run.administrativeDeductionAmount.gt(0) ? [{ accountId: accounts.get(ADMIN_DEDUCTION_RECOVERY)!, creditAmount: fixed(run.administrativeDeductionAmount), description: `${run.runNumber} administrative recoveries` }] : []),
        ...(run.netPayableAmount.gt(0) ? [{ accountId: accounts.get(PAYROLL_PAYABLE)!, creditAmount: fixed(run.netPayableAmount), description: `${run.runNumber} net payroll payable` }] : []),
      ] });
      for (const line of run.lines) {
        for (const app of line.advanceApplications) await this.applyAdvance(tx, context, app.advanceId, app.amount, input.businessDate, journal.journalEntryId, run.runNumber);
        for (const app of line.deductionApplications) await this.applyDeduction(tx, context, app.deductionId, app.amount, input.businessDate, run.runNumber);
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: line.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.PAYROLL_ACCRUAL, businessDate: input.businessDate, amount: line.grossSalary, sourceReference: run.runNumber, description: 'Payroll accrued' } });
      }
      await tx.hrPayrollRun.update({ where: { id: run.id }, data: { status: HrPayrollRunStatus.APPROVED, accrualJournalEntryId: journal.journalEntryId, approvedAt: new Date(), businessDate: input.businessDate } });
      const receipt = { id: run.id, runNumber: run.runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.approved', 'HrPayrollRun', run.id, { ...receipt, journalEntryId: journal.journalEntryId });
      return receipt;
    });
  }

  async pay(context: TrustedCompanyActorContext, input: PayInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, PAY_OPERATION, key, input);
      if (begun.kind === 'replay') return begun.response.body as { id: string; runNumber: string; replayed: boolean };
      const run = await this.findRun(tx, context, input.payrollRunId, true);
      if (run.status !== HrPayrollRunStatus.APPROVED && run.status !== HrPayrollRunStatus.PARTIALLY_PAID) throw new ConflictException('Only an approved unpaid payroll can be paid.');
      const allocations = await this.validateAllocations(tx, context, input.allocations);
      const paymentAmount = sum(allocations.map((allocation) => allocation.amount));
      const remaining = run.netPayableAmount.minus(run.paidAmount);
      if (paymentAmount.gt(remaining)) throw new BadRequestException('Payroll payment cannot exceed the unpaid net amount.');
      const account = await this.systemAccounts(tx, context, [PAYROLL_PAYABLE]);
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'PAYROLL_PAYMENT', businessDate: ymd(input.businessDate) });
      const paymentNumber = `PPY-${serial.toString().padStart(6, '0')}`;
      const journal = await this.journals.postInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `payroll-payment:${paymentNumber}`, sourceType: 'hr_payroll_payment', sourceReference: paymentNumber, businessDate: input.businessDate, description: `Payroll payment ${run.runNumber}`, lines: [{ accountId: account.get(PAYROLL_PAYABLE)!, debitAmount: fixed(paymentAmount), description: run.runNumber }, ...allocations.map((allocation) => ({ accountId: allocation.accountId, creditAmount: fixed(allocation.amount), description: paymentNumber }))] });
      const paymentId = randomUUID();
      await tx.hrPayrollPayment.create({ data: { id: paymentId, tenantId: context.tenantId, companyId: context.companyId, payrollRunId: run.id, paymentNumber, businessDate: input.businessDate, amount: paymentAmount, journalEntryId: journal.journalEntryId, createdByUserId: context.actorUserId } });
      await tx.hrPayrollPaymentAllocation.createMany({ data: allocations.map((allocation) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, payrollPaymentId: paymentId, vaultId: allocation.vaultId, paymentMethod: allocation.paymentMethod, amount: allocation.amount })) });
      let remainder = paymentAmount;
      for (const line of run.lines) {
        if (remainder.lte(0)) break;
        const lineRemaining = line.netPayableAmount.minus(line.paidAmount);
        const paid = Prisma.Decimal.min(lineRemaining, remainder);
        if (paid.lte(0)) continue;
        await tx.hrPayrollLine.update({ where: { id: line.id }, data: { paidAmount: { increment: paid } } });
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: line.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.PAYROLL_PAYMENT, businessDate: input.businessDate, amount: paid, sourceReference: paymentNumber, description: `Payroll payment ${run.runNumber}` } });
        remainder = remainder.minus(paid);
      }
      const nowPaid = run.paidAmount.plus(paymentAmount);
      await tx.hrPayrollRun.update({ where: { id: run.id }, data: { paidAmount: nowPaid, status: nowPaid.eq(run.netPayableAmount) ? HrPayrollRunStatus.PAID : HrPayrollRunStatus.PARTIALLY_PAID } });
      const receipt = { id: run.id, runNumber: run.runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.paid', 'HrPayrollRun', run.id, { ...receipt, paymentNumber, journalEntryId: journal.journalEntryId });
      return receipt;
    });
  }

  async reverse(context: TrustedCompanyActorContext, input: ReverseInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, REVERSE_OPERATION, key, input);
      if (begun.kind === 'replay') return begun.response.body as { id: string; runNumber: string; replayed: boolean };
      const run = await this.findRun(tx, context, input.payrollRunId, true);
      if (run.status !== HrPayrollRunStatus.APPROVED) throw new ConflictException('A payroll must be unpaid before its accrual can be reversed.');
      if (!run.accrualJournalEntryId) throw new ConflictException('The payroll accrual is missing.');
      await this.journals.reverseInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `payroll-reversal:${run.id}`, journalEntryId: run.accrualJournalEntryId, businessDate: input.businessDate, reason: input.reason });
      for (const line of run.lines) {
        for (const app of line.advanceApplications) await this.reverseAdvance(tx, context, app.advanceId, app.amount, input.businessDate, run.runNumber);
        for (const app of line.deductionApplications) await this.reverseDeduction(tx, context, app.deductionId, app.amount, input.businessDate, run.runNumber, input.reason);
      }
      await tx.hrPayrollRun.update({ where: { id: run.id }, data: { status: HrPayrollRunStatus.REVERSED, reversedAt: new Date(), reversalReason: input.reason } });
      const receipt = { id: run.id, runNumber: run.runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.reversed', 'HrPayrollRun', run.id, receipt);
      return receipt;
    });
  }

  private async findRun(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, id: string, _detail = true) {
    const run = await tx.hrPayrollRun.findFirst({ where: { id, tenantId: context.tenantId, companyId: context.companyId }, include: { lines: { orderBy: { employeeNumberSnapshot: 'asc' }, include: { advanceApplications: { include: { advance: { select: { advanceNumber: true } } } }, deductionApplications: { include: { deduction: { select: { deductionNumber: true } } } } } }, payments: { orderBy: [{ businessDate: 'desc' }, { id: 'desc' }] } } });
    if (!run) throw new NotFoundException('The payroll run was not found.');
    return run as Prisma.HrPayrollRunGetPayload<{ include: { lines: { include: { advanceApplications: { include: { advance: true } }; deductionApplications: { include: { deduction: true } } } }; payments: true } }>;
  }

  private async resolveAdvanceApplications(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, applications: readonly { id: string; amount: string }[]) {
    const ids = applications.map((item) => item.id); if (new Set(ids).size !== ids.length) throw new BadRequestException('An advance can be selected once per employee.');
    if (!ids.length) return [] as Array<{ id: string; amount: Prisma.Decimal }>;
    const advances = await tx.hrEmployeeAdvance.findMany({ where: { id: { in: ids }, tenantId: context.tenantId, companyId: context.companyId, employeeId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] } }, select: { id: true, remainingAmount: true } });
    if (advances.length !== ids.length) throw new BadRequestException('A selected advance is unavailable for this employee.');
    const balances = new Map(advances.map((advance) => [advance.id, advance.remainingAmount]));
    return applications.map((item) => { const value = amount(item.amount); if (value.gt(balances.get(item.id)!)) throw new BadRequestException('Advance settlement exceeds its remaining balance.'); return { id: item.id, amount: value }; });
  }

  private async resolveDeductionApplications(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, applications: readonly { id: string; amount: string }[]) {
    const ids = applications.map((item) => item.id); if (new Set(ids).size !== ids.length) throw new BadRequestException('An administrative deduction can be selected once per employee.');
    if (!ids.length) return [] as Array<{ id: string; amount: Prisma.Decimal }>;
    const deductions = await tx.hrEmployeeAdministrativeDeduction.findMany({ where: { id: { in: ids }, tenantId: context.tenantId, companyId: context.companyId, employeeId, status: { in: [HrEmployeeAdministrativeDeductionStatus.OPEN, HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED, HrEmployeeAdministrativeDeductionStatus.DEFERRED] } }, select: { id: true, remainingAmount: true } });
    if (deductions.length !== ids.length) throw new BadRequestException('A selected administrative deduction is unavailable for this employee.');
    const balances = new Map(deductions.map((deduction) => [deduction.id, deduction.remainingAmount]));
    return applications.map((item) => { const value = amount(item.amount); if (value.gt(balances.get(item.id)!)) throw new BadRequestException('Administrative deduction exceeds its remaining balance.'); return { id: item.id, amount: value }; });
  }

  private async applyAdvance(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, advanceId: string, applied: Prisma.Decimal, businessDate: Date, journalEntryId: string, reference: string) {
    const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: advanceId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!advance || advance.remainingAmount.lt(applied)) throw new ConflictException('An advance changed before payroll approval.');
    const remaining = advance.remainingAmount.minus(applied);
    await tx.hrEmployeeAdvance.update({ where: { id: advanceId }, data: { settledAmount: { increment: applied }, remainingAmount: remaining, nextSettlementDate: null, status: remaining.eq(0) ? HrEmployeeAdvanceStatus.SETTLED : HrEmployeeAdvanceStatus.PARTIALLY_SETTLED } });
    await tx.hrEmployeeAdvanceSettlement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, advanceId, source: HrEmployeeAdvanceSettlementSource.PAYROLL, businessDate, amount: applied, journalEntryId } });
  }

  private async applyDeduction(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, deductionId: string, applied: Prisma.Decimal, businessDate: Date, reference: string) {
    const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: deductionId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!deduction || deduction.remainingAmount.lt(applied)) throw new ConflictException('An administrative deduction changed before payroll approval.');
    const remaining = deduction.remainingAmount.minus(applied);
    await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: deductionId }, data: { appliedAmount: { increment: applied }, remainingAmount: remaining, plannedPayrollDate: null, status: remaining.eq(0) ? HrEmployeeAdministrativeDeductionStatus.APPLIED : HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED } });
    await tx.hrEmployeeAdministrativeDeductionAction.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, deductionId, actionType: HrEmployeeAdministrativeDeductionActionType.APPLIED, businessDate, amount: applied, reason: reference, createdByUserId: context.actorUserId } });
  }

  private async reverseAdvance(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, advanceId: string, applied: Prisma.Decimal, businessDate: Date, reference: string) {
    const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: advanceId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!advance || advance.settledAmount.lt(applied)) throw new ConflictException('Advance settlement cannot be reversed safely.');
    const remaining = advance.remainingAmount.plus(applied);
    await tx.hrEmployeeAdvance.update({ where: { id: advanceId }, data: { settledAmount: { decrement: applied }, remainingAmount: remaining, status: advance.settledAmount.eq(applied) ? HrEmployeeAdvanceStatus.ISSUED : HrEmployeeAdvanceStatus.PARTIALLY_SETTLED } });
  }

  private async reverseDeduction(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, deductionId: string, applied: Prisma.Decimal, businessDate: Date, reference: string, reason: string) {
    const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: deductionId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!deduction || deduction.appliedAmount.lt(applied)) throw new ConflictException('Administrative deduction cannot be reversed safely.');
    const remaining = deduction.remainingAmount.plus(applied);
    await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: deductionId }, data: { appliedAmount: { decrement: applied }, remainingAmount: remaining, status: deduction.appliedAmount.eq(applied) ? HrEmployeeAdministrativeDeductionStatus.OPEN : HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED } });
    await tx.hrEmployeeAdministrativeDeductionAction.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, deductionId, actionType: HrEmployeeAdministrativeDeductionActionType.REVERSED, businessDate, amount: applied, reason: `${reference}: ${reason}`, createdByUserId: context.actorUserId } });
  }

  private async validateAllocations(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, allocations: readonly { vaultId: string; amount: string; paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'BANK_CARD' | 'BANK_PAYMENT' | 'APP' | undefined }[]) {
    const used = new Set<string>();
    const result: Array<{ vaultId: string; accountId: string; amount: Prisma.Decimal; paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'BANK_CARD' | 'BANK_PAYMENT' | 'APP' }> = [];
    for (const allocation of allocations) {
      const vault = await this.vaults.assertActivePaymentDestination(tx, { tenantId: context.tenantId, companyId: context.companyId, vaultId: allocation.vaultId });
      const paymentMethod = allocation.paymentMethod ?? vault.paymentMethod;
      if (!vault.paymentMethods.includes(paymentMethod)) throw new BadRequestException('The payment method is not enabled for the selected vault.');
      const duplicate = `${allocation.vaultId}:${paymentMethod}`; if (used.has(duplicate)) throw new BadRequestException('A vault/payment method can appear once in a payroll payment.'); used.add(duplicate);
      result.push({ vaultId: allocation.vaultId, accountId: vault.accountId, amount: amount(allocation.amount), paymentMethod });
    }
    return result;
  }

  private async systemAccounts(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, keys: readonly string[]) {
    const accounts = await tx.financeAccount.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: { in: [...keys] }, status: FinanceAccountStatus.ACTIVE }, select: { systemKey: true, id: true } });
    if (accounts.length !== keys.length) throw new ConflictException('The company finance foundation is missing a required payroll account.');
    return new Map(accounts.map((account) => [account.systemKey!, account.id]));
  }

  private async begin(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, operation: string, key: string, request: object) {
    try { return await this.idempotency.beginInTransaction(tx, context, { operation, key, request: request as never, expiresAt: tomorrow() }); }
    catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with a different payroll request.'); throw error; }
  }
  private async complete(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, receiptId: string, body: object) { await this.idempotency.completeInTransaction(tx, context, { receiptId, response: { status: 201, headers: null, body: body as never } }); }
  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, afterJson: object) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: `${action}:${entityId}`, afterJson: afterJson as Prisma.InputJsonValue } }); }
}

function amount(value: string) { const parsed = new Prisma.Decimal(value); if (!parsed.isFinite() || parsed.lte(0) || (parsed.decimalPlaces() ?? 0) > 4) throw new BadRequestException('A payroll amount must be a positive decimal with at most four places.'); return parsed; }
function nonNegativeAmount(value: string) { const parsed = new Prisma.Decimal(value); if (!parsed.isFinite() || parsed.lt(0) || (parsed.decimalPlaces() ?? 0) > 4) throw new BadRequestException('A compensation allowance must be a non-negative decimal with at most four places.'); return parsed; }
function sum(values: readonly Prisma.Decimal[]) { return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0)); }
function fixed(value: Prisma.Decimal) { return value.toFixed(4); }
function nullable(value: string | undefined) { const text = value?.trim(); return text || null; }
const STANDARD_MONTHLY_HOURS = new Prisma.Decimal(208);
const STANDARD_MONTHLY_DAYS = 26;

type CompensationInputForCalculation = Readonly<{
  monthlyGross: Prisma.Decimal;
  compensationMethod: HrCompensationMethod;
  foodAllowance: Prisma.Decimal;
  otherAllowance: Prisma.Decimal;
  scheduledHoursPerDay: number | null;
  scheduledWorkDays: number | null;
}>;

/**
 * Mirrors the agreed Noorix inverse package calculation. This is a payroll
 * calculation only: it neither approves a schedule nor determines legality.
 */
function calculateCompensation(input: CompensationInputForCalculation) {
  if (input.compensationMethod === HrCompensationMethod.FIXED_MONTHLY) {
    return {
      method: HrCompensationMethod.FIXED_MONTHLY,
      gross: input.monthlyGross,
      basicSalary: input.monthlyGross,
      foodAllowance: new Prisma.Decimal(0),
      otherAllowance: new Prisma.Decimal(0),
      overtimeAmount: new Prisma.Decimal(0),
      overtimeHours: new Prisma.Decimal(0),
      scheduledHoursPerDay: null,
      scheduledWorkDays: null,
    };
  }
  const dailyHours = input.scheduledHoursPerDay;
  const workDays = input.scheduledWorkDays;
  if (!dailyHours || !workDays || dailyHours <= 8) throw new BadRequestException('An inclusive overtime agreement needs daily hours above eight and agreed monthly work days.');
  const regularDays = Math.min(workDays, STANDARD_MONTHLY_DAYS);
  const restDays = Math.max(workDays - STANDARD_MONTHLY_DAYS, 0);
  const overtimeHours = new Prisma.Decimal(dailyHours - 8).times(regularDays).plus(new Prisma.Decimal(restDays).times(dailyHours));
  const coefficient = overtimeHours.div(STANDARD_MONTHLY_HOURS);
  const allowances = input.foodAllowance.plus(input.otherAllowance);
  const basicSalary = input.monthlyGross.minus(allowances.times(new Prisma.Decimal(1).plus(coefficient))).div(new Prisma.Decimal(1).plus(coefficient.times(1.5))).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  if (basicSalary.lte(0)) throw new BadRequestException('The agreed total cannot cover the selected allowances and overtime schedule.');
  const overtimeAmount = input.monthlyGross.minus(basicSalary).minus(allowances).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  if (overtimeAmount.lt(0)) throw new BadRequestException('The agreed total cannot produce a non-negative overtime amount.');
  return {
    method: HrCompensationMethod.INCLUSIVE_OVERTIME,
    gross: input.monthlyGross,
    basicSalary,
    foodAllowance: input.foodAllowance,
    otherAllowance: input.otherAllowance,
    overtimeAmount,
    overtimeHours: overtimeHours.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
    scheduledHoursPerDay: dailyHours,
    scheduledWorkDays: workDays,
  };
}
function ymd(value: Date): `${number}-${number}-${number}` { return value.toISOString().slice(0, 10) as `${number}-${number}-${number}`; }
function firstOfMonth(value: Date) { return new Date(`${ymd(value).slice(0, 7)}-01T00:00:00.000Z`); }
function previousDay(value: Date) { return new Date(value.getTime() - 24 * 60 * 60 * 1_000); }
function tomorrow() { return new Date(Date.now() + 24 * 60 * 60 * 1_000); }
function mapRun(run: { id: string; runNumber: string; payrollMonth: Date; businessDate: Date; status: HrPayrollRunStatus; employeeCount: number; grossAmount: Prisma.Decimal; advanceSettlementAmount: Prisma.Decimal; administrativeDeductionAmount: Prisma.Decimal; netPayableAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; notes: string | null; accrualJournalEntryId: string | null }) { return { id: run.id, runNumber: run.runNumber, payrollMonth: ymd(run.payrollMonth), businessDate: ymd(run.businessDate), status: run.status, employeeCount: run.employeeCount, grossAmount: fixed(run.grossAmount), advanceSettlementAmount: fixed(run.advanceSettlementAmount), administrativeDeductionAmount: fixed(run.administrativeDeductionAmount), netPayableAmount: fixed(run.netPayableAmount), paidAmount: fixed(run.paidAmount), notes: run.notes, accrualJournalEntryId: run.accrualJournalEntryId }; }
