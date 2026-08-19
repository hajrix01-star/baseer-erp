import { strict as assert } from 'node:assert';

import { aggregateDailyBalanceChanges } from '../finance/journal/journal-posting.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { hrAdministrativeDeductionLockKey, hrEmployeeAdvanceLockKey, hrPayrollRunLockKey } from './hr-financial-lock.util.js';

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

console.log('HR financial concurrency and repeated-account daily-balance verification passed.');
