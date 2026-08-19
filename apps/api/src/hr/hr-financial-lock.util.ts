export function hrPayrollRunLockKey(tenantId: string, companyId: string, payrollRunId: string) {
  return `${tenantId}:${companyId}:hr-payroll-run:${payrollRunId}`;
}

export function hrEmployeeAdvanceLockKey(tenantId: string, companyId: string, advanceId: string) {
  return `${tenantId}:${companyId}:hr-employee-advance:${advanceId}`;
}

export function hrAdministrativeDeductionLockKey(tenantId: string, companyId: string, deductionId: string) {
  return `${tenantId}:${companyId}:hr-employee-administrative-deduction:${deductionId}`;
}
