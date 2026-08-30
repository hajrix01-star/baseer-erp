import assert from 'node:assert/strict';

import { NurixHistoricalPayrollMigrationService, type NurixHistoricalPayrollInput } from './nurix-historical-payroll-migration.service.js';

const writer = new NurixHistoricalPayrollMigrationService();
const input: NurixHistoricalPayrollInput = {
  packageId: '27dbb3d7-e0b2-4b52-ab61-bd2c61450350',
  sourceCompanyId: 'cmnf604ka009ay8lm556wgd9c',
  runs: [{
    sourceId: 'cmnqg4yl7000433yfxwdo7fkk', runNumber: 'PR-2604-001', payrollMonth: '2026-03-01', payrollAccruedAt: '2026-04-09T13:42:17.123456+03:00', status: 'completed', totalAmount: '1000.0000', employeeCount: 1, paymentEvidenceKind: 'NONE', paymentEvidenceAmount: null, paymentEvidenceAt: null,
    items: [{ sourceId: 'item-001', employeeSourceId: 'employee-001', grossSalary: '1200.0000', allowancesAdd: '0.0000', deductions: '200.0000', advancesDeduct: '0.0000', netSalary: '1000.0000' }],
  }],
};
const plan = writer.plan(input);
assert.equal(plan.totals.runs, 1);
assert.equal(plan.totals.lines, 1);
assert.equal(plan.totals.net, '1000.0000');
assert.equal(plan.totals.financialWrites, 0);
assert.equal(plan.runs[0]?.payrollMonth, '2026-03-01');
const cappedAdvance = writer.plan({ ...input, runs: [{ ...input.runs[0]!, totalAmount: '0.0000', items: [{ ...input.runs[0]!.items[0]!, grossSalary: '100.0000', deductions: '0.0000', advancesDeduct: '150.0000', netSalary: '0.0000' }] }] });
assert.equal(cappedAdvance.runs[0]?.items[0]?.appliedAdvance, '100.0000');
assert.equal(cappedAdvance.runs[0]?.items[0]?.advanceCarryoverEvidence, '50.0000');
const paymentProof = writer.plan({ ...input, runs: [{ ...input.runs[0]!, paymentEvidenceKind: 'AMOUNT_ONLY', paymentEvidenceAmount: '1000.0000' }] });
assert.equal(paymentProof.runs[0]?.paymentEvidenceKind, 'AMOUNT_ONLY');
assert.throws(() => writer.plan({ ...input, runs: [{ ...input.runs[0]!, items: [{ ...input.runs[0]!.items[0]!, netSalary: '-1.0000' }] }] }), /(malformed|net_salary)/);
assert.throws(() => writer.plan({ ...input, runs: [{ ...input.runs[0]!, paymentEvidenceKind: 'AMOUNT_ONLY', paymentEvidenceAmount: '999.0000' }] }), /payment evidence/);
assert.throws(() => writer.plan({ ...input, runs: [{ ...input.runs[0]!, payrollMonth: '2026-03-02' }] }), /first day/);
assert.throws(() => writer.plan({ ...input, runs: [{ ...input.runs[0]!, totalAmount: '999.0000' }] }), /total does not reconcile/);
console.log('Nurix historical payroll policy verification passed: source net amount, period date, source approval evidence, and no-financial-write plan guards.');
