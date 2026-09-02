import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { personalCashPerformanceLiveEvidenceReceiptSchema } from '@baseer-erp/contracts';
import { financialMovementSemantic } from '../finance/financial-movement-classification.js';
import { FinanceCashPerformanceDirection, FinanceCashPerformanceEventKind, Prisma } from '../generated/prisma/client.js';
import { aggregateCashPerformanceEvents, aggregateFinancialMovements, aggregateOperatingCosts, movementMatchesRow, percentOfSales, presentationMetrics, reclassifySameMonthPayrollAdvances, type VaultMovement } from './personal-cash-performance-report.service.js';

const event = (kind: FinanceCashPerformanceEventKind, direction: FinanceCashPerformanceDirection, gross: string, net: string, vatBreakdownKnown = true, settlementDestinationsJson: Prisma.JsonValue | null = null) => ({
  id: randomUUID(), kind, direction,
  grossAmount: new Prisma.Decimal(gross), netAmount: new Prisma.Decimal(net), vatBreakdownKnown,
  categoryCodeSnapshot: null, categoryNameArSnapshot: null, categoryNameEnSnapshot: null,
  settlementDestinationsJson,
});

// 230 collected gross sale - 115 paid gross purchase - 15 VAT settlement = 100.
const gross = aggregateCashPerformanceEvents([
  event(FinanceCashPerformanceEventKind.SALES_COLLECTION, FinanceCashPerformanceDirection.INFLOW, '230', '200'),
  event(FinanceCashPerformanceEventKind.PURCHASE_PAYMENT, FinanceCashPerformanceDirection.OUTFLOW, '115', '100'),
  event(FinanceCashPerformanceEventKind.VAT_PAYMENT, FinanceCashPerformanceDirection.OUTFLOW, '15', '15'),
], true);
assert.equal(gross.netCashResult.toFixed(4), '100.0000');
assert.equal(gross.rows.find((row) => row.code === 'vat_payment')?.amount.toFixed(4), '-15.0000');
assert.equal(gross.rows.find((row) => row.code === 'purchases')?.amount.toFixed(4), '-115.0000');
assert.equal(gross.rows.find((row) => row.code === 'purchases:uncategorized')?.parentCode, 'purchases');
assert.equal(gross.salesCollections.toFixed(4), '230.0000');

const channelId = randomUUID();
const byChannel = aggregateCashPerformanceEvents([
  event(FinanceCashPerformanceEventKind.SALES_COLLECTION, FinanceCashPerformanceDirection.INFLOW, '230', '200', true, [{ vaultId: channelId, paymentMethod: 'CASH', amount: '230.0000' }]),
], true, new Map([[channelId, { nameAr: 'نقد', nameEn: 'Cash' }]]));
assert.equal(byChannel.rows.find((row) => row.code === `sales:destination:${channelId}`)?.parentCode, 'sales_collections');
assert.equal(byChannel.rows.find((row) => row.code === `sales:destination:${channelId}`)?.amount.toFixed(4), '230.0000');

// Net mode deliberately excludes the VAT settlement and uses invoice net amounts.
const net = aggregateCashPerformanceEvents([
  event(FinanceCashPerformanceEventKind.SALES_COLLECTION, FinanceCashPerformanceDirection.INFLOW, '230', '200'),
  event(FinanceCashPerformanceEventKind.PURCHASE_PAYMENT, FinanceCashPerformanceDirection.OUTFLOW, '115', '100'),
  event(FinanceCashPerformanceEventKind.VAT_PAYMENT, FinanceCashPerformanceDirection.OUTFLOW, '15', '15'),
], false);
assert.equal(net.netCashResult.toFixed(4), '100.0000');
assert.equal(net.rows.some((row) => row.code === 'vat_payment'), false);

// A later cancellation uses an opposite event; it reduces, rather than rewrites,
// the selected range's result when both rows fall in the range.
const cancelled = aggregateCashPerformanceEvents([
  event(FinanceCashPerformanceEventKind.SALES_COLLECTION, FinanceCashPerformanceDirection.INFLOW, '230', '200'),
  event(FinanceCashPerformanceEventKind.SALES_COLLECTION, FinanceCashPerformanceDirection.OUTFLOW, '230', '200'),
], true);
assert.equal(cancelled.netCashResult.toFixed(4), '0.0000');

