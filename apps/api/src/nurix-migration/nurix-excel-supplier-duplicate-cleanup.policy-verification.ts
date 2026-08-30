/** Run after API build: `node apps/api/dist/nurix-migration/nurix-excel-supplier-duplicate-cleanup.policy-verification.js`. */
import assert from 'node:assert/strict';

import { selectSupplierDuplicateDeletions } from './nurix-excel-supplier-duplicate-cleanup.service.js';

const unused = { outflows: 0, recurringProfiles: 0, supplierDues: 0, dailySalesClosings: 0, employeeServices: 0, suggestedCategories: 0, copyProvenance: 0 };
const used = { ...unused, outflows: 647 };

// The canonical target can be proven by an Invoice map → historical outflow
// even when the old financial writer emitted no Supplier map (empty map ids).
// The reference target is unused and removable. Names are absent entirely.
const removable = selectSupplierDuplicateDeletions('source-supplier-1', [
  { targetId: 'financial-target', sourceMapIds: [], usage: used, otherSourceMapReferences: 0 },
  { targetId: 'reference-duplicate', sourceMapIds: ['map-duplicate'], usage: unused, otherSourceMapReferences: 0 },
]);
assert.deepEqual(removable.map((item) => [item.duplicateTargetId, item.state, item.canonicalTargetId]), [['reference-duplicate', 'DELETE_READY', 'financial-target']]);

// Multiple used targets and any extra lineage remain review-only; the writer
// must not guess a canonical supplier and must not delete either record.
const unsafe = selectSupplierDuplicateDeletions('source-supplier-2', [
  { targetId: 'one', sourceMapIds: ['map-one'], usage: used, otherSourceMapReferences: 0 },
  { targetId: 'two', sourceMapIds: ['map-two'], usage: { ...unused, recurringProfiles: 1 }, otherSourceMapReferences: 0 },
]);
assert.ok(unsafe.every((item) => item.state === 'REVIEW_REQUIRED' && item.reason === 'MULTIPLE_USED_TARGETS'));

const externalLineage = selectSupplierDuplicateDeletions('source-supplier-3', [
  { targetId: 'canonical', sourceMapIds: ['map-canonical'], usage: used, otherSourceMapReferences: 0 },
  { targetId: 'candidate', sourceMapIds: ['map-candidate'], usage: unused, otherSourceMapReferences: 1 },
]);
assert.equal(externalLineage[0]?.state, 'REVIEW_REQUIRED');
assert.equal(externalLineage[0]?.reason, 'DUPLICATE_TARGET_HAS_OTHER_LINEAGE');

console.log('nurix supplier duplicate cleanup policy verification passed');
