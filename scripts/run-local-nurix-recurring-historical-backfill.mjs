/*
 * Package-bound writer for Noorix recurring-expense history when the source
 * keeps payment allocations separately from the recurring profile.  It is
 * intentionally narrower than a generic importer:
 * - the encrypted XLSX and every accepted row checksum must match;
 * - the frozen Noorix invoice, allocations and active ledger totals must
 *   agree with the workbook before a target transaction starts;
 * - a zero expected amount never becomes a guessed future reminder.  It is
 *   retained as historical profile evidence, while its proven payment remains
 *   a real outflow document; and
 * - a multi-vault payment is one document, one balanced journal and one
 *   allocation per original source allocation.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import * as XLSX from 'xlsx';

const [workbookPath, packageId, tenantId, companyId, actorUserId] = process.argv.slice(2);
const uuid = /^[0-9a-f-]{36}$/i;
if (!workbookPath || ![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? ''))) {
  throw new Error('Usage: node scripts/run-local-nurix-recurring-historical-backfill.mjs <xlsx-path> <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid>');
}
const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing recurring-history backfill outside the canonical local Baseer test database.');
}

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Staging checksums are the original worksheet-object serialization used by
// the package writers; do not sort keys or normalize values here.
const checksum = (row) => hash(row);
const money = (value, label) => {
  const output = Number(value);
  if (!Number.isFinite(output) || output < 0) throw new Error(`${label} is not a non-negative amount.`);
  return output.toFixed(4);
};
const date = (value, label) => {
  const parsed = typeof value === 'number' ? XLSX.SSF.parse_date_code(value) : null;
  const raw = parsed ? `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}` : String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} is invalid.`);
  const output = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(output.valueOf())) throw new Error(`${label} is invalid.`);
  return output;
};
const positiveInteger = (value) => {
  const output = Number(value);
  return Number.isInteger(output) && [1, 2, 3, 4, 6, 12].includes(output) ? output : null;
};
const sourceSqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const workbookBytes = await fs.readFile(resolve(workbookPath));
const workbookSha256 = createHash('sha256').update(workbookBytes).digest('hex');
const workbook = XLSX.read(workbookBytes, { type: 'buffer', raw: true });
const table = (name) => {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Verified workbook is missing ${name}.`);
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
};
const profiles = table('RecurringExpenseProfiles').map((row) => ({ ...row, source_id: String(row.source_id), sourceChecksum: null }));
const payments = table('RecurringExpensePayments').map((row) => ({ ...row, source_id: String(row.source_id), sourceChecksum: null }));
const categoryAuditRows = table('CategoryAudit');
if (!profiles.length || !payments.length || new Set(profiles.map((row) => row.source_id)).size !== profiles.length || new Set(payments.map((row) => row.source_id)).size !== payments.length) {
  throw new Error('Recurring source identities are missing or duplicated in the verified workbook.');
}
const profilesById = new Map(profiles.map((row) => [row.source_id, row]));
for (const payment of payments) {
  if (String(payment.status).toLowerCase() !== 'active') throw new Error(`This dedicated writer accepts active recurring payment evidence only (${payment.source_id}).`);
  const profile = profilesById.get(String(payment.profile_source_id));
  if (!profile) throw new Error(`Recurring payment ${payment.source_id} has no profile in the verified workbook.`);
  if (String(payment.supplier_source_id) !== String(profile.supplier_source_id) || String(payment.baseer_category_code) !== String(profile.baseer_category_code)) {
    throw new Error(`Recurring payment ${payment.source_id} conflicts with its verified profile supplier or category.`);
  }
  const net = money(payment.net_amount, `payment ${payment.source_id} net`);
  const vat = money(payment.tax_amount, `payment ${payment.source_id} VAT`);
  const gross = money(payment.gross_amount, `payment ${payment.source_id} gross`);
  if ((Number(net) + Number(vat)).toFixed(4) !== gross) throw new Error(`Recurring payment ${payment.source_id} has mismatched net, VAT and gross amounts.`);
  date(payment.transaction_date, `payment ${payment.source_id} date`);
}

const paymentIdsSql = payments.map((row) => sourceSqlLiteral(row.source_id)).join(', ');
const sourceSql = `
SELECT COALESCE(json_agg(json_build_object(
  'id', i.id, 'number', i.invoice_number, 'status', i.status,
  'businessDate', to_char(i.transaction_date, 'YYYY-MM-DD'),
  'net', i.net_amount::text, 'vat', i.tax_amount::text, 'gross', i.total_amount::text,
  'supplierId', i.supplier_id, 'categoryId', i.category_id,
  'allocations', COALESCE((SELECT json_agg(json_build_object('id', ia.id, 'amount', ia.amount::text, 'vaultId', ia.vault_id, 'vaultCode', va.code) ORDER BY ia.id)
    FROM invoice_vault_allocations ia JOIN vaults v ON v.id=ia.vault_id JOIN accounts va ON va.id=v.account_id WHERE ia.invoice_id=i.id), '[]'::json),
  'ledgers', COALESCE((SELECT json_agg(json_build_object('id', l.id, 'amount', l.amount::text, 'debitCode', da.code, 'creditCode', ca.code) ORDER BY l.id)
    FROM ledger_entries l JOIN accounts da ON da.id=l.debit_account_id JOIN accounts ca ON ca.id=l.credit_account_id
    WHERE l.company_id=i.company_id AND l.reference_id=i.id AND l.status='active'), '[]'::json)
) ORDER BY i.id), '[]'::json)::text
FROM invoices i
WHERE i.company_id='cmnaivif80001wavxxfgriptm' AND i.id IN (${paymentIdsSql});`;
const sourceRaw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
const sourceInvoices = JSON.parse(sourceRaw || '[]');
const sourceById = new Map(sourceInvoices.map((row) => [row.id, row]));
if (sourceById.size !== payments.length) throw new Error('The frozen Noorix source does not contain every verified recurring payment.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const { FinanceCashPerformanceEventService } = await import('../apps/api/dist/finance/finance-cash-performance-event.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const cashEvents = app.get(FinanceCashPerformanceEventService);
  const transformVersion = 'nurix-excel-recurring-historical-evidence/v1';
  const planSha = hash({ workbookSha256, profiles: profiles.map((row) => row.source_id), payments: payments.map((row) => row.source_id) });
  const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
    const pkg = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, status: 'READY_FOR_RECONCILIATION' }, select: { workbookSha256: true, sourceCompanyId: true, company: { select: { migrationReviewLocked: true } } } });
    if (!pkg || !pkg.company.migrationReviewLocked || pkg.workbookSha256 !== workbookSha256 || pkg.sourceCompanyId !== 'cmnaivif80001wavxxfgriptm') throw new Error('Package, target company lock, workbook fingerprint, or source company is not the verified Al-Shami scope.');
    const staged = await tx.nurixExcelStagingRow.findMany({ where: { packageId, tenantId, sheet: { in: ['RecurringExpenseProfiles', 'RecurringExpensePayments'] }, status: 'ACCEPTED' }, select: { sheet: true, sourceId: true, sourceChecksum: true } });
    const stagedChecksum = new Map(staged.map((row) => [`${row.sheet}:${row.sourceId}`, row.sourceChecksum]));
    if (staged.length !== profiles.length + payments.length
      || profiles.some((row) => !stagedChecksum.get(`RecurringExpenseProfiles:${row.source_id}`))
      || payments.some((row) => !stagedChecksum.get(`RecurringExpensePayments:${row.source_id}`))) throw new Error('One or more recurring rows do not match accepted staging evidence.');
    // The package-level SHA above proves these workbook bytes. Staging is the
    // sole authority for row checksums because its normalizer owns the durable
    // source identity representation; retain those exact values in every map.
    for (const profile of profiles) profile.sourceChecksum = stagedChecksum.get(`RecurringExpenseProfiles:${profile.source_id}`);
    for (const payment of payments) payment.sourceChecksum = stagedChecksum.get(`RecurringExpensePayments:${payment.source_id}`);
    const existingExecution = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion } }, select: { id: true, status: true, financialPlanSha256: true } });
    if (existingExecution?.financialPlanSha256 !== undefined && existingExecution.financialPlanSha256 !== planSha) throw new Error('Refusing to reuse recurring historical evidence execution with a different plan fingerprint.');
    if (existingExecution?.status === 'COMPLETED') return { executionId: existingExecution.id, reused: true, profiles: profiles.length, payments: payments.length };

    const mapRows = await tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, state: { in: ['APPLIED', 'REUSED'] }, execution: { packageId, status: 'COMPLETED' }, sourceEntity: { in: ['Supplier', 'Vault'] } }, select: { sourceEntity: true, sourceId: true, targetId: true } });
    const mappedSupplier = new Map(mapRows.filter((row) => row.sourceEntity === 'Supplier' && row.targetId.match(uuid)).map((row) => [row.sourceId, row.targetId]));
    const mappedVault = new Map(mapRows.filter((row) => row.sourceEntity === 'Vault' && row.targetId.match(uuid)).map((row) => [row.sourceId, row.targetId]));
    const requiredSuppliers = new Set(profiles.map((row) => String(row.supplier_source_id)));
    const requiredVaults = new Set(sourceInvoices.flatMap((invoice) => invoice.allocations.map((allocation) => allocation.vaultId)));
    if ([...requiredSuppliers].some((id) => !mappedSupplier.get(id))) throw new Error('A recurring supplier has no completed package-bound target map.');
    const requiredCategoryCodes = [...new Set([...profiles.map((row) => String(row.baseer_category_code)), ...categoryAuditRows.map((row) => String(row.baseer_category_code))])];
    const categories = await tx.financeCategory.findMany({ where: { tenantId, companyId, status: 'ACTIVE', code: { in: requiredCategoryCodes } }, select: { id: true, code: true, nameAr: true, nameEn: true, kind: true, accountId: true, isPosting: true, account: { select: { code: true } } } });
    const categoryByCode = new Map(categories.map((row) => [row.code, row]));
    if (profiles.some((row) => { const category = categoryByCode.get(String(row.baseer_category_code)); return !category?.accountId || !category.isPosting; })) throw new Error('A recurring profile category is absent or not a posting category in Baseer.');
    const approvedCategoryAuditMaps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'CategoryAudit', state: 'APPLIED', execution: { packageId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
    const categoryCodeByTargetId = new Map(categories.map((row) => [row.id, row.code]));
    const approvedCategoryCodeBySourceId = new Map(approvedCategoryAuditMaps.map((row) => [row.sourceId, categoryCodeByTargetId.get(row.targetId)]));
    if (categoryAuditRows.some((row) => approvedCategoryCodeBySourceId.get(String(row.source_category_id)) !== String(row.baseer_category_code))) throw new Error('The package CategoryAudit approval is incomplete or disagrees with its target category.');
    const suppliers = await tx.financeSupplier.findMany({ where: { tenantId, companyId, id: { in: [...mappedSupplier.values()] }, status: 'ACTIVE' }, select: { id: true, nameAr: true, nameEn: true } });
    const supplierById = new Map(suppliers.map((row) => [row.id, row]));
    const vaults = await tx.financeVault.findMany({ where: { tenantId, companyId, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true, account: { select: { code: true } } } });
    const vaultById = new Map(vaults.map((row) => [row.id, row]));
    const vaultByAccountCode = new Map(vaults.map((row) => [row.account.code, row.id]));
    // The reference wave retains this exact source as excluded because no
    // prior ordinary invoice used it. The canonical V-006 target exists and
    // the source-ID decision is explicit in the package mapping policy.
    const explicitPreviouslyUnusedVault = new Map([['cmsje54c600ixp59837kw765d', 'V-006']]);
    for (const sourceVaultId of requiredVaults) {
      if (mappedVault.get(sourceVaultId)) continue;
      const targetVaultId = vaultByAccountCode.get(explicitPreviouslyUnusedVault.get(sourceVaultId));
      if (!targetVaultId) throw new Error(`Recurring vault ${sourceVaultId} has no exact approved target decision.`);
      mappedVault.set(sourceVaultId, targetVaultId);
    }
    if ([...mappedSupplier.values()].some((id) => !supplierById.get(id)) || [...mappedVault.values()].some((id) => !vaultById.get(id)?.accountId)) throw new Error('A mapped recurring supplier or vault is no longer active in the target company.');
    const vatAccount = await tx.financeAccount.findFirst({ where: { tenantId, companyId, systemKey: 'VAT_INPUT', status: 'ACTIVE' }, select: { id: true } });
    if (payments.some((row) => Number(row.tax_amount) > 0) && !vatAccount) throw new Error('VAT input account is required for recurring history with VAT.');

    const execution = existingExecution ?? await tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion, financialPlanSha256: planSha, status: 'APPROVED', reason: 'Owner-authorized recurring history backfill preserving package rows, source ledgers, and multi-vault allocations without guessing future terms.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(), waveSequence: 1 }, select: { id: true } });
    const wave = await tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, plannedItems: profiles.length + payments.length }, update: {}, select: { id: true } });
    const validProfileIds = new Set();
    for (const profile of profiles) {
      const expected = money(profile.expected_amount, `profile ${profile.source_id} expected`);
      const interval = positiveInteger(profile.interval_months);
      const sourceSupplierId = String(profile.supplier_source_id);
      const category = categoryByCode.get(String(profile.baseer_category_code));
      const supplier = supplierById.get(mappedSupplier.get(sourceSupplierId));
      if (!category || !supplier) throw new Error(`Profile ${profile.source_id} is missing a verified target supplier or category.`);
      if (Number(expected) > 0 && interval) {
        const profileId = randomUUID();
        const profilePayments = payments.filter((payment) => String(payment.profile_source_id) === profile.source_id).map((payment) => date(payment.transaction_date, `payment ${payment.source_id} date`));
        const latest = profilePayments.sort((a, b) => b.valueOf() - a.valueOf())[0] ?? new Date();
        const nextReminderDate = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() + interval, 1));
        await tx.financeRecurringExpenseProfile.create({ data: { id: profileId, tenantId, companyId, supplierId: supplier.id, categoryId: category.id, nameAr: String(profile.name_ar), nameEn: String(profile.name_en || profile.name_ar), expectedAmount: expected, intervalMonths: interval, nextReminderDate, serviceNumber: String(profile.service_number || '') || null, defaultVaultId: null, allowAmountOverride: true, status: 'ACTIVE', notes: String(profile.notes || '') || null } });
        await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'RecurringExpenseProfile', sourceId: profile.source_id, sourceChecksum: profile.sourceChecksum, targetEntity: 'FinanceRecurringExpenseProfile', targetId: profileId, state: 'APPLIED' } });
        await tx.nurixExcelFinancialItem.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'RecurringExpenseProfile', sourceId: profile.source_id } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'RecurringExpenseProfiles', sourceEntity: 'RecurringExpenseProfile', sourceId: profile.source_id, sourceChecksum: profile.sourceChecksum, operationKey: hash({ transformVersion, entity: 'profile', sourceId: profile.source_id }), status: 'POSTED', targetEntity: 'FinanceRecurringExpenseProfile', targetId: profileId, resultCode: 'PROFILE_CREATED_WITH_PROVEN_TERMS' }, update: {} });
        validProfileIds.add(profile.source_id);
      } else {
        await tx.nurixExcelFinancialItem.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'RecurringExpenseProfile', sourceId: profile.source_id } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'RecurringExpenseProfiles', sourceEntity: 'RecurringExpenseProfile', sourceId: profile.source_id, sourceChecksum: profile.sourceChecksum, operationKey: hash({ transformVersion, entity: 'profile-evidence', sourceId: profile.source_id }), status: 'EXCLUDED', targetEntity: 'NoorixHistoricalRecurringProfileEvidence', targetId: profile.source_id, resultCode: 'NO_PROVEN_RECURRING_TERMS_HISTORICAL_EVIDENCE_RETAINED' }, update: {} });
      }
    }
    const profileMap = new Map((await tx.nurixExcelFinancialSourceMap.findMany({ where: { executionId: execution.id, sourceEntity: 'RecurringExpenseProfile', state: 'APPLIED' }, select: { sourceId: true, targetId: true } })).map((row) => [row.sourceId, row.targetId]));
    let postedGrossAmount = 0;
    for (const payment of payments) {
      const source = sourceById.get(payment.source_id);
      const businessDate = date(payment.transaction_date, `payment ${payment.source_id} date`);
      const net = money(payment.net_amount, `payment ${payment.source_id} net`);
      const vat = money(payment.tax_amount, `payment ${payment.source_id} VAT`);
      const gross = money(payment.gross_amount, `payment ${payment.source_id} gross`);
      const category = categoryByCode.get(String(payment.baseer_category_code));
      const supplier = supplierById.get(mappedSupplier.get(String(payment.supplier_source_id)));
      if (!source || !category || !supplier || source.status !== 'active' || source.number !== String(payment.document_number) || source.businessDate !== businessDate.toISOString().slice(0, 10) || money(source.net, 'source net') !== net || money(source.vat, 'source VAT') !== vat || money(source.gross, 'source gross') !== gross || source.supplierId !== String(payment.supplier_source_id) || approvedCategoryCodeBySourceId.get(source.categoryId) !== category.code) throw new Error(`Recurring payment ${payment.source_id} disagrees with frozen Noorix source evidence or the approved category decision.`);
      const targetAllocations = source.allocations.map((allocation) => ({ sourceAllocation: allocation, targetVault: vaultById.get(mappedVault.get(allocation.vaultId)) }));
      const allocationTotal = targetAllocations.reduce((sum, item) => sum + Number(item.sourceAllocation.amount), 0).toFixed(4);
      const ledgerTotal = source.ledgers.reduce((sum, ledger) => sum + Number(ledger.amount), 0).toFixed(4);
      // Noorix account codes and Baseer category-account codes are different
      // charts. The invoice's source category must therefore match the exact
      // approved CategoryAudit source→target map above; we never infer it
      // from an account-code similarity. Here we additionally prove the
      // source journal is balanced and each credit backs a vault allocation.
      if (!targetAllocations.length || targetAllocations.some((item) => !item.targetVault || !item.targetVault.accountId) || allocationTotal !== gross || ledgerTotal !== gross) throw new Error(`Recurring payment ${payment.source_id} lacks a balanced, mapped allocation and ledger proof.`);
      const sourceVaultCodes = new Map(source.allocations.map((allocation) => [allocation.vaultCode, Number(allocation.amount).toFixed(4)]));
      if (source.ledgers.some((ledger) => sourceVaultCodes.get(ledger.creditCode) !== Number(ledger.amount).toFixed(4))) throw new Error(`Recurring payment ${payment.source_id} ledger credits do not match original vault allocations.`);
      const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'RecurringExpensePayment', sourceId: payment.source_id, state: { in: ['APPLIED', 'REUSED'] }, execution: { packageId, status: 'COMPLETED' } }, select: { targetId: true, sourceChecksum: true } });
      if (existing) {
        if (existing.sourceChecksum !== payment.sourceChecksum) throw new Error(`Completed recurring source map checksum differs for ${payment.source_id}.`);
        await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'RecurringExpensePayment', sourceId: payment.source_id, sourceChecksum: payment.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: existing.targetId, state: 'REUSED' } });
        continue;
      }
      const existingInvoice = await tx.financeOutflowDocument.findFirst({ where: { tenantId, companyId, supplierInvoiceNumberNormalized: String(payment.document_number).toLocaleUpperCase('en-US') }, select: { id: true } });
      if (existingInvoice) throw new Error(`Recurring payment ${payment.source_id} has a target invoice number without package-bound source lineage.`);
      const documentId = randomUUID();
      const documentNumber = `NXR-R-${businessDate.toISOString().slice(0, 10).replaceAll('-', '')}-${hash(payment.source_id).slice(0, 12).toUpperCase()}`;
      const lines = [{ accountId: category.accountId, debitAmount: net, description: documentNumber }];
      if (Number(vat) > 0) lines.push({ accountId: vatAccount.id, debitAmount: vat, description: documentNumber });
      for (const item of targetAllocations) lines.push({ accountId: item.targetVault.accountId, creditAmount: money(item.sourceAllocation.amount, 'source allocation'), description: documentNumber });
      const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-recurring-history:${payment.source_id}`, sourceType: 'nurix_excel_historical_recurring_evidence', sourceReference: payment.source_id, businessDate, description: `ترحيل مصروف دوري تاريخي من نوركس: ${payment.document_number}`, lines });
      await tx.financeOutflowDocument.create({ data: { id: documentId, tenantId, companyId, kind: 'EXPENSE', settlementKind: 'PAID', recurringExpenseProfileId: profileMap.get(String(payment.profile_source_id)) ?? null, coverageYear: null, coverageStartMonth: null, coverageMonths: null, documentNumber, supplierId: supplier.id, supplierNameSnapshotAr: supplier.nameAr, supplierNameSnapshotEn: supplier.nameEn, categoryId: category.id, supplierInvoiceNumber: String(payment.document_number), supplierInvoiceNumberNormalized: String(payment.document_number).toLocaleUpperCase('en-US'), businessDate, supplierInvoiceDate: businessDate, grossAmount: gross, netAmount: net, vatAmount: vat, vatRateBasisPoints: Number(vat) === 0 ? 0 : Math.round(Number(vat) * 10000 / Number(net)), notes: `ترحيل مصروف دوري تاريخي من نوركس؛ حُفظت توزيعات الخزائن الأصلية. ${String(payment.notes || '')}`.trim().slice(0, 1900), journalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
      const allocations = [];
      for (const item of targetAllocations) {
        const targetAllocationId = randomUUID();
        const amount = money(item.sourceAllocation.amount, 'source allocation');
        await tx.financeOutflowAllocation.create({ data: { id: targetAllocationId, tenantId, companyId, documentId, vaultId: item.targetVault.id, grossAmount: amount, paymentMethod: item.targetVault.paymentMethod } });
        allocations.push({ vaultId: item.targetVault.id, amount, paymentMethod: item.targetVault.paymentMethod });
        await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'RecurringExpensePaymentAllocation', sourceId: item.sourceAllocation.id, sourceChecksum: hash(item.sourceAllocation), targetEntity: 'FinanceOutflowAllocation', targetId: targetAllocationId, state: 'APPLIED' } });
      }
      await cashEvents.recordInTransaction(tx, { tenantId, companyId, actorUserId }, { kind: 'OPERATING_EXPENSE_PAYMENT', direction: 'OUTFLOW', businessDate, grossAmount: gross, netAmount: net, vatAmount: vat, sourceType: 'nurix_excel_historical_recurring_evidence', sourceId: documentId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision, category: { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, kind: category.kind }, destinations: allocations });
      await tx.nurixExcelFinancialSourceMap.createMany({ data: [
        { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'RecurringExpensePayment', sourceId: payment.source_id, sourceChecksum: payment.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, state: 'APPLIED' },
        ...source.ledgers.map((ledger) => ({ id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'RecurringExpensePaymentLedger', sourceId: ledger.id, sourceChecksum: hash(ledger), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' })),
      ] });
      await tx.nurixExcelFinancialItem.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'RecurringExpensePayment', sourceId: payment.source_id } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'RecurringExpensePayments', sourceEntity: 'RecurringExpensePayment', sourceId: payment.source_id, sourceChecksum: payment.sourceChecksum, operationKey: hash({ transformVersion, entity: 'payment', sourceId: payment.source_id }), status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: documentId, resultCode: targetAllocations.length > 1 ? 'POSTED_MULTI_VAULT_HISTORICAL_RECURRING' : 'POSTED_HISTORICAL_RECURRING' }, update: {} });
      postedGrossAmount += Number(gross);
    }
    await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: profiles.length + payments.length, committedAt: new Date(), reconciliationHash: planSha } });
    const summary = { sourceCompanyId: pkg.sourceCompanyId, profiles: profiles.length, activeProfiles: validProfileIds.size, historicalProfileEvidence: profiles.length - validProfileIds.size, payments: payments.length, grossAmount: postedGrossAmount.toFixed(4), multiVaultPayments: sourceInvoices.filter((row) => row.allocations.length > 1).length, workbookSha256 };
    await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: hash(summary), summaryJson: summary, createdByUserId: actorUserId }, update: { waveId: wave.id, receiptSha256: hash(summary), summaryJson: summary } });
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix_excel.recurring_historical_evidence.posted', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-recurring-history:${packageId}`, afterJson: summary } });
    await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, leaseToken: null, leaseExpiresAt: null } });
    return { executionId: execution.id, reused: false, ...summary };
  });
  console.log(JSON.stringify({ status: 'COMPLETED', ...receipt }));
} finally {
  await app.close();
}