// The final report source is vault journal lines: an advance is a real
// outflow, payroll payment is a separate real outflow, while their payroll
// settlement has no vault line and cannot be counted twice.
const payrollAccrualSemantic = financialMovementSemantic('hr_payroll_accrual');
assert.ok(payrollAccrualSemantic);
assert.deepEqual(payrollAccrualSemantic, {
  kind: 'PAYROLL', categoryCode: 'E4-1', parentCategoryCode: 'EXP-004',
  labelAr: 'رواتب وأجور', labelEn: 'Salaries and wages', cashGroup: 'payroll', ownerDashboardCode: 'PAYROLL',
  registerOperationClass: 'PAYROLL_ACCRUAL',
  economicEffects: ['PAYROLL_EXPENSE_RECOGNITION'],
  cashEffect: 'NONE', settlementEffect: 'PAYROLL_PAYABLE_WITH_OPTIONAL_EMPLOYEE_ADVANCE', isAccrual: true, isSettlement: false,
});
const payrollPaymentSemantic = financialMovementSemantic('hr_payroll_payment');
assert.ok(payrollPaymentSemantic);
assert.equal(payrollPaymentSemantic.categoryCode, 'E4-1');
assert.equal(payrollPaymentSemantic.registerOperationClass, 'PAYROLL_PAYMENT');
assert.deepEqual(payrollPaymentSemantic.economicEffects, []);
assert.equal(payrollPaymentSemantic.cashEffect, 'OUTFLOW');
assert.equal(payrollPaymentSemantic.settlementEffect, 'PAYROLL_PAYABLE');
const advanceIssueSemantic = financialMovementSemantic('hr_employee_advance');
assert.ok(advanceIssueSemantic);
assert.equal(advanceIssueSemantic.categoryCode, 'ADV-001');
assert.equal(advanceIssueSemantic.parentCategoryCode, null);
assert.equal(advanceIssueSemantic.cashEffect, 'OUTFLOW');
assert.equal(advanceIssueSemantic.settlementEffect, 'NONE');
assert.deepEqual(advanceIssueSemantic.economicEffects, ['EMPLOYEE_ADVANCE_ASSET_INCREASE']);
const advanceReceiptSemantic = financialMovementSemantic('hr_employee_advance_receipt');
assert.ok(advanceReceiptSemantic);
assert.equal(advanceReceiptSemantic.categoryCode, 'ADV-001');
assert.equal(advanceReceiptSemantic.registerOperationClass, 'EMPLOYEE_ADVANCE_SETTLEMENT');
assert.equal(advanceReceiptSemantic.cashEffect, 'INFLOW');
assert.equal(advanceReceiptSemantic.settlementEffect, 'EMPLOYEE_ADVANCE');
const historicalAdvanceSettlementSemantic = financialMovementSemantic('nurix_historical_employee_advance_settlement');
assert.ok(historicalAdvanceSettlementSemantic);
assert.equal(historicalAdvanceSettlementSemantic.cashEffect, 'NONE');
assert.deepEqual(historicalAdvanceSettlementSemantic.economicEffects, ['PAYROLL_EXPENSE_RECOGNITION', 'EMPLOYEE_ADVANCE_ASSET_DECREASE']);
const directHistoricalPayrollSemantic = financialMovementSemantic('nurix_al_shami_historical_paid_payroll');
assert.ok(directHistoricalPayrollSemantic);
assert.equal(directHistoricalPayrollSemantic.cashEffect, 'OUTFLOW');
assert.equal(directHistoricalPayrollSemantic.settlementEffect, 'NONE');
assert.deepEqual(directHistoricalPayrollSemantic.economicEffects, ['PAYROLL_EXPENSE_RECOGNITION']);
assert.equal(financialMovementSemantic('finance_vat_settlement'), null);

