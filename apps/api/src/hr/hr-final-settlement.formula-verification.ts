import { strict as assert } from 'node:assert';

import { HrFinalSettlementReason, Prisma } from '../generated/prisma/client.js';
import { calculateEosFormula, eosEntitlementFactor } from './hr-final-settlement.service.js';

const date = (value: string) => new Date(value + 'T00:00:00.000Z');
const wage = new Prisma.Decimal('3000');

// Boundary checks deliberately use 365-day years: the production formula uses
// actual service days / 365, not a browser locale date calculation.
assert.equal(eosEntitlementFactor(HrFinalSettlementReason.RESIGNATION, new Prisma.Decimal(2)).toFixed(8), '0.33333333');
assert.equal(eosEntitlementFactor(HrFinalSettlementReason.RESIGNATION, new Prisma.Decimal(5)).toFixed(8), '0.33333333');
assert.equal(eosEntitlementFactor(HrFinalSettlementReason.RESIGNATION, new Prisma.Decimal(10)).toFixed(8), '1.00000000');
assert.equal(calculateEosFormula(date('2024-02-28'), date('2024-03-01'), wage, HrFinalSettlementReason.EMPLOYER_TERMINATION).serviceDays, 2);
assert.equal(calculateEosFormula(date('2020-01-01'), date('2026-01-01'), wage, HrFinalSettlementReason.ARTICLE_80).eosAmount.toFixed(4), '0.0000');

// A non-Article-80 termination preserves the full formula; resignation uses
// the statutory fraction rather than a payroll/advance deduction.
const resignation = calculateEosFormula(date('2020-01-01'), date('2026-01-01'), wage, HrFinalSettlementReason.RESIGNATION);
assert.equal(resignation.entitlementFactor.toFixed(8), '0.66666667');
assert.ok(resignation.eosAmount.gt(0));

console.log('HR final-settlement EOS V1 formula verification passed.');
