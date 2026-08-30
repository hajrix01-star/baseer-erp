import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import { buildNurixEvidenceArchivePlan } from './nurix-excel-evidence-archive.service.js';

const workbook = XLSX.utils.book_new();
const add = (name: string, rows: readonly Record<string, string>[]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([...rows]), name);
add('BankStatements', [{ source_id: 'statement-1' }]);
add('BankTransactions', [{ source_id: 'transaction-1' }, { source_id: 'transaction-2' }]);
add('VatPlanning', [{ source_id: 'vat-1' }]);
add('Assets', [{ source_id: 'asset-1' }]);
add('CategoryAudit', [{ source_category_id: 'category-1' }]);
add('Exceptions', [{ source_sheet: 'Invoices', source_id: 'invoice-1' }]);

const plan = buildNurixEvidenceArchivePlan(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
assert.equal(plan.sources.length, 7);
assert.equal(plan.sources.filter((source) => source.treatment === 'HISTORICAL').length, 5);
assert.equal(plan.sources.filter((source) => source.treatment === 'REVIEW').length, 2);
assert.ok(plan.sources.some((source) => source.entity === 'NoorixException:Invoices' && source.sourceId === 'invoice-1'));
assert.match(plan.checksum, /^[a-f0-9]{64}$/);

console.log('Nurix Excel evidence archive verification passed: historical evidence is distinct from owner-review evidence and has stable source lineage.');