const vaultId = randomUUID();
const movement = (group: VaultMovement['group'], amount: string, sourceLabelAr = 'اختبار', categoryPath: VaultMovement['categoryPath'] = null): VaultMovement => ({
  id: randomUUID(), journalEntryId: randomUUID(), businessDate: new Date('2026-08-20T00:00:00.000Z'),
  vaultId, vaultNameAr: 'نقد', vaultNameEn: 'Cash', group, sourceType: 'test_source',
  direction: new Prisma.Decimal(amount).gte(0) ? FinanceCashPerformanceDirection.INFLOW : FinanceCashPerformanceDirection.OUTFLOW,
  amount: new Prisma.Decimal(amount), grossVatInclusiveAmount: new Prisma.Decimal(amount), netVatExclusiveAmount: new Prisma.Decimal(amount),
  sourceLabelAr, sourceLabelEn: 'Test', sourceReference: 'TEST',
  categoryPath,
  requiresVatEvidence: false, vatBreakdownKnown: true,
});
const actualMovements = aggregateFinancialMovements([
  movement('sales', '10780'), movement('purchases', '-115'), movement('expenses', '-57.5'),
  movement('employee_advances', '-800', 'صرف سلفة موظف', {
    parent: null,
    leaf: { code: 'ADV-001', labelAr: 'سلف الموظفين', labelEn: 'Employee advances' },
  }),
  movement('payroll', '-4200', 'دفع رواتب'), movement('vat', '-7.5'),
]);
assert.equal(actualMovements.inflows.toFixed(4), '10780.0000');
assert.equal(actualMovements.outflows.toFixed(4), '-5180.0000');
assert.equal(actualMovements.netCashResult.toFixed(4), '5600.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'employee_advances')?.amount.toFixed(4), '-800.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'employee_advances:category:ADV-001')?.amount.toFixed(4), '-800.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'employee_advances:category:ADV-001:advance_issue')?.amount.toFixed(4), '-800.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'payroll')?.amount.toFixed(4), '-4200.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'payroll:wages')?.amount.toFixed(4), '-4200.0000');

// A same-month payroll deduction presents the recovered advance as part of
// wages. This preserves the actual vault total (200 + 5,800 = 6,000) without
// leaving the same cash outflow duplicated under employee advances.
const fullyRecoveredAdvanceId = randomUUID();
const payrollCategory = { parent: { code: 'EXP-004', labelAr: 'رواتب وخدمات الموظفين', labelEn: 'Employee salaries and benefits' }, leaf: { code: 'E4-1', labelAr: 'رواتب وأجور', labelEn: 'Salaries and wages' } };
const sameMonthPayroll = reclassifySameMonthPayrollAdvances([
  { ...movement('employee_advances', '-200', 'سلفة خصمت من المسير'), advanceId: fullyRecoveredAdvanceId },
  movement('payroll', '-5800', 'دفع صافي المسير'),
], new Map([[fullyRecoveredAdvanceId, new Prisma.Decimal('200')]]), payrollCategory);
const sameMonthPayrollRead = aggregateFinancialMovements(sameMonthPayroll);
assert.equal(sameMonthPayrollRead.rows.find((row) => row.code === 'payroll')?.amount.toFixed(4), '-6000.0000');
assert.equal(sameMonthPayrollRead.rows.some((row) => row.code === 'employee_advances'), false);
assert.equal(aggregateOperatingCosts(sameMonthPayroll, new Prisma.Decimal('2000')).groups.find((group) => group.code === 'payroll')?.amount.raw, '6000.0000');

// A partial deduction is not silently turned into salary. Only its recovered
// portion joins payroll; the outstanding amount remains an employee advance.
const partiallyRecoveredAdvanceId = randomUUID();
const partialPayroll = reclassifySameMonthPayrollAdvances([
  { ...movement('employee_advances', '-5000', 'سلفة باقٍ منها رصيد'), advanceId: partiallyRecoveredAdvanceId },
], new Map([[partiallyRecoveredAdvanceId, new Prisma.Decimal('1000')]]), payrollCategory);
const partialPayrollRead = aggregateFinancialMovements(partialPayroll);
assert.equal(partialPayrollRead.rows.find((row) => row.code === 'payroll')?.amount.toFixed(4), '-1000.0000');
assert.equal(partialPayrollRead.rows.find((row) => row.code === 'employee_advances')?.amount.toFixed(4), '-4000.0000');
assert.equal(percentOfSales(new Prisma.Decimal('-1025'), new Prisma.Decimal('10780')), '9.5083');
assert.equal(percentOfSales(new Prisma.Decimal('6400'), new Prisma.Decimal('10780')), '59.3692');
assert.equal(percentOfSales(new Prisma.Decimal('1'), new Prisma.Decimal('0')), null);
const presentation = presentationMetrics(actualMovements.rows, new Prisma.Decimal('10780'));
assert.deepEqual(presentation.get('sales'), {
  rankWithinParent: 1,
  shareOfDirectionPercent: '100.0000',
  shareOfTotalOutflowPercent: null,
  shareOfParentPercent: '67.5439',
});
assert.deepEqual(presentation.get('payroll:wages'), {
  rankWithinParent: 1,
  shareOfDirectionPercent: null,
  shareOfTotalOutflowPercent: '81.0811',
  shareOfParentPercent: '100.0000',
});

