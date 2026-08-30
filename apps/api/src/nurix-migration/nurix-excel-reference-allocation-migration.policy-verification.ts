import { strict as assert } from 'node:assert';

import { buildNurixExcelReferenceAllocationPlan, NurixExcelReferenceAllocationMigrationService } from './nurix-excel-reference-allocation-migration.service.js';

const base = {
  vaults: [
    { source_id: 'cmnf604kz00a4y8lm5gvqxsho', name_ar: 'نقد', name_en: 'Cash', status: 'active' },
  ],
  invoices: [
    { source_id: 'invoice-1', supplier_source_id: 'supplier-1', kind: 'expense', status: 'active', gross_amount: '115.0000' },
  ],
};

// Supplier labels are deliberately not a uniqueness key. Each immutable
// Noorix source identity becomes its own map, so a later same-named supplier
// cannot silently attach itself to the earlier company-specific supplier.
const duplicateNames = buildNurixExcelReferenceAllocationPlan({
  ...base,
  suppliers: [
    { source_id: 'supplier-1', name_ar: 'شركة العنود العربية', name_en: '', status: 'active' },
    { source_id: 'supplier-2', name_ar: 'شركة العنود العربية', name_en: '', status: 'active' },
  ],
  allocations: [
    { source_id: 'allocation-1', invoice_source_id: 'invoice-1', vault_source_id: 'cmnf604kz00a4y8lm5gvqxsho', payment_method_source_id: 'CASH', amount: '115.0000' },
  ],
});
assert.equal(duplicateNames.suppliers.length, 2);
assert.equal(duplicateNames.items.filter((item) => item.sourceEntity === 'Supplier' && item.status === 'PENDING').length, 2);
assert.equal(duplicateNames.invoices[0]?.supplierSourceId, 'supplier-1');

// When a completed finance import from this exact package already proves an
// invoice's supplier_source_id through Invoice map -> outflow document ->
// FinanceSupplier, the reference writer must reuse that supplier. A matching
// display name is neither queried nor accepted as evidence.
const invoiceSupplierMaps: any[] = [];
const invoiceSupplierWriter = new NurixExcelReferenceAllocationMigrationService({} as never, {} as never);
const invoiceSupplierResult = await (invoiceSupplierWriter as any).writeSupplier({
  nurixExcelFinancialSourceMap: {
    findFirst: async () => null,
    findMany: async ({ where }: any) => {
      assert.deepEqual(where.sourceId.in, ['invoice-1']);
      assert.equal(where.execution.packageId, 'package');
      assert.equal(where.execution.transformVersion, 'nurix-excel-historical-finance/v1');
      return [{ sourceId: 'invoice-1', targetId: 'invoice-document' }];
    },
    create: async ({ data }: any) => invoiceSupplierMaps.push(data),
  },
  legacyMigrationRecordMap: { findFirst: async () => null },
  financeOutflowDocument: { findMany: async () => [{ id: 'invoice-document', supplierId: 'invoice-proven-supplier' }] },
  financeSupplier: {
    findFirst: async () => ({ id: 'invoice-proven-supplier' }),
    create: async () => assert.fail('invoice-proven supplier must be reused, never created again'),
  },
}, { tenantId: 'tenant', actorUserId: 'owner' }, { id: 'package', targetCompanyId: 'arz', sourceCompanyId: 'noorix-arz' }, 'reference-execution', duplicateNames.suppliers[0]!, duplicateNames.invoices);
assert.equal(invoiceSupplierResult, 'REUSED');
assert.equal(invoiceSupplierMaps[0]?.targetId, 'invoice-proven-supplier');
assert.equal(invoiceSupplierMaps[0]?.state, 'REUSED');

// More than one target supplier for invoices carrying the same immutable
// source supplier identity is an accounting conflict, never a choice based on
// their display names.
await assert.rejects(() => (invoiceSupplierWriter as any).invoiceBackedSupplier({
  nurixExcelFinancialSourceMap: { findMany: async () => [{ sourceId: 'invoice-1', targetId: 'invoice-document-1' }, { sourceId: 'invoice-2', targetId: 'invoice-document-2' }] },
  financeOutflowDocument: { findMany: async () => [{ id: 'invoice-document-1', supplierId: 'supplier-a' }, { id: 'invoice-document-2', supplierId: 'supplier-b' }] },
  financeSupplier: { findFirst: async () => assert.fail('ambiguous lineage must fail before supplier lookup') },
}, { tenantId: 'tenant' }, { id: 'package', targetCompanyId: 'arz' }, { sourceId: 'supplier-1' }, [{ sourceId: 'invoice-1', supplierSourceId: 'supplier-1' }, { sourceId: 'invoice-2', supplierSourceId: 'supplier-1' }]), /does not prove one ARZ supplier/i);

