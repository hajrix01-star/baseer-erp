import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { FinanceCashPerformanceDirection, FinanceCashPerformanceEventKind, Prisma } from '../generated/prisma/client.js';
import { aggregateCashPerformanceEvents, aggregateFinancialMovements, percentOfSales, type VaultMovement } from './personal-cash-performance-report.service.js';

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
const vaultId = randomUUID();
const movement = (group: VaultMovement['group'], amount: string, sourceLabelAr = 'اختبار', categoryPath: VaultMovement['categoryPath'] = null): VaultMovement => ({
  id: randomUUID(), journalEntryId: randomUUID(), businessDate: new Date('2026-08-20T00:00:00.000Z'),
  vaultId, vaultNameAr: 'نقد', vaultNameEn: 'Cash', group, sourceType: 'test_source',
  direction: new Prisma.Decimal(amount).gte(0) ? FinanceCashPerformanceDirection.INFLOW : FinanceCashPerformanceDirection.OUTFLOW,
  amount: new Prisma.Decimal(amount), sourceLabelAr, sourceLabelEn: 'Test', sourceReference: 'TEST',
  categoryPath,
  requiresVatEvidence: false, vatBreakdownKnown: true,
});
const actualMovements = aggregateFinancialMovements([
  movement('sales', '10780'), movement('purchases', '-115'), movement('expenses', '-57.5'),
  movement('employee_payments', '-800', 'صرف سلفة موظف'), movement('employee_payments', '-4200', 'دفع رواتب'), movement('vat', '-7.5'),
]);
assert.equal(actualMovements.inflows.toFixed(4), '10780.0000');
assert.equal(actualMovements.outflows.toFixed(4), '-5180.0000');
assert.equal(actualMovements.netCashResult.toFixed(4), '5600.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'employee_payments')?.amount.toFixed(4), '-5000.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'employee_payments:advance_issue')?.amount.toFixed(4), '-800.0000');
assert.equal(actualMovements.rows.find((row) => row.code === 'employee_payments:payroll')?.amount.toFixed(4), '-4200.0000');
assert.equal(percentOfSales(new Prisma.Decimal('-1025'), new Prisma.Decimal('10780')), '9.5083');
assert.equal(percentOfSales(new Prisma.Decimal('6400'), new Prisma.Decimal('10780')), '59.3692');
assert.equal(percentOfSales(new Prisma.Decimal('1'), new Prisma.Decimal('0')), null);

const categoryHierarchy = aggregateFinancialMovements([
  movement('purchases', '-115', 'فاتورة مشتريات', {
    parent: { code: 'food', labelAr: 'مواد غذائية', labelEn: 'Food' },
    leaf: { code: 'meat', labelAr: 'لحوم', labelEn: 'Meat' },
  }),
]);
assert.equal(categoryHierarchy.rows.find((row) => row.code === 'purchases:category:food')?.amount.toFixed(4), '-115.0000');
assert.equal(categoryHierarchy.rows.find((row) => row.code === 'purchases:category:food:item:meat')?.amount.toFixed(4), '-115.0000');

console.log('financial profit-and-loss report policy verification passed');
