/** Run after API build: `node apps/api/dist/nurix-migration/nurix-excel-package-closure-audit.policy-verification.js`. */
import assert from 'node:assert/strict';

import { countDistinctSourceMaps, countDistinctSourceMapsWithSupplierDeletions, resolveHrExceptionSheetEvidence, resolveHrHistoryClosureCoverage } from './nurix-excel-package-closure-audit.service.js';

// Retried/reused maps are final coverage, but retries must not inflate the
// number of settled source rows. Five immutable vault identities therefore
// remain five even when a completed remediation has another map receipt.
const maps = countDistinctSourceMaps([
  { sourceEntity: 'Vault', sourceId: 'vault-1' },
  { sourceEntity: 'Vault', sourceId: 'vault-1' },
  { sourceEntity: 'Vault', sourceId: 'vault-2' },
  { sourceEntity: 'Vault', sourceId: 'vault-3' },
  { sourceEntity: 'Vault', sourceId: 'vault-4' },
  { sourceEntity: 'Vault', sourceId: 'vault-5' },
  { sourceEntity: 'Invoice', sourceId: 'invoice-1' },
]);
assert.equal(maps.get('Vault'), 5);
assert.equal(maps.get('Invoice'), 1);

const supplierCoverage = countDistinctSourceMapsWithSupplierDeletions(
  [{ sourceEntity: 'Supplier', sourceId: 'supplier-mapped' }],
  [
    { sheet: 'Suppliers', sourceId: 'supplier-mapped' },
    { sheet: 'Suppliers', sourceId: 'supplier-deleted' },
    { sheet: 'Suppliers', sourceId: 'supplier-unrelated' },
  ],
  [
    { beforeJson: { sourceIdentity: { entity: 'Supplier', sourceId: 'supplier-deleted' } }, afterJson: { deleted: true } },
    { beforeJson: { sourceIdentity: { entity: 'Supplier', sourceId: 'supplier-unrelated' } }, afterJson: { deleted: false } },
    { beforeJson: { sourceIdentity: { entity: 'Other', sourceId: 'supplier-unrelated' } }, afterJson: { deleted: true } },
  ],
);
assert.equal(supplierCoverage.get('Supplier'), 2);

// HR evidence uses a package-bound legacy run. Services may be a staged,
// cost-free historical service or a review-evidence row; deductions and
// movements are evidence only. A source checksum mismatch must fail closed.
const hrCoverage = resolveHrHistoryClosureCoverage([
  { sheet: 'EmployeeServices', sourceId: 'service-1', sourceChecksum: 'a'.repeat(64) },
  { sheet: 'EmployeeServices', sourceId: 'service-2', sourceChecksum: 'b'.repeat(64) },
  { sheet: 'EmployeeDeductions', sourceId: 'deduction-1', sourceChecksum: 'c'.repeat(64) },
  { sheet: 'EmployeeMovements', sourceId: 'movement-1', sourceChecksum: 'd'.repeat(64) },
], {
  serviceMaps: [{ sourceId: 'service-1', sourceChecksum: 'a'.repeat(64), targetId: 'target-service-1', targetEntity: 'HR_EMPLOYEE_SERVICE', state: 'STAGED' }],
  exceptions: [
    { sourceEntity: 'NOORIX_EXCEL_EMPLOYEE_SERVICE_EVIDENCE', sourceId: 'service-2', code: 'NURIX_HR_SERVICE_COST_EVIDENCE', severity: 'REVIEW' },
    { sourceEntity: 'NOORIX_EXCEL_EMPLOYEE_DEDUCTION', sourceId: 'deduction-1', code: 'NURIX_HR_EVIDENCE_ONLY', severity: 'REVIEW' },
    { sourceEntity: 'NOORIX_EXCEL_EMPLOYEE_MOVEMENT', sourceId: 'movement-1', code: 'NURIX_HR_EVIDENCE_ONLY', severity: 'REVIEW' },
  ],
  activeServiceIds: ['target-service-1'],
});
assert.deepEqual(hrCoverage, {
  EmployeeServices: { settledRows: 2, sourceMaps: 1, evidenceRows: 1 },
  EmployeeDeductions: { settledRows: 1, sourceMaps: 0, evidenceRows: 1 },
  EmployeeMovements: { settledRows: 1, sourceMaps: 0, evidenceRows: 1 },
});
const checksumMismatch = resolveHrHistoryClosureCoverage([
  { sheet: 'EmployeeServices', sourceId: 'service-1', sourceChecksum: 'z'.repeat(64) },
], {
  serviceMaps: [{ sourceId: 'service-1', sourceChecksum: 'a'.repeat(64), targetId: 'target-service-1', targetEntity: 'HR_EMPLOYEE_SERVICE', state: 'STAGED' }],
  exceptions: [], activeServiceIds: ['target-service-1'],
});
assert.equal(checksumMismatch.EmployeeServices.settledRows, 0);

// Noorix Exceptions closes only when every source ID is an already accepted
// historical HR-service evidence receipt from the same package-bound run.
const exceptionRows = [
  { sheet: 'Exceptions', sourceId: 'service-2', sourceChecksum: 'b'.repeat(64) },
  { sheet: 'Exceptions', sourceId: 'service-3', sourceChecksum: 'e'.repeat(64) },
];
assert.equal(resolveHrExceptionSheetEvidence(exceptionRows, [
  { sourceEntity: 'NOORIX_EXCEL_EMPLOYEE_SERVICE_EVIDENCE', sourceId: 'service-2', code: 'NURIX_HR_EVIDENCE_ONLY', severity: 'REVIEW' },
  { sourceEntity: 'NOORIX_EXCEL_EMPLOYEE_SERVICE_EVIDENCE', sourceId: 'service-3', code: 'NURIX_HR_SERVICE_COST_EVIDENCE', severity: 'REVIEW' },
]), 2);
assert.equal(resolveHrExceptionSheetEvidence(exceptionRows, [
  { sourceEntity: 'NOORIX_EXCEL_EMPLOYEE_DEDUCTION', sourceId: 'service-2', code: 'NURIX_HR_EVIDENCE_ONLY', severity: 'REVIEW' },
]), 0);

console.log('nurix package closure audit policy verification passed');