// An allocation whose source sum does not equal the invoice gross remains
// review evidence; the writer must not create or change a financial allocation.
const mismatch = buildNurixExcelReferenceAllocationPlan({
  ...base,
  suppliers: [{ source_id: 'supplier-1', name_ar: 'مورد', name_en: '', status: 'active' }],
  allocations: [
    { source_id: 'allocation-1', invoice_source_id: 'invoice-1', vault_source_id: 'cmnf604kz00a4y8lm5gvqxsho', payment_method_source_id: 'CASH', amount: '100.0000' },
  ],
});
assert.equal(mismatch.items.find((item) => item.sourceEntity === 'InvoiceAllocation')?.status, 'REVIEW_REQUIRED');
assert.equal(mismatch.items.find((item) => item.sourceEntity === 'InvoiceAllocation')?.reviewCode, 'SOURCE_ALLOCATION_TOTAL_MISMATCH');

assert.throws(() => buildNurixExcelReferenceAllocationPlan({
  ...base,
  suppliers: [{ source_id: 'supplier-1', name_ar: 'مورد', name_en: '', status: 'active' }],
  allocations: [
    { source_id: 'allocation-1', invoice_source_id: 'invoice-1', vault_source_id: 'cmnf604kz00a4y8lm5gvqxsho', amount: '115.0000' },
    { source_id: 'allocation-1', invoice_source_id: 'invoice-1', vault_source_id: 'cmnf604kz00a4y8lm5gvqxsho', amount: '0.0000' },
  ],
}), /duplicate source identity/);

// The ARZ decision for Sifi accepts the already-provisioned Sifi vault on
// NURIX-V-003 even when the legacy V-003 account is also active. The writer
// never queries/selects either account: an exact approved target vault must
// already exist, otherwise the item becomes REVIEW_REQUIRED.
const vaultMaps: unknown[] = [];
const sifiWriter = new NurixExcelReferenceAllocationMigrationService({} as never, {} as never);
const sifiResult = await (sifiWriter as any).writeVault({
  nurixExcelFinancialSourceMap: { findFirst: async () => null, create: async ({ data }: any) => vaultMaps.push(data) },
  financeVault: { findMany: async () => [{ id: 'sifi-target', type: 'CASH', paymentMethod: 'CASH', paymentMethods: ['CASH'], isPaymentDestination: true, account: { code: 'NURIX-V-003', status: 'ACTIVE' } }] },
}, { tenantId: 'tenant', actorUserId: 'owner' }, 'arz', 'execution', { sourceId: 'cmnw3fmrg000410l28jrx8z6n', sourceChecksum: 'source-checksum', nameAr: 'Sifi', nameEn: null, status: 'active' });
assert.deepEqual(sifiResult, { status: 'REUSED', targetId: 'sifi-target' });
assert.equal((vaultMaps[0] as any).targetId, 'sifi-target');

const absentSifiResult = await (sifiWriter as any).writeVault({
  nurixExcelFinancialSourceMap: { findFirst: async () => null, create: async () => assert.fail('must not create a new vault') },
  financeVault: { findMany: async () => [] },
}, { tenantId: 'tenant', actorUserId: 'owner' }, 'arz', 'execution', { sourceId: 'cmnw3fmrg000410l28jrx8z6n', sourceChecksum: 'source-checksum', nameAr: 'Sifi', nameEn: null, status: 'active' });
assert.deepEqual(absentSifiResult, { status: 'UNSAFE', code: 'TARGET_VAULT_NOT_PROVISIONED' });

// Allocation binding accepts only an APPLIED/REUSED vault map carrying the
// exact Vault source checksum for the same package/company. Its target is
// then re-read as an active payment destination before any lineage is stored.
const allocationMaps: unknown[] = [];
const allocationResult = await (sifiWriter as any).bindAllocation({
  nurixExcelFinancialSourceMap: {
    findFirst: async ({ where }: any) => {
      if (where.sourceEntity === 'InvoiceAllocation') return null;
      if (where.sourceEntity === 'Invoice') return { targetId: 'invoice-target' };
      if (where.sourceEntity === 'Vault') {
        assert.equal(where.sourceChecksum, 'vault-source-checksum');
        assert.equal(where.execution.packageId, 'package');
        assert.deepEqual(where.state.in, ['APPLIED', 'REUSED']);
        return { targetId: 'sifi-target' };
      }
      assert.fail('unexpected source-map lookup');
    },
    create: async ({ data }: any) => allocationMaps.push(data),
  },
  financeVault: { findFirst: async () => ({ id: 'sifi-target', paymentMethod: 'CASH', paymentMethods: ['CASH'] }) },
  financeOutflowDocument: { findFirst: async () => ({ id: 'invoice-target' }) },
  financeOutflowAllocation: { findMany: async () => [{ id: 'allocation-target' }] },
}, { tenantId: 'tenant', actorUserId: 'owner' }, { id: 'package', targetCompanyId: 'arz' }, 'execution', { sourceId: 'allocation-source', sourceChecksum: 'allocation-checksum', invoiceSourceId: 'invoice-source', vaultSourceId: 'vault-source', vaultSourceChecksum: 'vault-source-checksum', amount: '115.0000', paymentMethod: 'CASH', reviewCode: null });
assert.deepEqual(allocationResult, { status: 'POSTED', targetId: 'allocation-target' });
assert.equal((allocationMaps[0] as any).targetId, 'allocation-target');

