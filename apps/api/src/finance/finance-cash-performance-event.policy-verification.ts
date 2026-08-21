import { FinanceCashPerformanceDirection, Prisma } from '../generated/prisma/client.js';
import { signedCashPerformanceAmount } from './finance-cash-performance-event.service.js';

const amount = new Prisma.Decimal('115.0000');
if (!signedCashPerformanceAmount(FinanceCashPerformanceDirection.INFLOW, amount).equals('115.0000')) {
  throw new Error('An inflow must retain its positive cash-performance sign.');
}
if (!signedCashPerformanceAmount(FinanceCashPerformanceDirection.OUTFLOW, amount).equals('-115.0000')) {
  throw new Error('An outflow (including a VAT payment) must be included once as a negative event.');
}

console.log('Personal cash-performance event policy verification passed.');
