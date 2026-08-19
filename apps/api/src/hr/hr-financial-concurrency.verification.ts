import { strict as assert } from 'node:assert';

import { aggregateDailyBalanceChanges } from '../finance/journal/journal-posting.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { isHrDateOnOrAfter, isSameHrBusinessMonth, latestHrBusinessDate } from './hr-financial-date.util.js';
import { hrAdministrativeDeductionLockKey, hrEmployeeAdvanceLockKey, hrPayrollRunLockKey } from './hr-financial-lock.util.js';
import { hrPaymentPostingProjection, latestHrPaymentEventDate } from './hr-payment-history.util.js';

const payrollKey = hrPayrollRunLockKey('tenant-a', 'company-a', 'payroll-a');
assert.equal(payrollKey, 'tenant-a:company-a:hr-payroll-run:payroll-a');
assert.notEqual(payrollKey, hrPayrollRunLockKey('tenant-a', 'company-a', 'payroll-b'));
assert.notEqual(payrollKey, hrPayrollRunLockKey('tenant-a', 'company-b', 'payroll-a'));

const advanceKey = hrEmployeeAdvanceLockKey('tenant-a', 'company-a', 'advance-a');
assert.equal(advanceKey, 'tenant-a:company-a:hr-employee-advance:advance-a');
assert.notEqual(advanceKey, hrEmployeeAdvanceLockKey('tenant-a', 'company-a', 'advance-b'));
assert.notEqual(advanceKey, hrEmployeeAdvanceLockKey('tenant-b', 'company-a', 'advance-a'));

const deductionKey = hrAdministrativeDeductionLockKey('tenant-a', 'company-a', 'deduction-a');
assert.equal(deductionKey, 'tenant-a:company-a:hr-employee-administrative-deduction:deduction-a');
assert.notEqual(deductionKey, hrAdministrativeDeductionLockKey('tenant-a', 'company-a', 'deduction-b'));

const changes = aggregateDailyBalanceChanges([
  { accountId: 'recovery', debitAmount: new Prisma.Decimal(0), creditAmount: new Prisma.Decimal(10) },
  { accountId: 'recovery', debitAmount: new Prisma.Decimal(0), creditAmount: new Prisma.Decimal(20) },
  { accountId: 'expense', debitAmount: new Prisma.Decimal(30), creditAmount: new Prisma.Decimal(0) },
], -1);

assert.equal(changes.get('recovery')?.debitAmount.toFixed(4), '0.0000');
assert.equal(changes.get('recovery')?.creditAmount.toFixed(4), '-30.0000');
assert.equal(changes.get('expense')?.debitAmount.toFixed(4), '-30.0000');
assert.equal(changes.get('expense')?.creditAmount.toFixed(4), '0.0000');

const issued = new Date('2026-08-10T00:00:00.000Z');
const settled = new Date('2026-08-11T00:00:00.000Z');
assert.equal(isHrDateOnOrAfter(settled, issued), true);
assert.equal(isHrDateOnOrAfter(issued, settled), false);
assert.equal(isHrDateOnOrAfter(issued, issued), true);
assert.equal(latestHrBusinessDate(null, issued, settled)?.toISOString(), settled.toISOString());
assert.equal(latestHrBusinessDate(undefined, null), null);
assert.equal(isSameHrBusinessMonth(new Date('2026-08-31T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')), true);
assert.equal(isSameHrBusinessMonth(new Date('2026-09-01T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')), false);

const postedAt = new Date('2026-08-14T09:15:00.000Z');
assert.deepEqual(hrPaymentPostingProjection(null), { status: 'POSTED', reversedAt: null, reversalJournalEntryId: null });
assert.deepEqual(hrPaymentPostingProjection({ id: 'reversal-journal', postedAt }), { status: 'REVERSED', reversedAt: postedAt.toISOString(), reversalJournalEntryId: 'reversal-journal' });
assert.equal(latestHrPaymentEventDate([
  { businessDate: new Date('2026-08-11T00:00:00.000Z'), journalEntry: { reversalEntry: { businessDate: new Date('2026-08-13T00:00:00.000Z') } } },
  { businessDate: new Date('2026-08-12T00:00:00.000Z'), journalEntry: { reversalEntry: null } },
])?.toISOString(), '2026-08-13T00:00:00.000Z');
assert.equal(latestHrPaymentEventDate([]), null);

console.log('HR financial locking, chronology, payment-history projection, and repeated-account daily-balance verification passed.');
