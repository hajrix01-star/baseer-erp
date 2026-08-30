import { Injectable } from '@nestjs/common';

import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  HrEmployeeAdministrativeDeductionStatus,
  HrEmployeeAdvanceStatus,
  HrEmployeeLeaveStatus,
  HrEmployeeServiceComplianceStatus,
  HrEmployeeServiceStatus,
  HrEmployeeStatus,
  HrFinalSettlementStatus,
  HrPayrollRunStatus,
  type Prisma,
} from '../generated/prisma/client.js';

export const HR_OVERVIEW_CAPABILITIES = [
  'hr.employees.read',
  'hr.advances.read',
  'hr.deductions.read',
  'hr.leaves.read',
  'hr.payroll.read',
  'hr.final_settlements.read',
] as const;

const OPEN_ADVANCE_STATUSES = [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] as const;
const OPEN_DEDUCTION_STATUSES = [HrEmployeeAdministrativeDeductionStatus.OPEN, HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED, HrEmployeeAdministrativeDeductionStatus.DEFERRED] as const;
const PAYROLL_AWAITING_PAYMENT_STATUSES = [HrPayrollRunStatus.APPROVED, HrPayrollRunStatus.PARTIALLY_PAID] as const;
const OPEN_FINAL_SETTLEMENT_STATUSES = [HrFinalSettlementStatus.DRAFT, HrFinalSettlementStatus.APPROVED, HrFinalSettlementStatus.PARTIALLY_PAID] as const;

