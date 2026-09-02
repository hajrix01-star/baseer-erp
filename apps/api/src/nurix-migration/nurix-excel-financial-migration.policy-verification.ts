import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./nurix-excel-financial-migration.service.js', import.meta.url)), 'utf8');
const snapshotStart = source.indexOf('async snapshotApprovedReferences');
const snapshotEnd = source.indexOf('normalizedInvoices(', snapshotStart);
assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, 'financial writer must have an isolated reference snapshot');
const snapshot = source.slice(snapshotStart, snapshotEnd);

// The financial document writer must consume reviewed reference evidence. A
// plan failure must not silently create or alter accounting master data.
assert.match(snapshot, /REFERENCE_PROVISION_VERSION/);
for (const forbidden of ['financeAccount.create', 'financeSupplier.create', 'financeVault.create', 'financeCategory.update', 'financeCategory.updateMany']) {
  assert.ok(!snapshot.includes(forbidden), `reference snapshot must not call ${forbidden}`);
}
assert.match(source, /status: 'RUNNING', leaseExpiresAt: \{ lt: new Date\(\) \}/);

const dailySales = readFileSync(fileURLToPath(new URL('./nurix-excel-daily-sales-migration.service.js', import.meta.url)), 'utf8');
assert.match(dailySales, /Same-date ALL sales closes have different allocation evidence/);
assert.match(dailySales, /customerCount: value\.customerCount \+ item\.customerCount/);
assert.ok(!dailySales.includes('financeVault.updateMany'), 'daily-sales import must not mutate vault channel configuration');

const references = readFileSync(fileURLToPath(new URL('./nurix-excel-reference-allocation-migration.service.js', import.meta.url)), 'utf8');
assert.match(references, /REFERENCE_PROVISION_VERSION/);
assert.match(references, /async preprovision/);

console.log('Nurix financial migration policy verification passed.');
