/** Run after API build: `node apps/api/dist/nurix-migration/nurix-excel-recurring-migration.policy-verification.js`. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { NurixExcelRecurringMigrationService, planApprovedZeroExpectedRecurringRemediation, planNurixRecurringExpenseRows } from './nurix-excel-recurring-migration.service.js';

const supplierId = 'source-supplier-1';
const vaultId = 'cmnf604l100a6y8lm6h3y6ocx';
const profileId = 'source-recurring-profile-1';
const paymentId = 'source-recurring-payment-1';
const base = () => ({
  suppliers: [{ source_id: supplierId, name_ar: 'مورد دوري', name_en: '', status: 'active' }],
  vaults: [{ source_id: vaultId, name_ar: 'بنك', name_en: '', status: 'active' }],
  profiles: [{ source_id: profileId, name_ar: 'إنترنت', name_en: '', supplier_source_id: supplierId, baseer_category_code: 'E3-3', expected_amount: '399.0000', interval_months: '1', status: 'active', service_number: '', notes: '' }],
  payments: [{ source_id: paymentId, profile_source_id: profileId, supplier_source_id: supplierId, baseer_category_code: 'E3-3', vault_source_id: vaultId, document_number: 'EXP-1', transaction_date: '2026-04-19T00:00:00.000Z', net_amount: '346.9565', tax_amount: '52.0435', gross_amount: '399.0000', status: 'active', notes: '' }],
});

const plan = planNurixRecurringExpenseRows(base());
assert.equal(plan.profiles.length, 1);
assert.equal(plan.payments.length, 1);
assert.equal(plan.payments[0]?.coverageStartMonth, 4);
assert.equal(plan.postedGrossAmount, '399.0000');
assert.ok(plan.planChecksum.length === 64);

const amountMismatch = base();
amountMismatch.payments[0]!.gross_amount = '400.0000';
assert.throws(() => planNurixRecurringExpenseRows(amountMismatch), /mismatched net, tax, and gross/i);

const supplierMismatch = base();
supplierMismatch.payments[0]!.supplier_source_id = 'other-supplier';
assert.throws(() => planNurixRecurringExpenseRows(supplierMismatch), /unknown supplier|conflicts with its profile/i);

const duplicateCoverage = base();
duplicateCoverage.payments.push({ ...duplicateCoverage.payments[0]!, source_id: 'source-recurring-payment-2' });
const duplicatePlan = planNurixRecurringExpenseRows(duplicateCoverage);
assert.deepEqual(duplicatePlan.payments.map((payment) => payment.status), ['REVIEW_REQUIRED', 'REVIEW_REQUIRED']);
assert.ok(duplicatePlan.payments.every((payment) => payment.reviewCode === 'DUPLICATE_SOURCE_PAYMENT'));
assert.equal(duplicatePlan.postedGrossAmount, '0.0000');

const unprovenConcurrentCoverage = base();
unprovenConcurrentCoverage.payments.push({ ...unprovenConcurrentCoverage.payments[0]!, source_id: 'source-recurring-payment-3', document_number: 'EXP-3', transaction_date: '2026-04-20T00:00:00.000Z' });
const concurrentPlan = planNurixRecurringExpenseRows(unprovenConcurrentCoverage);
assert.deepEqual(concurrentPlan.payments.map((payment) => payment.status), ['REVIEW_REQUIRED', 'REVIEW_REQUIRED']);
assert.ok(concurrentPlan.payments.every((payment) => payment.reviewCode === 'UNPROVEN_CONCURRENT_COVERAGE'));

// A historical profile with zero expected value cannot be represented by a
// Baseer recurring profile. Keep both it and its active payment as immutable
// review evidence, while leaving the rest of the package executable.
const nonpositiveProfile = base();
nonpositiveProfile.profiles[0]!.expected_amount = '0.0000';
const nonpositivePlan = planNurixRecurringExpenseRows(nonpositiveProfile);
assert.equal(nonpositivePlan.profiles[0]?.reviewCode, 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE');
assert.equal(nonpositivePlan.payments[0]?.status, 'REVIEW_REQUIRED');
assert.equal(nonpositivePlan.payments[0]?.reviewCode, 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE');
assert.equal(nonpositivePlan.postedGrossAmount, '0.0000');

const mixedProfileAmounts = base();
mixedProfileAmounts.profiles.push({ ...mixedProfileAmounts.profiles[0]!, source_id: 'source-recurring-profile-2', expected_amount: '0.0000' });
mixedProfileAmounts.payments.push({ ...mixedProfileAmounts.payments[0]!, source_id: 'source-recurring-payment-2', profile_source_id: 'source-recurring-profile-2', document_number: 'EXP-2', transaction_date: '2026-05-19T00:00:00.000Z' });
const mixedPlan = planNurixRecurringExpenseRows(mixedProfileAmounts);
assert.equal(mixedPlan.payments.find((payment) => payment.sourceId === paymentId)?.status, 'POST');
assert.equal(mixedPlan.payments.find((payment) => payment.sourceId === 'source-recurring-payment-2')?.reviewCode, 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE');

// A completed review checkpoint may be resumed only when a package-local
// reference dependency became available. Coverage evidence is intentionally
// never reopened, and reopening retains the original wave/receipt slot.
const resumeUpdates: any[] = [];
const resumeWriter = new NurixExcelRecurringMigrationService({} as never, {} as never, {} as never, {} as never);
const reopened = await (resumeWriter as any).reopenResolvedReferenceReviews({
  nurixExcelFinancialItem: {
    findMany: async () => [
      { id: 'profile-review', waveId: 'profile-wave' },
      { id: 'payment-review', waveId: 'payment-wave' },
    ],
    updateMany: async (input: any) => { resumeUpdates.push({ kind: 'item', ...input }); return { count: 2 }; },
  },
  nurixExcelFinancialWave: {
    updateMany: async (input: any) => { resumeUpdates.push({ kind: 'wave', ...input }); return { count: 2 }; },
  },
}, 'execution');
assert.equal(reopened, true);
assert.deepEqual(resumeUpdates[0]?.where.resultCode.in.sort(), ['PROFILE_SOURCE_MAP_UNAVAILABLE', 'SUPPLIER_SOURCE_MAP_AMBIGUOUS', 'SUPPLIER_SOURCE_MAP_MISSING']);
assert.deepEqual(resumeUpdates[0]?.data, { status: 'PENDING', targetEntity: null, targetId: null, resultCode: null });
assert.deepEqual(resumeUpdates[1]?.data, { status: 'PENDING', leaseToken: null, leaseExpiresAt: null, committedAt: null });

// A crashed claim has no business writes: the profile/payment write is one
// transaction. Only an expired RUNNING lease is released; a live lease is
// never stolen by a second importer.
let recoveredWaveWhere: any;
const recoverWriter = new NurixExcelRecurringMigrationService({
  inTenantTransaction: async (_tenantId: string, action: any) => action({
    nurixExcelFinancialWave: {
      updateMany: async (input: any) => { recoveredWaveWhere = input; return { count: 1 }; },
    },
  }),
} as never, {} as never, {} as never, {} as never);
await (recoverWriter as any).recoverExpiredWaves({ tenantId: 'tenant' }, 'execution');
assert.equal(recoveredWaveWhere.where.status, 'RUNNING');
assert.ok(recoveredWaveWhere.where.leaseExpiresAt.lt instanceof Date);
assert.deepEqual(recoveredWaveWhere.data, { status: 'PENDING', leaseToken: null, leaseExpiresAt: null });

// The recurring writer must use the accepted staging checksum rather than a
// raw SheetJS-row hash when it consumes the completed supplier reference map.
let mapWhere: any;
const supplierResolution = await (resumeWriter as any).supplier({
  nurixExcelStagingRow: { findFirst: async () => ({ sourceChecksum: 'staging-checksum' }) },
  nurixExcelFinancialSourceMap: { findMany: async ({ where }: any) => { mapWhere = where; return [{ targetId: 'supplier-target' }]; } },
  financeSupplier: { findFirst: async () => ({ id: 'supplier-target' }) },
}, { tenantId: 'tenant', companyId: 'company' }, 'package', supplierId, { checksum: 'raw-sheetjs-checksum' });
assert.deepEqual(supplierResolution, { targetId: 'supplier-target' });
assert.equal(mapWhere.sourceChecksum, 'staging-checksum');
assert.deepEqual(mapWhere.state.in, ['APPLIED', 'REUSED']);

// Duplicate cleanup may remove an unused Supplier source map. The recurring
// writer may recover only from the cleanup audit carrying the same package
// request fingerprint, source identity and canonical target—not from a name
// or an audit record for another package.
const cleanupPackageId = 'package-cleanup';
const deletedDuplicateId = 'deleted-duplicate';
const cleanupRequestId = `nurix-supplier-clean:${createHash('sha256').update(JSON.stringify({ packageId: cleanupPackageId, sourceId: supplierId, targetId: deletedDuplicateId })).digest('hex')}`;
const cleanupResolution = await (resumeWriter as any).supplier({
  nurixExcelStagingRow: { findFirst: async () => ({ sourceChecksum: 'staging-checksum' }) },
  nurixExcelFinancialSourceMap: { findMany: async () => [] },
  auditEvent: {
    findMany: async ({ where }: any) => {
      assert.equal(where.action, 'nurix_excel.supplier_duplicate_unused_deleted');
      assert.equal(where.entityType, 'FinanceSupplier');
      return [{ entityId: deletedDuplicateId, requestId: cleanupRequestId, beforeJson: { sourceIdentity: { entity: 'Supplier', sourceId: supplierId }, canonicalTargetId: 'canonical-supplier' } }];
    },
  },
  financeSupplier: { findFirst: async ({ where }: any) => { assert.equal(where.id, 'canonical-supplier'); return { id: 'canonical-supplier' }; } },
}, { tenantId: 'tenant', companyId: 'company' }, cleanupPackageId, supplierId, { checksum: 'raw-sheetjs-checksum' });
assert.deepEqual(cleanupResolution, { targetId: 'canonical-supplier' });

const wrongPackageCleanupResolution = await (resumeWriter as any).supplier({
  nurixExcelStagingRow: { findFirst: async () => ({ sourceChecksum: 'staging-checksum' }) },
  nurixExcelFinancialSourceMap: { findMany: async () => [] },
  auditEvent: { findMany: async () => [{ entityId: deletedDuplicateId, requestId: cleanupRequestId, beforeJson: { sourceIdentity: { entity: 'Supplier', sourceId: supplierId }, canonicalTargetId: 'canonical-supplier' } }] },
  financeSupplier: { findFirst: async () => assert.fail('other-package audit must not resolve a supplier') },
}, { tenantId: 'tenant', companyId: 'company' }, 'other-package', supplierId, { checksum: 'raw-sheetjs-checksum' });
assert.deepEqual(wrongPackageCleanupResolution, { reviewCode: 'SUPPLIER_SOURCE_MAP_MISSING' });

// The zero-expected remediation is a separate plan: only explicit owner
// decisions with active zero-value payment evidence are included. The tobacco
// zero profile has no payment and the already-imported tobacco-service profile
// is not an approved zero decision, so neither can enter this execution.
const zeroRemediationSource = base();
zeroRemediationSource.profiles = [
  { source_id: 'profile-stc', name_ar: 'STC TEL 0510611468', name_en: 'STC', supplier_source_id: supplierId, baseer_category_code: 'E3-3', expected_amount: '0.0000', interval_months: '1', status: 'active', service_number: '', notes: '' },
  { source_id: 'profile-tobacco-zero', name_ar: 'رخصة التبغ', name_en: '', supplier_source_id: supplierId, baseer_category_code: 'E3-3', expected_amount: '0.0000', interval_months: '1', status: 'active', service_number: '', notes: '' },
  { source_id: 'profile-tobacco-service', name_ar: 'tobacco service license', name_en: '', supplier_source_id: supplierId, baseer_category_code: 'E3-3', expected_amount: '500.0000', interval_months: '1', status: 'active', service_number: '', notes: '' },
];
zeroRemediationSource.payments = [
  { source_id: 'payment-stc', profile_source_id: 'profile-stc', supplier_source_id: supplierId, baseer_category_code: 'E3-3', vault_source_id: vaultId, document_number: 'STC-1', transaction_date: '2026-06-20T00:00:00.000Z', net_amount: '188.5826', tax_amount: '28.2874', gross_amount: '216.8700', status: 'active', notes: '' },
];
const zeroRemediationPlan = planApprovedZeroExpectedRecurringRemediation(planNurixRecurringExpenseRows(zeroRemediationSource));
assert.deepEqual(zeroRemediationPlan.profiles.map((profile) => profile.sourceId), ['profile-stc']);
assert.equal(zeroRemediationPlan.profiles[0]?.expectedAmount, '216.8700');
assert.deepEqual(zeroRemediationPlan.payments.map((payment) => [payment.sourceId, payment.status, payment.writeCoverage]), [['payment-stc', 'POST', true]]);
assert.equal(zeroRemediationPlan.postedGrossAmount, '216.8700');

const conflictingZeroCoverage = structuredClone(zeroRemediationSource);
conflictingZeroCoverage.payments.push({ ...conflictingZeroCoverage.payments[0]!, source_id: 'payment-stc-duplicate', document_number: 'STC-2' });
const conflictingZeroPlan = planApprovedZeroExpectedRecurringRemediation(planNurixRecurringExpenseRows(conflictingZeroCoverage));
assert.ok(conflictingZeroPlan.payments.every((payment) => payment.status === 'REVIEW_REQUIRED' && payment.reviewCode === 'UNPROVEN_CONCURRENT_COVERAGE'));
assert.equal(conflictingZeroPlan.postedGrossAmount, '0.0000');

// The zero-value remediation version is kept in execution metadata. Its
// approval audit uses a fixed short action/request key that cannot overflow
// AuditEvent's bounded varchar columns.
const zeroAuditEvents: any[] = [];
const zeroPrepareWriter = new NurixExcelRecurringMigrationService({
  inTenantTransaction: async (_tenantId: string, action: any) => action({
    nurixExcelFinancialExecution: { findFirst: async () => null, create: async () => ({}) },
    nurixExcelFinancialWave: { create: async () => ({}) },
    nurixExcelFinancialItem: { createMany: async () => ({ count: 1 }) },
    auditEvent: { create: async ({ data }: any) => zeroAuditEvents.push(data) },
  }),
} as never, {} as never, {} as never, {} as never);
await (zeroPrepareWriter as any).prepare(
  { tenantId: 'tenant', actorUserId: 'owner' },
  { id: 'package', targetCompanyId: 'company' },
  zeroRemediationPlan,
  undefined,
  10,
  'nurix-excel-historical-recurring-expense-zero-expected-remediation/v3',
);
assert.equal(zeroAuditEvents[0]?.action, 'nurix_excel.recurring_zero_remediation');
assert.ok(zeroAuditEvents[0]?.action.length <= 120);
assert.ok(zeroAuditEvents[0]?.requestId.length <= 120);

// Coverage is a child of the actual outflow document. A locally generated ID
// becomes valid only after that document has been created in the same tenant
// and company. This also protects a resumed wave: downstream lineage uses the
// returned document ID, not an assumed pre-insert value.
const paymentOrder: string[] = [];
let coverageRows: any[] = [];
let allocationDocumentId: string | undefined;
let sourceMapDocumentId: string | undefined;
let itemDocumentId: string | undefined;
let cashSourceId: string | undefined;
const paymentWriter = new NurixExcelRecurringMigrationService(
  {} as never,
  {} as never,
  {
    postInTransaction: async () => {
      paymentOrder.push('journal');
      return { journalEntryId: 'journal', ledgerRevision: 1 };
    },
  } as never,
  {
    recordInTransaction: async (_tx: unknown, _context: unknown, input: any) => {
      paymentOrder.push('cash');
      cashSourceId = input.sourceId;
    },
  } as never,
);
(paymentWriter as any).supplier = async () => ({ targetId: 'supplier-target' });
(paymentWriter as any).vault = async () => ({ id: 'vault-target', accountId: 'vault-account', paymentMethod: 'BANK_TRANSFER' });
const posted = await (paymentWriter as any).writePayment({
  nurixExcelFinancialSourceMap: { findFirst: async ({ where }: any) => where.executionId ? ({ targetId: 'profile-target' }) : null, createMany: async (input: any) => { paymentOrder.push('source-map'); sourceMapDocumentId = input.data[0].targetId; } },
  financeRecurringExpenseProfile: { findFirst: async () => ({ id: 'profile-target', supplierId: 'supplier-target', categoryId: 'category-target', intervalMonths: 1 }) },
  financeCategory: { findFirst: async () => ({ id: 'category-target', code: 'E3-3', nameAr: 'مصروف', nameEn: null, kind: 'EXPENSE', accountId: 'expense-account' }) },
  financeJournalEntry: { findFirst: async () => null },
  financeAccount: { findFirst: async () => ({ id: 'vat-account' }) },
  financeSupplier: { findFirst: async () => ({ nameAr: 'المورد', nameEn: null }) },
  financeOutflowDocument: {
    create: async (input: any) => {
      paymentOrder.push('document');
      assert.deepEqual(input.select, { id: true, tenantId: true, companyId: true });
      return { id: 'actual-document-id', tenantId: 'tenant', companyId: 'company' };
    },
  },
  financeRecurringExpenseCoverage: {
    createMany: async (input: any) => { paymentOrder.push('coverage'); coverageRows = input.data; return { count: input.data.length }; },
  },
  financeOutflowAllocation: {
    create: async (input: any) => { paymentOrder.push('allocation'); allocationDocumentId = input.data.documentId; },
  },
  nurixExcelFinancialItem: {
    update: async (input: any) => { paymentOrder.push('item'); itemDocumentId = input.data.targetId; },
  },
}, { tenantId: 'tenant', companyId: 'company', actorUserId: 'owner' }, 'package', 'execution', 'payment-item', plan.payments[0]!, new Map([[profileId, plan.profiles[0]!]]), plan.suppliers, plan.vaults);
assert.equal(posted, 'POSTED');
assert.ok(paymentOrder.indexOf('document') < paymentOrder.indexOf('coverage'));
assert.deepEqual(coverageRows.map((row) => row.documentId), ['actual-document-id']);
assert.equal(allocationDocumentId, 'actual-document-id');
assert.equal(cashSourceId, 'actual-document-id');
assert.equal(sourceMapDocumentId, 'actual-document-id');
assert.equal(itemDocumentId, 'actual-document-id');

console.log('nurix recurring-expense migration policy verification passed');