// Raw SheetJS rows are not checksum authority. The writer replaces every
// reference receipt with the checksum already accepted by staging, including
// the Vault checksum that allocation lineage later requires.
const stagingPlan = buildNurixExcelReferenceAllocationPlan({
  ...base,
  suppliers: [{ source_id: 'supplier-1', name_ar: 'مورد', name_en: '', status: 'active' }],
  allocations: [{ source_id: 'allocation-1', invoice_source_id: 'invoice-1', vault_source_id: 'cmnf604kz00a4y8lm5gvqxsho', payment_method_source_id: 'CASH', amount: '115.0000' }],
});
const stagingWriter = new NurixExcelReferenceAllocationMigrationService({
  inTenantTransaction: async (_tenant: string, run: any) => run({
    nurixExcelStagingRow: { findMany: async () => [
      { sheet: 'Suppliers', sourceId: 'supplier-1', sourceChecksum: 'a'.repeat(64) },
      { sheet: 'Vaults', sourceId: 'cmnf604kz00a4y8lm5gvqxsho', sourceChecksum: 'b'.repeat(64) },
      { sheet: 'InvoiceAllocations', sourceId: 'allocation-1', sourceChecksum: 'c'.repeat(64) },
    ] },
  }),
} as never, {} as never);
const stagedPlan = await (stagingWriter as any).withAcceptedStagingChecksums({ tenantId: 'tenant', actorUserId: 'owner' }, 'package', stagingPlan);
assert.equal(stagedPlan.suppliers[0].sourceChecksum, 'a'.repeat(64));
assert.equal(stagedPlan.vaults[0].sourceChecksum, 'b'.repeat(64));
assert.equal(stagedPlan.allocations[0].sourceChecksum, 'c'.repeat(64));
assert.equal(stagedPlan.allocations[0].vaultSourceChecksum, 'b'.repeat(64));

// Remediation may rewrite only this transform's live reference maps and their
// technical item receipts. It leaves Invoice/Ledger lineage and all target IDs
// untouched, then emits a single audit event before a later resume.
const remediatedMaps: string[] = [], remediatedItems: string[] = [], remediationAudits: unknown[] = [];
const remediationWriter = new NurixExcelReferenceAllocationMigrationService({
  inTenantTransaction: async (_tenant: string, run: any) => run({
    nurixExcelFinancialExecution: { findFirst: async () => ({ id: 'execution' }), update: async () => ({}) },
    nurixExcelFinancialSourceMap: {
      findMany: async () => [
        { id: 'map-supplier', sourceEntity: 'Supplier', sourceId: 'supplier-1', sourceChecksum: 'old', targetEntity: 'FinanceSupplier', targetId: 'supplier-target' },
        { id: 'map-vault', sourceEntity: 'Vault', sourceId: 'cmnf604kz00a4y8lm5gvqxsho', sourceChecksum: 'old', targetEntity: 'FinanceVault', targetId: 'vault-target' },
        { id: 'map-allocation', sourceEntity: 'InvoiceAllocation', sourceId: 'allocation-1', sourceChecksum: 'old', targetEntity: 'FinanceOutflowAllocation', targetId: 'allocation-target' },
        { id: 'map-invoice', sourceEntity: 'Invoice', sourceId: 'invoice-1', sourceChecksum: 'invoice-old', targetEntity: 'FinanceOutflowDocument', targetId: 'invoice-target' },
      ],
      update: async ({ where }: any) => remediatedMaps.push(where.id),
    },
    financeSupplier: { findMany: async () => [{ id: 'supplier-target' }] },
    financeVault: { findMany: async () => [{ id: 'vault-target' }] },
    financeOutflowAllocation: { findMany: async () => [{ id: 'allocation-target' }] },
    nurixExcelFinancialItem: { findMany: async () => [
      { id: 'item-supplier', sourceEntity: 'Supplier', sourceId: 'supplier-1', sourceChecksum: 'old' },
      { id: 'item-vault', sourceEntity: 'Vault', sourceId: 'cmnf604kz00a4y8lm5gvqxsho', sourceChecksum: 'old' },
      { id: 'item-allocation', sourceEntity: 'InvoiceAllocation', sourceId: 'allocation-1', sourceChecksum: 'old' },
      { id: 'item-invoice', sourceEntity: 'Invoice', sourceId: 'invoice-1', sourceChecksum: 'invoice-old' },
    ], update: async ({ where }: any) => remediatedItems.push(where.id) },
    auditEvent: { create: async ({ data }: any) => remediationAudits.push(data) },
  }),
} as never, {} as never);
await (remediationWriter as any).remediateAuthoritativeChecksums({ tenantId: 'tenant', actorUserId: 'owner' }, { id: 'package', targetCompanyId: 'arz' }, stagedPlan);
assert.deepEqual(remediatedMaps.sort(), ['map-allocation', 'map-supplier', 'map-vault']);
assert.deepEqual(remediatedItems.sort(), ['item-allocation', 'item-supplier', 'item-vault']);
assert.equal(remediationAudits.length, 1);

