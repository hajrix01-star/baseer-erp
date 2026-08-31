/**
 * Controlled Noorix -> Baseer writer for Al-Shami invoices that were omitted
 * from the XLSX package because Noorix did not retain a category_id.
 *
 * This deliberately does NOT invent a category.  It only posts a candidate
 * when earlier, already-mapped invoices for the same Noorix supplier and kind
 * resolve to one active Baseer posting category.  Ambiguous/no-history rows
 * remain review-only in the receipt.
 *
 * Usage:
 *   node scripts/run-local-nurix-al-shami-uncategorized-outflows-backfill.mjs \
 *     <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> \
 *     DRY_RUN|APPLY_APPROVED_NOORIX_AL_SHAMI_UNCATEGORIZED_OUTFLOWS_V1
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-uncategorized-outflows/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_UNCATEGORIZED_OUTFLOWS_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const UUID = /^[0-9a-f-]{36}$/i;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value, label = 'amount') => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}.`);
  return parsed.toFixed(4);
};
const moneyEquals = (left, right) => fixed(left) === fixed(right);
const day = (value) => new Date(`${value}T00:00:00.000Z`);
const sum = (rows) => fixed(rows.reduce((total, row) => total + Number(row.gross), 0));

// These are control totals, not source IDs.  Source IDs are always discovered
// from the frozen Noorix snapshot so a changed source fails closed.
const CONTROL = Object.freeze({
  candidates: 30,
  candidatesGross: '18248.6000',
  eligible: 21,
  eligibleGross: '14570.1000',
  review: 9,
  reviewGross: '3678.5000',
});

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => UUID.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-uncategorized-outflows-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const sourceIndexSql = `
SELECT coalesce(json_agg(json_build_object(
  'sourceId', i.id,
  'invoiceNumber', i.invoice_number,
  'supplierSourceId', i.supplier_id,
  'kind', i.kind,
  'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
  'categorySourceId', i.category_id,
  'gross', i.total_amount::text,
  'status', i.status
) ORDER BY i.transaction_date, i.id), '[]'::json)::text
FROM invoices i
WHERE i.company_id = '${SOURCE_COMPANY_ID}'
  AND i.status = 'active'
  AND i.kind IN ('purchase', 'expense');`;

const readSourceJson = (sql, label) => {
  const raw = execFileSync('docker', [
    'exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8' }).trim();
  if (!raw) throw new Error(`No Noorix ${label} was returned.`);
  return JSON.parse(raw);
};

const sourceIndex = readSourceJson(sourceIndexSql, 'invoice index');
if (!Array.isArray(sourceIndex) || !sourceIndex.length) throw new Error('No active Noorix purchase/expense invoices were returned.');
for (const row of sourceIndex) {
  if (!/^[a-z0-9]+$/i.test(row.sourceId ?? '') || !row.invoiceNumber || !row.supplierSourceId || !['purchase', 'expense'].includes(row.kind)
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.businessDate ?? '') || Number(fixed(row.gross, row.sourceId)) <= 0 || row.status !== 'active') {
    throw new Error(`Noorix invoice index row ${row.sourceId ?? 'unknown'} is incomplete.`);
  }
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const { DocumentSerialService } = await import('../apps/api/dist/core-controls/document-serial.service.js');
const { FinanceCashPerformanceEventService } = await import('../apps/api/dist/finance/finance-cash-performance-event.service.js');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const serials = app.get(DocumentSerialService);
  const cashEvents = app.get(FinanceCashPerformanceEventService);

  const target = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({
      where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' },
      select: { id: true },
    });
    if (!packageRow) throw new Error('The selected package is not the approved Al-Shami package.');

    const invoiceMaps = await tx.nurixExcelFinancialSourceMap.findMany({
      where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', state: 'APPLIED' },
      select: { executionId: true, sourceId: true, targetId: true },
    });
    const documentIds = [...new Set(invoiceMaps.map((row) => row.targetId).filter((value) => UUID.test(value)))];
    const [documents, categories, supplierMaps, vaultMaps, profile] = await Promise.all([
      tx.financeOutflowDocument.findMany({ where: { tenantId, companyId, id: { in: documentIds }, status: 'POSTED' }, select: { id: true, categoryId: true, kind: true } }),
      // Historical documents may point to a parent category, but a new
      // financial write must only reuse a posting leaf.  A parent precedent
      // is evidence for review, never permission to invent one of its leaves.
      tx.financeCategory.findMany({ where: { tenantId, companyId, status: 'ACTIVE', isPosting: true }, select: { id: true, accountId: true, code: true, nameAr: true, nameEn: true, kind: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Supplier', targetEntity: 'FinanceSupplier', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.companyFinanceProfile.findFirst({ where: { tenantId, companyId }, select: { vatAccountingEnabled: true, vatRateBasisPoints: true } }),
    ]);
    if (!profile) throw new Error('The target financial profile is unavailable.');
    const supplierTargetIds = [...new Set(supplierMaps.map((row) => row.targetId).filter((value) => UUID.test(value)))];
    const vaultTargetIds = [...new Set(vaultMaps.map((row) => row.targetId).filter((value) => UUID.test(value)))];
    const [activeSuppliers, activeVaults] = await Promise.all([
      tx.financeSupplier.findMany({ where: { tenantId, companyId, id: { in: supplierTargetIds }, status: 'ACTIVE' }, select: { id: true } }),
      tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: vaultTargetIds }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true } }),
    ]);
    const activeSupplierIds = new Set(activeSuppliers.map((row) => row.id));
    const activeVaultIds = new Set(activeVaults.map((row) => row.id));
    const documentById = new Map(documents.map((row) => [row.id, row]));
    const mappedDocumentBySource = new Map();
    for (const map of invoiceMaps) {
      const document = documentById.get(map.targetId);
      if (document) mappedDocumentBySource.set(map.sourceId, { ...document, executionId: map.executionId });
    }
    return {
      mappedDocumentBySource,
      categoryById: new Map(categories.map((row) => [row.id, row])),
      supplierIdBySource: new Map(supplierMaps.filter((row) => activeSupplierIds.has(row.targetId)).map((row) => [row.sourceId, row.targetId])),
      vaultIdBySource: new Map(vaultMaps.filter((row) => activeVaultIds.has(row.targetId)).map((row) => [row.sourceId, row.targetId])),
      profile,
    };
  });

  const candidates = sourceIndex.filter((row) => !row.categorySourceId && !target.mappedDocumentBySource.has(row.sourceId));
  if (candidates.length !== CONTROL.candidates || sum(candidates) !== CONTROL.candidatesGross) {
    throw new Error(`The Noorix uncategorized candidate control set changed: ${candidates.length}/${sum(candidates)}.`);
  }

  const eligible = [];
  const review = [];
  for (const candidate of candidates) {
    const categoryIds = new Set();
    for (const previous of sourceIndex) {
      // "Previous" means an already imported source invoice (not a later
      // operation in this batch).  Noorix allows historical back-dating, so
      // transaction_date cannot safely decide whether the supplier's proven
      // category existed before the omitted row.
      if (previous.supplierSourceId !== candidate.supplierSourceId || previous.kind !== candidate.kind) continue;
      const mapped = target.mappedDocumentBySource.get(previous.sourceId);
      if (!mapped || mapped.kind !== candidate.kind.toUpperCase() || !mapped.categoryId) continue;
      const category = target.categoryById.get(mapped.categoryId);
      if (category && category.kind === candidate.kind.toUpperCase()) categoryIds.add(category.id);
    }
    if (categoryIds.size === 1) eligible.push({ ...candidate, categoryId: [...categoryIds][0] });
    else review.push({ ...candidate, reviewReason: categoryIds.size ? 'SUPPLIER_CATEGORY_AMBIGUOUS' : 'SUPPLIER_CATEGORY_HISTORY_MISSING' });
  }
  if (eligible.length !== CONTROL.eligible || sum(eligible) !== CONTROL.eligibleGross || review.length !== CONTROL.review || sum(review) !== CONTROL.reviewGross) {
    throw new Error(`The consistent-supplier category plan changed: eligible=${eligible.length}/${sum(eligible)}, review=${review.length}/${sum(review)}.`);
  }

  const eligibleIds = eligible.map((row) => row.sourceId);
  const sourceIdList = eligibleIds.map((id) => `'${id}'`).join(', ');
  const sourceDetailSql = `
SELECT coalesce(json_agg(json_build_object(
  'sourceId', i.id, 'invoiceNumber', i.invoice_number, 'kind', i.kind, 'status', i.status,
  'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
  'invoiceDate', to_char(coalesce(i.invoice_date, i.transaction_date)::date, 'YYYY-MM-DD'),
  'gross', i.total_amount::text, 'net', i.net_amount::text, 'vat', i.tax_amount::text,
  'notes', coalesce(i.notes, ''), 'categorySourceId', i.category_id,
  'supplier', json_build_object('sourceId', i.supplier_id, 'nameAr', s.name_ar),
  'ledgers', coalesce((SELECT json_agg(json_build_object(
      'sourceId', l.id, 'amount', l.amount::text, 'status', l.status,
      'debitCode', da.code, 'creditCode', ca.code
    ) ORDER BY l.id) FROM ledger_entries l
    JOIN accounts da ON da.id = l.debit_account_id
    JOIN accounts ca ON ca.id = l.credit_account_id
    WHERE l.company_id = i.company_id AND l.reference_id = i.id AND l.status = 'active'), '[]'::json),
  'allocations', coalesce((SELECT json_agg(json_build_object(
      'sourceId', a.id, 'amount', a.amount::text, 'vaultSourceId', a.vault_id
    ) ORDER BY a.id) FROM invoice_vault_allocations a WHERE a.invoice_id = i.id), '[]'::json)
) ORDER BY i.transaction_date, i.id), '[]'::json)::text
FROM invoices i
JOIN suppliers s ON s.id = i.supplier_id
WHERE i.company_id = '${SOURCE_COMPANY_ID}' AND i.id IN (${sourceIdList});`;
  const details = readSourceJson(sourceDetailSql, 'uncategorized invoice details');
  if (!Array.isArray(details) || details.length !== eligible.length) throw new Error('The eligible Noorix source rows changed while preparing the plan.');
  const categoryIdBySource = new Map(eligible.map((row) => [row.sourceId, row.categoryId]));
  const planRows = details.map((row) => ({ ...row, categoryId: categoryIdBySource.get(row.sourceId) }));
  for (const row of planRows) {
    if (!row.categoryId || !row.supplier?.sourceId || !row.supplier.nameAr || !['purchase', 'expense'].includes(row.kind)
      || row.status !== 'active' || row.categorySourceId || row.ledgers.length !== 1 || row.allocations.length !== 1
      || !moneyEquals(row.ledgers[0].amount, row.gross) || !moneyEquals(row.allocations[0].amount, row.gross)
      || !target.supplierIdBySource.has(row.supplier.sourceId) || !target.vaultIdBySource.has(row.allocations[0].vaultSourceId)) {
      throw new Error(`Noorix source proof or target reference is incomplete for ${row.sourceId}.`);
    }
    const category = target.categoryById.get(row.categoryId);
    if (!category || category.kind !== row.kind.toUpperCase() || !category.accountId) throw new Error(`The reused supplier category is unavailable for ${row.sourceId}.`);
    if (row.vat !== '0.0000' && (!target.profile.vatAccountingEnabled || target.profile.vatRateBasisPoints !== 1500)) {
      throw new Error(`The target VAT profile cannot preserve ${row.sourceId}.`);
    }
    row.sourceChecksum = hash({
      sourceId: row.sourceId, invoiceNumber: row.invoiceNumber, kind: row.kind, businessDate: row.businessDate,
      invoiceDate: row.invoiceDate, gross: fixed(row.gross), net: fixed(row.net), vat: fixed(row.vat),
      supplier: row.supplier, ledgers: row.ledgers, allocations: row.allocations, notes: row.notes, categoryId: row.categoryId,
    });
  }
  const planChecksum = hash({ version: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, rows: planRows.map((row) => [row.sourceId, row.sourceChecksum, row.categoryId]) });
  const dryRun = {
    status: 'PARSED_DRY_RUN', version: VERSION, planChecksum,
    candidateRows: candidates.length, candidateGross: sum(candidates),
    eligibleRows: planRows.length, eligibleGross: sum(planRows),
    reviewRows: review.length, reviewGross: sum(review),
    review: review.map((row) => ({ sourceId: row.sourceId, invoiceNumber: row.invoiceNumber, grossAmount: fixed(row.gross), reason: row.reviewReason })),
    proposedCategoryReuse: planRows.map((row) => ({ sourceId: row.sourceId, invoiceNumber: row.invoiceNumber, categoryId: row.categoryId })),
    financialWrites: 0,
  };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true, status: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== planChecksum || ['CANCELLED', 'FAILED'].includes(existing.status)) throw new Error('The existing uncategorized-outflow execution cannot be resumed safely.');
        return existing;
      }
      return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner-authorized Noorix invoices without a source category, classified only by consistent prior supplier history.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() }, select: { id: true, financialPlanSha256: true, status: true } });
    });
    const wave = await database.inTenantTransaction(tenantId, async (tx) => {
      const current = await tx.nurixExcelFinancialWave.upsert({
        where: { executionId_sequence: { executionId: execution.id, sequence: 1 } },
        create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: planRows.length },
        update: { status: 'RUNNING', plannedItems: planRows.length },
        select: { id: true },
      });
      for (const row of planRows) await tx.nurixExcelFinancialItem.upsert({
        where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId } },
        create: { id: randomUUID(), executionId: execution.id, waveId: current.id, tenantId, targetCompanyId: companyId, sourceSheet: 'NoorixLiveInvoices', sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, operationKey: hash({ version: VERSION, sourceId: row.sourceId }), status: 'PENDING' },
        update: { sourceChecksum: row.sourceChecksum, waveId: current.id },
      });
      const foreignMaps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: { in: planRows.map((row) => row.sourceId) } }, select: { executionId: true, sourceId: true } });
      if (foreignMaps.some((map) => map.executionId !== execution.id)) throw new Error('A selected Noorix source invoice is already mapped by a different execution.');
      return current;
    });

    let posted = 0;
    let reused = 0;
    for (const row of planRows) {
      const result = await database.inTenantTransaction(tenantId, async (tx) => {
        const existingMap = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId }, select: { targetId: true, sourceChecksum: true } });
        if (existingMap) {
          if (existingMap.sourceChecksum !== row.sourceChecksum) throw new Error(`Source checksum conflict for ${row.sourceId}.`);
          const existing = await tx.financeOutflowDocument.findFirst({ where: { id: existingMap.targetId, tenantId, companyId, status: 'POSTED' }, select: { id: true, grossAmount: true, netAmount: true, vatAmount: true, categoryId: true } });
          if (!existing || !moneyEquals(existing.grossAmount, row.gross) || !moneyEquals(existing.netAmount, row.net) || !moneyEquals(existing.vatAmount, row.vat) || existing.categoryId !== row.categoryId) throw new Error(`Mapped target conflict for ${row.sourceId}.`);
          await tx.nurixExcelFinancialItem.update({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId } }, data: { status: 'REUSED', targetEntity: 'FinanceOutflowDocument', targetId: existing.id, resultCode: 'IDEMPOTENT_REUSE' } });
          return 'REUSED';
        }
        const duplicate = await tx.financeOutflowDocument.findFirst({ where: { tenantId, companyId, supplierInvoiceNumberNormalized: row.invoiceNumber.toUpperCase() }, select: { id: true } });
        if (duplicate) throw new Error(`Duplicate target supplier invoice blocks ${row.sourceId}.`);
        const category = target.categoryById.get(row.categoryId);
        const vaultId = target.vaultIdBySource.get(row.allocations[0].vaultSourceId);
        if (!category?.accountId || !vaultId) throw new Error(`Target references disappeared for ${row.sourceId}.`);
        const vault = await tx.financeVault.findFirst({ where: { id: vaultId, tenantId, companyId, status: 'ACTIVE', isPaymentDestination: true }, select: { accountId: true, paymentMethod: true } });
        if (!vault) throw new Error(`The target vault is unavailable for ${row.sourceId}.`);
        const businessDate = day(row.businessDate);
        const sequence = await serials.reserveInTransaction(tx, { tenantId, companyId, actorUserId }, { series: row.kind === 'purchase' ? 'PURCHASE' : 'EXPENSE', businessDate: row.businessDate });
        const documentNumber = `${row.kind === 'purchase' ? 'PUR' : 'EXP'}-${row.businessDate.replaceAll('-', '')}-${sequence.toString().padStart(4, '0')}`;
        const lines = [{ accountId: category.accountId, debitAmount: fixed(row.net), description: documentNumber }];
        if (Number(row.vat) !== 0) {
          const vatInput = await tx.financeAccount.findFirst({ where: { tenantId, companyId, systemKey: 'VAT_INPUT', status: 'ACTIVE' }, select: { id: true } });
          if (!vatInput) throw new Error('The VAT input account is unavailable.');
          lines.push({ accountId: vatInput.id, debitAmount: fixed(row.vat), description: documentNumber });
        }
        lines.push({ accountId: vault.accountId, creditAmount: fixed(row.gross), description: documentNumber });
        const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-al-shami-uncategorized:${hash({ sourceId: row.sourceId }).slice(0, 42)}`, sourceType: 'nurix_al_shami_uncategorized_historical_outflow', sourceReference: row.sourceId, businessDate, description: `ترحيل نوركس تاريخي غير مصنف: ${row.invoiceNumber}`, lines });
        const documentId = randomUUID();
        const sourceInvoiceDateAfterBusinessDate = row.invoiceDate > row.businessDate;
        await tx.financeOutflowDocument.create({ data: { id: documentId, tenantId, companyId, kind: row.kind.toUpperCase(), settlementKind: 'PAID', documentNumber, supplierId: target.supplierIdBySource.get(row.supplier.sourceId), supplierNameSnapshotAr: row.supplier.nameAr, categoryId: row.categoryId, supplierInvoiceNumber: row.invoiceNumber, supplierInvoiceNumberNormalized: row.invoiceNumber.toUpperCase(), businessDate, supplierInvoiceDate: day(sourceInvoiceDateAfterBusinessDate ? row.businessDate : row.invoiceDate), grossAmount: fixed(row.gross), netAmount: fixed(row.net), vatAmount: fixed(row.vat), vatRateBasisPoints: Number(row.vat) === 0 ? 0 : Math.round(Number(row.vat) * 10_000 / Number(row.net)), notes: `ترحيل نوركس: الفئة المصدرية فارغة؛ استُخدمت فقط فئة متسقة مع سجلات المورد السابقة. ${row.notes}${sourceInvoiceDateAfterBusinessDate ? ` تاريخ فاتورة نوركس الأصلي: ${row.invoiceDate}.` : ''}`.trim().slice(0, 1_000), journalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
        const allocationId = randomUUID();
        await tx.financeOutflowAllocation.create({ data: { id: allocationId, tenantId, companyId, documentId, vaultId, grossAmount: fixed(row.gross), paymentMethod: vault.paymentMethod } });
        await cashEvents.recordInTransaction(tx, { tenantId, companyId, actorUserId }, { kind: row.kind === 'purchase' ? 'PURCHASE_PAYMENT' : 'OPERATING_EXPENSE_PAYMENT', direction: 'OUTFLOW', businessDate, grossAmount: fixed(row.gross), netAmount: fixed(row.net), vatAmount: fixed(row.vat), sourceType: 'nurix_al_shami_uncategorized_historical_outflow', sourceId: documentId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision, category: { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, kind: category.kind }, destinations: [{ vaultId, amount: fixed(row.gross), paymentMethod: vault.paymentMethod }] });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [
          { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, state: 'APPLIED' },
          { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'LedgerEntry', sourceId: row.ledgers[0].sourceId, sourceChecksum: hash(row.ledgers[0]), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' },
          { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'InvoiceAllocation', sourceId: row.allocations[0].sourceId, sourceChecksum: hash(row.allocations[0]), targetEntity: 'FinanceOutflowAllocation', targetId: allocationId, state: 'APPLIED' },
        ] });
        if (row.notes) await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: row.sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, field: 'notes', exactText: row.notes }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, exactText: row.notes } });
        await tx.nurixExcelFinancialItem.update({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId } }, data: { status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: documentId, resultCode: 'POSTED_REUSED_SUPPLIER_CATEGORY' } });
        return 'POSTED';
      });
      if (result === 'POSTED') posted += 1; else reused += 1;
    }
    await database.inTenantTransaction(tenantId, async (tx) => {
      const summary = { ...dryRun, status: 'COMPLETED', posted, reused, financialWrites: posted };
      await tx.nurixExcelFinancialWave.update({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, data: { status: 'COMMITTED', postedItems: posted, reusedItems: reused, committedAt: new Date(), reconciliationHash: hash(summary) } });
      await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: hash(summary), summaryJson: summary, createdByUserId: actorUserId }, update: { waveId: wave.id, receiptSha256: hash(summary), summaryJson: summary } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, leaseToken: null, leaseExpiresAt: null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.uncategorized_outflows.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-al-shami-uncategorized:${planChecksum}`, afterJson: summary } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dryRun, posted, reused, financialWrites: posted }, null, 2));
  }
} finally {
  await app.close();
}