const categoryHierarchy = aggregateFinancialMovements([
  movement('purchases', '-115', 'فاتورة مشتريات', {
    parent: { code: 'food', labelAr: 'مواد غذائية', labelEn: 'Food' },
    leaf: { code: 'meat', labelAr: 'لحوم', labelEn: 'Meat' },
  }),
]);
assert.equal(categoryHierarchy.rows.find((row) => row.code === 'purchases:category:food')?.amount.toFixed(4), '-115.0000');
assert.equal(categoryHierarchy.rows.find((row) => row.code === 'purchases:category:food:item:meat')?.amount.toFixed(4), '-115.0000');

// Historical imports may be classified directly at the parent category while
// later entries use a child category. The parent must retain both sources.
const mixedCategoryHierarchy = aggregateFinancialMovements([
  movement('purchases', '-40', 'قيد فئة مباشرة', {
    parent: null,
    leaf: { code: 'food', labelAr: 'مواد غذائية', labelEn: 'Food' },
  }),
  movement('purchases', '-60', 'قيد فئة فرعية', {
    parent: { code: 'food', labelAr: 'مواد غذائية', labelEn: 'Food' },
    leaf: { code: 'meat', labelAr: 'لحوم', labelEn: 'Meat' },
  }),
]);
assert.equal(mixedCategoryHierarchy.rows.find((row) => row.code === 'purchases')?.amount.toFixed(4), '-100.0000');
assert.equal(mixedCategoryHierarchy.rows.find((row) => row.code === 'purchases:category:food')?.amount.toFixed(4), '-100.0000');
assert.equal(mixedCategoryHierarchy.rows.find((row) => row.code === 'purchases:category:food')?.eventCount, 2);
assert.equal(mixedCategoryHierarchy.rows.find((row) => row.code === 'purchases:category:food:item:meat')?.amount.toFixed(4), '-60.0000');