// A retry may reopen one already-committed wave while leaving its terminal
// rows and their targets intact. Only its PENDING row is written again, and
// the deterministic wave receipt is updated in place instead of creating a
// duplicate (executionId, sequence) receipt.
const resumedItemUpdates: unknown[] = [], resumedReceiptUpserts: unknown[] = [], resumedMapCreates: unknown[] = [];
const resumedWriter = new NurixExcelReferenceAllocationMigrationService({
  inTenantTransaction: async (_tenant: string, run: any) => run({
    nurixExcelFinancialWave: {
      findFirst: async () => ({ id: 'wave-3' }),
      update: async () => ({}),
    },
    nurixExcelFinancialItem: {
      findMany: async () => [
        { id: 'posted-item', sourceEntity: 'Supplier', sourceId: 'already-posted', sourceChecksum: 'posted-checksum', status: 'POSTED', resultCode: 'POSTED' },
        { id: 'reused-item', sourceEntity: 'Supplier', sourceId: 'already-reused', sourceChecksum: 'reused-checksum', status: 'REUSED', resultCode: 'REUSED' },
        { id: 'pending-item', sourceEntity: 'Supplier', sourceId: 'retry-supplier', sourceChecksum: 'retry-checksum', status: 'PENDING', resultCode: null },
      ],
      update: async ({ where, data }: any) => resumedItemUpdates.push({ where, data }),
      groupBy: async () => [
        { status: 'POSTED', _count: { _all: 1 } },
        { status: 'REUSED', _count: { _all: 2 } },
      ],
    },
    nurixExcelFinancialExecution: { update: async () => ({}) },
    nurixExcelFinancialReceipt: { upsert: async (input: any) => resumedReceiptUpserts.push(input) },
    nurixExcelFinancialSourceMap: {
      // The retry-supplier target/map already exists from the first attempt.
      // Reusing it proves the resumed writer creates no duplicate target.
      findFirst: async () => ({ targetId: 'retry-supplier-target', sourceChecksum: 'retry-checksum' }),
      create: async (input: any) => resumedMapCreates.push(input),
    },
  }),
} as never, {} as never);
const resumedPlan = {
  suppliers: [{ sourceId: 'retry-supplier', sourceChecksum: 'retry-checksum', nameAr: 'مورد مستأنف', nameEn: null, status: 'active' as const }],
  vaults: [], invoices: [], allocations: [], items: [], checksum: 'resume-plan',
};
for (let attempt = 0; attempt < 2; attempt += 1) {
  await (resumedWriter as any).commitWave(
    { tenantId: 'tenant', actorUserId: 'owner' },
    { targetCompanyId: 'arz', sourceCompanyId: 'source' },
    'execution-resume',
    { id: 'wave-3', sequence: 3, token: `lease-${attempt}` },
    resumedPlan,
  );
}
assert.deepEqual(resumedItemUpdates.map((item: any) => item.where.id), ['pending-item', 'pending-item']);
assert.equal(resumedMapCreates.length, 0);
assert.equal(resumedReceiptUpserts.length, 2);
for (const receipt of resumedReceiptUpserts as any[]) {
  assert.deepEqual(receipt.where, { executionId_sequence: { executionId: 'execution-resume', sequence: 3 } });
  assert.equal(receipt.create.kind, 'WAVE_COMMITTED');
  assert.equal(receipt.update.kind, 'WAVE_COMMITTED');
}

process.stdout.write('nurix excel reference/allocation policy verification passed\n');
