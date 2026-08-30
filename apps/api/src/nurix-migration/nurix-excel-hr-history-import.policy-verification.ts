import assert from 'node:assert/strict';
import { NurixExcelHrHistoryImportService, type NurixHrHistoryPlanInput } from './nurix-excel-hr-history-import.service.js';

const hash = 'a'.repeat(64);
const input: NurixHrHistoryPlanInput = {
  packageId: 'package-hr-1', workbookSha256: hash, sourceCompanyId: 'noorix-arz', targetCompanyId: 'baseer-arz',
  mapping: {
    checksum: hash,
    employeesBySourceId: { employee: { id: 'employee-1', active: true } },
    suppliersBySourceId: { supplier: { id: 'supplier-1', active: true } },
    categoriesByCode: { 'E2-4': { id: 'category-1', active: true } },
  },
  employeeServices: [
    { sourceId: 'service-valid', sourceChecksum: hash, employeeSourceId: 'employee', serviceType: 'IQAMA_ISSUANCE', issueDate: '46182', expiryDate: '46365', supplierSourceId: 'supplier', categoryCode: 'E2-4', costInvoiceSourceId: 'source-invoice', status: 'issued' },
    { sourceId: 'service-invalid', sourceChecksum: 'b'.repeat(64), employeeSourceId: 'employee', serviceType: 'IQAMA_ISSUANCE', issueDate: '46365', expiryDate: '46182', status: 'issued' },
  ],
  employeeDeductions: [{ sourceId: 'deduction-1', sourceChecksum: 'c'.repeat(64), employeeSourceId: 'employee', deductionType: 'advance', amount: '500.0000', transactionDate: '46182' }],
  employeeMovements: [{ sourceId: 'movement-1', sourceChecksum: 'd'.repeat(64), employeeSourceId: 'employee', movementType: 'raise', amount: '250.0000', effectiveDate: '46182.5' }],
};

const plan = new NurixExcelHrHistoryImportService().plan(input);
assert.deepEqual(plan.counts, { operationalServices: 1, evidenceOnlyServices: 1, evidenceOnlyDeductions: 1, evidenceOnlyMovements: 1, financialWrites: 0 });
const valid = plan.items.find((item) => item.sourceId === 'service-valid');
assert.equal(valid?.disposition, 'CREATE_OPERATIONAL_SERVICE_DRAFT');
assert.equal(valid?.service?.issueDate, '2026-06-09');
assert.ok(valid?.reasons.includes('SERVICE_COST_EVIDENCE_ONLY'));
assert.ok(plan.items.find((item) => item.sourceId === 'service-invalid')?.reasons.includes('SERVICE_DATE_ORDER_INVALID'));
assert.ok(plan.items.find((item) => item.sourceId === 'deduction-1')?.reasons.includes('ADVANCE_SETTLEMENT_EVIDENCE_ONLY'));
assert.ok(plan.items.find((item) => item.sourceId === 'movement-1')?.reasons.includes('COMPENSATION_OR_TERMINATION_EVIDENCE_ONLY'));

console.log('Nurix HR historical planner verification passed.');
