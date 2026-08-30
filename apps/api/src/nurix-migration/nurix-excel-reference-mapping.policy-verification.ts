/** Run after API build: `node apps/api/dist/nurix-migration/nurix-excel-reference-mapping.policy-verification.js`. */
import assert from 'node:assert/strict';
import { ARZ_V5_VAULT_REFERENCES, assertArzVaultReferencesAreSafe, resolveArzV5VaultReference, resolveSupplierReference } from './nurix-excel-reference-mapping.js';

assertArzVaultReferencesAreSafe();

const expectedVaults = new Map([
  ['بنك', ['V-002', 'BANK_TRANSFER']],
  ['نقد', ['V-001', 'CASH']],
  ['Sifi', ['V-003', 'CASH']],
  ['حسابي الشخصي', ['V-004', 'BANK_TRANSFER']],
  ['عبدالجيل', ['V-005', 'CASH']],
]);
for (const reference of ARZ_V5_VAULT_REFERENCES) {
  const result = resolveArzV5VaultReference({ sourceId: reference.sourceId, nameAr: reference.sourceNameAr });
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED') throw new Error('expected mapped vault');
  assert.deepEqual([result.mapping.targetVaultCode, result.mapping.paymentMethod], expectedVaults.get(reference.sourceNameAr));
}

const known = ARZ_V5_VAULT_REFERENCES[0]!;
assert.deepEqual(resolveArzV5VaultReference({ sourceId: known.sourceId, nameAr: 'اسم مختلف' }), { status: 'REVIEW_REQUIRED', reason: 'SOURCE_VAULT_EVIDENCE_MISMATCH' });
assert.deepEqual(resolveArzV5VaultReference({ sourceId: 'untrusted-source-id', nameAr: 'نقد' }), { status: 'REVIEW_REQUIRED', reason: 'UNKNOWN_SOURCE_VAULT' });

assert.deepEqual(resolveSupplierReference({ sourceId: 'supplier-1', nameAr: ' الشركة السعودية للكهرباء ' }, [{ id: 'supplier-electricity', nameAr: 'الشركة السعودية للكهرباء' }]), { status: 'MATCHED', targetSupplierId: 'supplier-electricity', match: 'EXACT_NORMALIZED_NAME' });
assert.deepEqual(resolveSupplierReference({ sourceId: 'supplier-2', nameAr: 'كهرباء السعودية', nameEn: 'Electricity' }, [{ id: 'supplier-electricity', nameAr: 'الشركة السعودية للكهرباء' }]), { status: 'CREATE', create: { nameAr: 'كهرباء السعودية', nameEn: 'Electricity' } });
assert.deepEqual(resolveSupplierReference({ sourceId: 'supplier-3', nameAr: 'مورد' }, [{ id: 'one', nameAr: 'مورد' }, { id: 'two', nameAr: 'مورد' }]), { status: 'REVIEW_REQUIRED', reason: 'TARGET_SUPPLIER_NAME_AMBIGUOUS' });
assert.deepEqual(resolveSupplierReference({ sourceId: 'supplier-4', nameAr: '   ' }, []), { status: 'REVIEW_REQUIRED', reason: 'SOURCE_SUPPLIER_NAME_MISSING' });

assert.throws(() => assertArzVaultReferencesAreSafe([...ARZ_V5_VAULT_REFERENCES, { ...ARZ_V5_VAULT_REFERENCES[0]!, targetVaultCode: 'V-001' }]), /ARZ_VAULT_REFERENCE_DUPLICATE/);
console.log('Nurix Excel reference mapping verification passed: exact supplier decisions and evidence-bound ARZ vault decisions only.');
