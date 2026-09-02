/**
 * One semantic classification for non-invoice financial movements.
 *
 * Amount recognition stays with the sealed journal/vault ledger. This module
 * only answers what a source represents, so the register and cash reports do
 * not invent different labels for the same movement.
 */
export const FINANCIAL_MOVEMENT_SOURCE_TOKENS = Object.freeze({
  payroll: 'payroll',
  accrual: 'accrual',
  advance: 'advance',
  receipt: 'receipt',
  settlement: 'settlement',
});

export type FinancialMovementEconomicEffect =
  | 'PAYROLL_EXPENSE_RECOGNITION'
  | 'EMPLOYEE_ADVANCE_ASSET_INCREASE'
  | 'EMPLOYEE_ADVANCE_ASSET_DECREASE';

export type FinancialMovementSemantic = Readonly<{
  kind: 'PAYROLL' | 'EMPLOYEE_ADVANCE';
  /** Canonical reporting classification. It is never nullable for a known movement. */
  categoryCode: string;
  parentCategoryCode: string | null;
  labelAr: string;
  labelEn: string;
  cashGroup: 'payroll' | 'employee_advances';
  ownerDashboardCode: 'PAYROLL' | 'EMPLOYEE_ADVANCES';
  registerOperationClass: 'PAYROLL_ACCRUAL' | 'PAYROLL_PAYMENT' | 'EMPLOYEE_ADVANCE' | 'EMPLOYEE_ADVANCE_SETTLEMENT';
  economicEffects: readonly FinancialMovementEconomicEffect[];
  cashEffect: 'NONE' | 'INFLOW' | 'OUTFLOW';
  settlementEffect: 'NONE' | 'PAYROLL_PAYABLE' | 'EMPLOYEE_ADVANCE' | 'PAYROLL_PAYABLE_WITH_OPTIONAL_EMPLOYEE_ADVANCE';
  isAccrual: boolean;
  isSettlement: boolean;
}>;

const PAYROLL_CATEGORY = Object.freeze({
  kind: 'PAYROLL' as const,
  categoryCode: 'E4-1',
  parentCategoryCode: 'EXP-004',
  labelAr: 'رواتب وأجور',
  labelEn: 'Salaries and wages',
  cashGroup: 'payroll' as const,
  ownerDashboardCode: 'PAYROLL' as const,
});

const ADVANCE_CATEGORY = Object.freeze({
  kind: 'EMPLOYEE_ADVANCE' as const,
  // ADV-001 is an asset account rather than an operating-expense category.
  // Keeping its canonical code here prevents cash reports and the unified
  // register from treating a known advance as an unclassified expense.
  categoryCode: 'ADV-001',
  parentCategoryCode: null,
  labelAr: 'سلف الموظفين',
  labelEn: 'Employee advances',
  cashGroup: 'employee_advances' as const,
  ownerDashboardCode: 'EMPLOYEE_ADVANCES' as const,
});

export function financialMovementSemantic(sourceType: string): FinancialMovementSemantic | null {
  const source = sourceType.trim().toLowerCase();
  if (source.includes(FINANCIAL_MOVEMENT_SOURCE_TOKENS.payroll)) {
    const isAccrual = source.includes(FINANCIAL_MOVEMENT_SOURCE_TOKENS.accrual);
    const isDirectHistoricalExpensePayment = source === 'nurix_al_shami_historical_paid_payroll';
    return {
      ...PAYROLL_CATEGORY,
      registerOperationClass: isAccrual ? 'PAYROLL_ACCRUAL' : 'PAYROLL_PAYMENT',
      economicEffects: isAccrual
        ? ['PAYROLL_EXPENSE_RECOGNITION']
        : isDirectHistoricalExpensePayment
          ? ['PAYROLL_EXPENSE_RECOGNITION']
          : [],
      cashEffect: isAccrual ? 'NONE' : 'OUTFLOW',
      settlementEffect: isAccrual
        ? 'PAYROLL_PAYABLE_WITH_OPTIONAL_EMPLOYEE_ADVANCE'
        : isDirectHistoricalExpensePayment
          ? 'NONE'
          : 'PAYROLL_PAYABLE',
      isAccrual,
      isSettlement: !isAccrual,
    };
  }
  if (source.includes(`employee_${FINANCIAL_MOVEMENT_SOURCE_TOKENS.advance}`) || source.includes(`historical_${FINANCIAL_MOVEMENT_SOURCE_TOKENS.advance}`)) {
    const isReceipt = source.includes(FINANCIAL_MOVEMENT_SOURCE_TOKENS.receipt);
    const isSettlement = isReceipt || source.includes(FINANCIAL_MOVEMENT_SOURCE_TOKENS.settlement);
    const isHistoricalPayrollSettlement = source === 'nurix_historical_employee_advance_settlement';
    return {
      ...ADVANCE_CATEGORY,
      registerOperationClass: isSettlement ? 'EMPLOYEE_ADVANCE_SETTLEMENT' : 'EMPLOYEE_ADVANCE',
      economicEffects: isSettlement
        ? isHistoricalPayrollSettlement
          ? ['PAYROLL_EXPENSE_RECOGNITION', 'EMPLOYEE_ADVANCE_ASSET_DECREASE']
          : ['EMPLOYEE_ADVANCE_ASSET_DECREASE']
        : ['EMPLOYEE_ADVANCE_ASSET_INCREASE'],
      cashEffect: isReceipt ? 'INFLOW' : isSettlement ? 'NONE' : 'OUTFLOW',
      settlementEffect: isSettlement ? 'EMPLOYEE_ADVANCE' : 'NONE',
      isAccrual: false,
      isSettlement,
    };
  }
  return null;
}