// The operating-cost receipt is deliberately flat. It uses each sealed vault
// movement once, so its total cannot add a section and its category children
// together. Paid payroll is an operating cost; advances, VAT and generic
// outflows stay outside operating costs.
const operatingCosts = aggregateOperatingCosts([
  movement('purchases', '-100', 'فاتورة مشتريات', {
    parent: { code: 'food', labelAr: 'مواد غذائية', labelEn: 'Food' },
    leaf: { code: 'meat', labelAr: 'لحوم', labelEn: 'Meat' },
  }),
  movement('purchases', '-50', 'فاتورة مشتريات', {
    parent: { code: 'food', labelAr: 'مواد غذائية', labelEn: 'Food' },
    leaf: { code: 'fish', labelAr: 'أسماك', labelEn: 'Fish' },
  }),
  movement('recurring_expenses', '-30', 'إيجار'),
  movement('expenses', '-20', 'صيانة'),
  movement('payroll', '-800', 'دفع رواتب'),
  movement('vat', '-15', 'ضريبة'),
  movement('other_outflows', '-10', 'حركة أخرى'),
], new Prisma.Decimal('1000'));
assert.equal(operatingCosts.basisLabelAr, 'الحركات المالية المثبتة');
assert.equal(operatingCosts.total.raw, '1000.0000');
assert.deepEqual(operatingCosts.evidence, { reportCode: 'personal_cash_performance', metric: { kind: 'CASH_ROW', rowCode: 'operating_costs' } });
assert.equal(operatingCosts.shareOfCollectedSalesPercent, '100.0000');
assert.deepEqual(operatingCosts.groups.map((group) => group.code), ['purchases', 'recurring_expenses', 'expenses', 'payroll']);
assert.equal(operatingCosts.groups[0]?.amount.raw, '150.0000');
assert.equal(operatingCosts.groups[0]?.eventCount, 2);
assert.equal(operatingCosts.groups[0]?.rows.length, 1);
assert.deepEqual(operatingCosts.groups[0]?.rows[0], {
  code: 'purchases:category:food', evidenceRowCode: 'purchases:category:food', labelAr: 'مواد غذائية', labelEn: 'Food',
  amount: { raw: '150.0000', display: '150.00', sign: 'positive' },
  evidence: { reportCode: 'personal_cash_performance', metric: { kind: 'CASH_ROW', rowCode: 'purchases:category:food' } },
  eventCount: 2, shareOfParentPercent: '100.0000',
});
assert.equal(operatingCosts.groups[1]?.amount.raw, '30.0000');
assert.equal(operatingCosts.groups[2]?.amount.raw, '20.0000');
assert.equal(operatingCosts.groups[2]?.shareOfCollectedSalesPercent, '2.0000');
assert.equal(operatingCosts.groups[3]?.amount.raw, '800.0000');
const evidenceCategoryMovement = movement('purchases', '-100', 'فاتورة مشتريات', {
  parent: { code: 'food', labelAr: 'مواد غذائية', labelEn: 'Food' },
  leaf: { code: 'meat', labelAr: 'لحوم', labelEn: 'Meat' },
});
assert.equal(movementMatchesRow(evidenceCategoryMovement, operatingCosts.groups[0]?.rows[0]?.evidenceRowCode ?? ''), true);
assert.equal(movementMatchesRow(movement('expenses', '-20'), 'expenses:uncategorized'), true);
assert.equal(movementMatchesRow(movement('sales', '20'), 'cash:inflows'), true);
assert.equal(movementMatchesRow(movement('sales', '20'), 'cash:outflows'), false);
assert.equal(movementMatchesRow(movement('expenses', '-20'), 'cash:outflows'), true);

// Operational routes are page-registry hashes. The live evidence contract
// must accept them (and the prior section hash) or a valid source row turns
// into a server-side 500 after the financial query has completed.
const receiptWithCurrentPageRoute = {
  rowCode: 'expenses:category:EXP-003', nextCursor: null,
  items: [{
    eventId: randomUUID(), businessDate: '2026-08-20', direction: 'OUTFLOW' as const,
    amount: { raw: '-3500.0000', display: '3500.00', sign: 'negative' as const },
    source: {
      journalEntryId: randomUUID(), labelAr: 'فاتورة مشتريات أو مصروف', labelEn: 'Purchase or expense invoice', reference: 'EXP-001',
      counterparty: { labelAr: 'مورد تجريبي', labelEn: 'Test supplier' },
      origin: { labelAr: 'العمليات ← المشتريات', labelEn: 'Operations → Purchasing', route: '#module=operations&page=operations-purchases' },
    },
  }],
};
assert.equal(personalCashPerformanceLiveEvidenceReceiptSchema.safeParse(receiptWithCurrentPageRoute).success, true);
const [currentEvidenceItem] = receiptWithCurrentPageRoute.items;
assert.ok(currentEvidenceItem);
assert.equal(personalCashPerformanceLiveEvidenceReceiptSchema.safeParse({ ...receiptWithCurrentPageRoute, items: [{ ...currentEvidenceItem, source: { ...currentEvidenceItem.source, origin: { ...currentEvidenceItem.source.origin, route: '#module=finance&section=3' } } }] }).success, true);
assert.equal(personalCashPerformanceLiveEvidenceReceiptSchema.safeParse({ ...receiptWithCurrentPageRoute, items: [{ ...currentEvidenceItem, source: { ...currentEvidenceItem.source, origin: { ...currentEvidenceItem.source.origin, route: '#module=operations&page=../../unsafe' } } }] }).success, false);

console.log('Actual cash movement report policy verification passed');