@Injectable()
export class HrOverviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly businessDates: BusinessDateService,
  ) {}

  async overview(context: TrustedCompanyActorContext, grantedCapabilities: readonly string[]) {
    const granted = new Set(grantedCapabilities);
    const can = (capability: (typeof HR_OVERVIEW_CAPABILITIES)[number]) => granted.has(capability);

    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const dateResolution = await this.businessDates.resolveInTransaction(tx, context, { kind: 'current' });
      const businessDate = new Date(`${dateResolution.businessDate}T00:00:00.000Z`);
      const expiryCutoff = new Date(businessDate);
      expiryCutoff.setUTCDate(expiryCutoff.getUTCDate() + 30);
      const scope = { tenantId: context.tenantId, companyId: context.companyId } as const;

      // The overview is a composed read model. One unavailable optional HR
      // feature (for example, a settlement table pending deployment) must not
      // hide every otherwise-readable operational metric.
      const safely = async <T>(read: () => Promise<T>): Promise<T | null> => {
        try { return await read(); } catch { return null; }
      };
      const [workforce, financial, payroll, services, leaves, finalSettlements] = await Promise.all([
        can('hr.employees.read') ? safely(() => this.workforce(tx, scope)) : null,
        can('hr.advances.read') || can('hr.deductions.read')
          ? safely(() => this.financial(tx, scope, can('hr.advances.read'), can('hr.deductions.read')))
          : null,
        can('hr.payroll.read') ? safely(() => this.payroll(tx, scope)) : null,
        can('hr.employees.read') ? safely(() => this.services(tx, scope, businessDate, expiryCutoff)) : null,
        can('hr.leaves.read') ? safely(() => this.leaves(tx, scope, businessDate)) : null,
        can('hr.final_settlements.read') ? safely(() => this.finalSettlements(tx, scope)) : null,
      ]);

      return { businessDate: dateResolution.businessDate, workforce, financial, payroll, services, leaves, finalSettlements };
    });
  }

  private async workforce(tx: Prisma.TransactionClient, scope: Scope) {
    const [activeEmployees, employeesOnLeave] = await Promise.all([
      tx.hrEmployee.count({ where: { ...scope, status: HrEmployeeStatus.ACTIVE } }),
      tx.hrEmployee.count({ where: { ...scope, status: HrEmployeeStatus.ON_LEAVE } }),
    ]);
    return { activeEmployees, employeesOnLeave };
  }

  private async financial(tx: Prisma.TransactionClient, scope: Scope, canReadAdvances: boolean, canReadDeductions: boolean) {
    const [openAdvances, openAdministrativeDeductions] = await Promise.all([
      canReadAdvances ? tx.hrEmployeeAdvance.count({ where: { ...scope, status: { in: [...OPEN_ADVANCE_STATUSES] } } }) : null,
      canReadDeductions ? tx.hrEmployeeAdministrativeDeduction.count({ where: { ...scope, status: { in: [...OPEN_DEDUCTION_STATUSES] } } }) : null,
    ]);
    return { openAdvances, openAdministrativeDeductions };
  }

  private async payroll(tx: Prisma.TransactionClient, scope: Scope) {
    const [draftCount, awaitingPaymentCount, recentRuns] = await Promise.all([
      tx.hrPayrollRun.count({ where: { ...scope, status: HrPayrollRunStatus.DRAFT } }),
      tx.hrPayrollRun.count({ where: { ...scope, status: { in: [...PAYROLL_AWAITING_PAYMENT_STATUSES] } } }),
      tx.hrPayrollRun.findMany({
        where: scope,
        orderBy: [{ payrollMonth: 'desc' }, { id: 'desc' }],
        take: 4,
        select: { id: true, runNumber: true, payrollMonth: true, status: true },
      }),
    ]);
    return { draftCount, awaitingPaymentCount, recentRuns: recentRuns.map((run) => ({ ...run, payrollMonth: ymd(run.payrollMonth) })) };
  }

  private async services(tx: Prisma.TransactionClient, scope: Scope, businessDate: Date, expiryCutoff: Date) {
    const base = { ...scope, status: HrEmployeeServiceStatus.ISSUED, complianceStatus: HrEmployeeServiceComplianceStatus.ACTIVE } as const;
    const [expiredCount, expiringCount, attentionItems] = await Promise.all([
      tx.hrEmployeeService.count({ where: { ...base, expiryDate: { lt: businessDate } } }),
      tx.hrEmployeeService.count({ where: { ...base, expiryDate: { gte: businessDate, lte: expiryCutoff } } }),
      tx.hrEmployeeService.findMany({
        where: { ...base, expiryDate: { lte: expiryCutoff } },
        orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
        take: 4,
        select: { id: true, employeeId: true, serviceType: true, expiryDate: true, employee: { select: { nameAr: true, nameEn: true } } },
      }),
    ]);
    return {
      expiredCount,
      expiringCount,
      attentionItems: attentionItems.map((item) => ({ id: item.id, employeeId: item.employeeId, employeeNameAr: item.employee.nameAr, employeeNameEn: item.employee.nameEn, serviceType: item.serviceType, expiryDate: ymd(item.expiryDate!) })),
    };
  }

  private async leaves(tx: Prisma.TransactionClient, scope: Scope, businessDate: Date) {
    const where = { ...scope, status: HrEmployeeLeaveStatus.APPROVED, startDate: { lte: businessDate } } as const;
    const [openCount, actionItems] = await Promise.all([
      tx.hrEmployeeLeave.count({ where }),
      tx.hrEmployeeLeave.findMany({
        where,
        orderBy: [{ endDate: 'asc' }, { id: 'asc' }],
        take: 4,
        select: { id: true, employeeId: true, leaveType: true, startDate: true, endDate: true, employee: { select: { nameAr: true, nameEn: true } } },
      }),
    ]);
    return {
      openCount,
      actionItems: actionItems.map((item) => ({ id: item.id, employeeId: item.employeeId, employeeNameAr: item.employee.nameAr, employeeNameEn: item.employee.nameEn, leaveType: item.leaveType, startDate: ymd(item.startDate), endDate: ymd(item.endDate) })),
    };
  }

  private async finalSettlements(tx: Prisma.TransactionClient, scope: Scope) {
    const where: Prisma.HrFinalSettlementWhereInput = {
      ...scope,
      status: { in: [...OPEN_FINAL_SETTLEMENT_STATUSES] },
    };
    const [openCount, actionItems] = await Promise.all([
      tx.hrFinalSettlement.count({ where }),
      tx.hrFinalSettlement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 4,
        select: { id: true, settlementNumber: true, terminationDate: true, status: true },
      }),
    ]);
    return { openCount, actionItems: actionItems.map((item) => ({ ...item, terminationDate: ymd(item.terminationDate) })) };
  }
}

type Scope = Readonly<{ tenantId: string; companyId: string }>;
const ymd = (value: Date) => value.toISOString().slice(0, 10);
