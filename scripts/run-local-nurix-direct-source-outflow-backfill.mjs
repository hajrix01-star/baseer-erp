/**
 * Controlled single-document writer for Noorix rows that are outside the
 * verified workbook but have complete live-source evidence.  It is purposely
 * fail-closed: one active invoice, one active source ledger, and allocations
 * that exactly equal the gross amount are required before any Baseer write.
 *
 * Usage:
 *   node scripts/run-local-nurix-direct-source-outflow-backfill.mjs \
 *     <package-id> <tenant-id> <company-id> <owner-user-id> <noorix-invoice-number>
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [packageId, tenantId, companyId, actorUserId, invoiceNumber] = process.argv.slice(2);
const uuid = /^[0-9a-f-]{36}$/i;
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !invoiceNumber?.trim()) {
  throw new Error('Usage: node scripts/run-local-nurix-direct-source-outflow-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> <noorix-invoice-number>');
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const dbUrl = new URL(process.env.DATABASE_URL ?? '');
if (dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== '5433' || dbUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceSql = `
SELECT json_build_object(
  'id', i.id,
  'number', i.invoice_number,
  'kind', i.kind,
  'status', i.status,
  'businessDate', to_char(i.transaction_date, 'YYYY-MM-DD'),
  'invoiceDate', to_char(COALESCE(i.invoice_date, i.transaction_date), 'YYYY-MM-DD'),
  'gross', i.total_amount::text,
  'net', i.net_amount::text,
  'vat', i.tax_amount::text,
  'notes', COALESCE(i.notes, ''),
  'supplier', (SELECT json_build_object('id', s.id, 'nameAr', s.name_ar) FROM suppliers s WHERE s.id = i.supplier_id),
  'ledgers', COALESCE((SELECT json_agg(json_build_object(
      'id', l.id, 'amount', l.amount::text, 'debitCode', da.code, 'creditCode', ca.code, 'status', l.status
    ) ORDER BY l.id)
    FROM ledger_entries l
    JOIN accounts da ON da.id = l.debit_account_id
    JOIN accounts ca ON ca.id = l.credit_account_id
    WHERE l.company_id = i.company_id AND l.reference_id = i.id AND l.status = 'active'), '[]'::json),
  'allocations', COALESCE((SELECT json_agg(json_build_object(
      'id', ia.id, 'amount', ia.amount::text, 'vaultName', v.name_ar
    ) ORDER BY ia.id)
    FROM invoice_vault_allocations ia
    JOIN vaults v ON v.id = ia.vault_id
    WHERE ia.invoice_id = i.id), '[]'::json)
)::text
FROM invoices i
WHERE i.company_id = 'cmnf604ka009ay8lm556wgd9c'
  AND i.invoice_number = '${invoiceNumber.replaceAll("'", "''")}';`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('The requested Noorix invoice was not found in the frozen source snapshot.');
const source = JSON.parse(raw);
if (source.status !== 'active' || !['purchase', 'expense'].includes(source.kind)) throw new Error('Only active purchase or expense invoices are eligible.');
if (!source.supplier?.nameAr || source.ledgers.length !== 1 || !source.allocations.length) throw new Error('The source row lacks the required supplier, one active ledger, or payment allocation evidence.');
const ledger = source.ledgers[0];
const allocationTotal = source.allocations.reduce((sum, row) => sum + Number(row.amount), 0);
if (!Number.isFinite(allocationTotal) || allocationTotal.toFixed(4) !== Number(source.gross).toFixed(4) || Number(ledger.amount).toFixed(4) !== Number(source.gross).toFixed(4)) {
  throw new Error('Source allocation or ledger totals do not equal the invoice gross amount.');
}
if (source.allocations.length !== 1) throw new Error('This guarded writer requires exactly one allocation; multi-vault invoices need a dedicated reviewed wave.');
// Baseer correctly disallows a supplier-invoice date later than the financial
// movement. Noorix has historical rows with that inconsistency. Preserve the
// original source value in the immutable checksum and the document note, but
// project the constrained target field to the actual movement date.
const sourceInvoiceDateAfterBusinessDate = source.invoiceDate > source.businessDate;
const targetInvoiceDate = sourceInvoiceDateAfterBusinessDate ? source.businessDate : source.invoiceDate;
const sourceDateNote = sourceInvoiceDateAfterBusinessDate ? ` تاريخ فاتورة نوركس الأصلي: ${source.invoiceDate} (بعد تاريخ الحركة؛ حُفظ هنا بسبب قيد بصير).` : '';

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { PurchaseExpenseService } = await import('../apps/api/dist/finance/purchase-expense.service.js');
const { DocumentSerialService } = await import('../apps/api/dist/core-controls/document-serial.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const { FinanceCashPerformanceEventService } = await import('../apps/api/dist/finance/finance-cash-performance-event.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const purchases = app.get(PurchaseExpenseService);
  const serials = app.get(DocumentSerialService);
  const journals = app.get(JournalPostingService);
  const cashEvents = app.get(FinanceCashPerformanceEventService);
  const sourceChecksum = hash(source);
  const transformVersion = `nurix-live-outflow-v1:${source.id}`;
  const prepared = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId }, select: { id: true } });
    if (!packageRow) throw new Error('The provided package is not scoped to the target ARZ company.');
    const [existingMap, existingDocument, category, supplier, vault, profile] = await Promise.all([
      tx.nurixExcelFinancialSourceMap.findFirst({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: source.id, state: 'APPLIED' }, select: { targetId: true } }),
      tx.financeOutflowDocument.findFirst({ where: { tenantId, companyId, status: 'POSTED', supplierInvoiceNumberNormalized: source.number.toUpperCase() }, select: { id: true, documentNumber: true, grossAmount: true, netAmount: true, vatAmount: true, journalEntryId: true } }),
      tx.financeCategory.findFirst({ where: { tenantId, companyId, code: ledger.debitCode, kind: source.kind.toUpperCase(), status: 'ACTIVE', isPosting: true }, select: { id: true, code: true, nameAr: true, nameEn: true, kind: true, accountId: true } }),
      tx.financeSupplier.findFirst({ where: { tenantId, companyId, nameAr: source.supplier.nameAr, status: 'ACTIVE' }, select: { id: true } }),
      tx.financeVault.findFirst({ where: { tenantId, companyId, nameAr: source.allocations[0].vaultName, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true } }),
      tx.companyFinanceProfile.findFirst({ where: { tenantId, companyId }, select: { vatAccountingEnabled: true, vatRateBasisPoints: true } }),
    ]);
    if (existingMap) return { existingMap, existingDocument };
    if (!category || !supplier || !vault || !profile) throw new Error('A required active target category, supplier, vault, or financial profile is unavailable.');
    if (source.vat !== '0.0000' && (!profile.vatAccountingEnabled || profile.vatRateBasisPoints !== 1500)) throw new Error('The Baseer VAT setup cannot preserve this source invoice exactly.');
    return { existingMap, existingDocument, category, supplier, vault };
  });

  if (prepared.existingMap && !prepared.existingDocument) {
    throw new Error('The source map exists but its target document is unavailable; manual review is required.');
  }
  {
    let existing = prepared.existingDocument;
    const existingMatchesSource = existing
      && Number(existing.grossAmount).toFixed(4) === Number(source.gross).toFixed(4)
      && Number(existing.netAmount).toFixed(4) === Number(source.net).toFixed(4)
      && Number(existing.vatAmount).toFixed(4) === Number(source.vat).toFixed(4);
    if (existing && !existingMatchesSource) {
      const reversal = await purchases.reverse({
        context: { tenantId, companyId, actorUserId },
        idempotencyKey: `nlo-rounding-reverse:${hash({ sourceId: source.id }).slice(0, 42)}`,
        request: { documentId: existing.id, businessDate: new Date(`${source.businessDate}T00:00:00.000Z`), reason: 'استبدال مستند ترحيل أولي بتسجيل تاريخي يحفظ تقريب نوركس الأصلي.' },
      });
      console.error(JSON.stringify({ action: 'reversed_inaccurate_initial_document', documentId: reversal.documentId, reversalJournalEntryId: reversal.reversalJournalEntryId }));
      existing = null;
    }
    const receipt = existing ? {
      documentId: existing.id, documentNumber: existing.documentNumber, journalEntryId: existing.journalEntryId,
      grossAmount: String(existing.grossAmount), netAmount: String(existing.netAmount), vatAmount: String(existing.vatAmount),
    } : await database.inTenantTransaction(tenantId, async (tx) => {
      const businessDate = new Date(`${source.businessDate}T00:00:00.000Z`);
      const day = source.businessDate;
      const sequence = await serials.reserveInTransaction(tx, { tenantId, companyId, actorUserId }, { series: source.kind === 'purchase' ? 'PURCHASE' : 'EXPENSE', businessDate: day });
      const documentNumber = `${source.kind === 'purchase' ? 'PUR' : 'EXP'}-${day.replaceAll('-', '')}-${sequence.toString().padStart(4, '0')}`;
      const lines = [{ accountId: prepared.category.accountId, debitAmount: Number(source.net).toFixed(4), description: documentNumber }];
      if (Number(source.vat) !== 0) {
        const vatInput = await tx.financeAccount.findFirst({ where: { tenantId, companyId, systemKey: 'VAT_INPUT', status: 'ACTIVE' }, select: { id: true } });
        if (!vatInput) throw new Error('The VAT input account is unavailable for historical posting.');
        lines.push({ accountId: vatInput.id, debitAmount: Number(source.vat).toFixed(4), description: documentNumber });
      }
      lines.push({ accountId: prepared.vault.accountId, creditAmount: Number(source.gross).toFixed(4), description: documentNumber });
      const journal = await journals.postInTransaction(tx, {
        tenantId, companyId, actorUserId, requestId: `nurix-live:${source.id}`,
        sourceType: 'nurix_live_historical_outflow', sourceReference: source.id,
        businessDate, description: `ترحيل نوركس التاريخي: ${source.number}`, lines,
      });
      const documentId = randomUUID();
      const netAmount = Number(source.net).toFixed(4);
      const vatAmount = Number(source.vat).toFixed(4);
      const grossAmount = Number(source.gross).toFixed(4);
      const vatRateBasisPoints = Number(source.vat) === 0 ? 0 : Math.round(Number(source.vat) * 10_000 / Number(source.net));
      await tx.financeOutflowDocument.create({ data: {
        id: documentId, tenantId, companyId, kind: source.kind.toUpperCase(), settlementKind: 'PAID', documentNumber,
        supplierId: prepared.supplier.id, supplierNameSnapshotAr: source.supplier.nameAr, categoryId: prepared.category.id,
        supplierInvoiceNumber: source.number, supplierInvoiceNumberNormalized: source.number.toUpperCase(), businessDate,
        supplierInvoiceDate: new Date(`${targetInvoiceDate}T00:00:00.000Z`), grossAmount, netAmount, vatAmount, vatRateBasisPoints,
        notes: `ترحيل نوركس المباشر: ${source.number}. ${source.notes}${sourceDateNote}`.trim().slice(0, 1_000), journalEntryId: journal.journalEntryId, createdByUserId: actorUserId,
      } });
      await tx.financeOutflowAllocation.create({ data: { id: randomUUID(), tenantId, companyId, documentId, vaultId: prepared.vault.id, grossAmount, paymentMethod: prepared.vault.paymentMethod } });
      await cashEvents.recordInTransaction(tx, { tenantId, companyId, actorUserId }, {
        kind: source.kind === 'purchase' ? 'PURCHASE_PAYMENT' : 'OPERATING_EXPENSE_PAYMENT', direction: 'OUTFLOW', businessDate,
        grossAmount, netAmount, vatAmount, sourceType: 'nurix_live_historical_outflow', sourceId: documentId,
        sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision,
        category: { code: prepared.category.code, nameAr: prepared.category.nameAr, nameEn: prepared.category.nameEn, kind: prepared.category.kind },
        destinations: [{ vaultId: prepared.vault.id, amount: grossAmount, paymentMethod: prepared.vault.paymentMethod }],
      });
      const receipt = { documentId, documentNumber, journalEntryId: journal.journalEntryId, grossAmount, netAmount, vatAmount };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.live_outflow_backfill.posted', entityType: 'FinanceOutflowDocument', entityId: documentId, requestId: `nurix-live:${source.id}`, afterJson: { sourceInvoice: source.number, sourceChecksum, ...receipt } } });
      return receipt;
    });
    if (Number(receipt.grossAmount).toFixed(4) !== Number(source.gross).toFixed(4) || Number(receipt.netAmount).toFixed(4) !== Number(source.net).toFixed(4) || Number(receipt.vatAmount).toFixed(4) !== Number(source.vat).toFixed(4)) {
      throw new Error('Baseer calculated amounts differ from the verified source; the write was not accepted as a completed migration.');
    }
    const result = await database.inTenantTransaction(tenantId, async (tx) => {
      const execution = await tx.nurixExcelFinancialExecution.upsert({
        where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion } },
        create: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion, financialPlanSha256: sourceChecksum, status: 'APPROVED', reason: 'Owner-authorized direct Noorix source backfill after allocation and ledger verification.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() },
        update: {}, select: { id: true },
      });
      const wave = await tx.nurixExcelFinancialWave.upsert({
        where: { executionId_sequence: { executionId: execution.id, sequence: 1 } },
        create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'COMMITTED', plannedItems: 1, postedItems: 1, committedAt: new Date(), reconciliationHash: sourceChecksum },
        update: { status: 'COMMITTED', postedItems: 1, committedAt: new Date(), reconciliationHash: sourceChecksum }, select: { id: true },
      });
      await tx.nurixExcelFinancialItem.upsert({
        where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: source.id } },
        create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'NoorixLiveInvoices', sourceEntity: 'Invoice', sourceId: source.id, sourceChecksum, operationKey: hash({ transformVersion, sourceId: source.id }), status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: receipt.documentId, resultCode: 'POSTED_AFTER_ALLOCATION_LEDGER_CHECK' },
        update: { status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: receipt.documentId, resultCode: 'POSTED_AFTER_ALLOCATION_LEDGER_CHECK' },
      });
      const targetAllocation = await tx.financeOutflowAllocation.findFirst({
        where: { tenantId, companyId, documentId: receipt.documentId, grossAmount: source.gross },
        select: { id: true },
      });
      if (!targetAllocation) throw new Error('The posted document has no matching Baseer allocation.');
      const maps = [
        ['Invoice', source.id, sourceChecksum, 'FinanceOutflowDocument', receipt.documentId],
        ['LedgerEntry', ledger.id, hash(ledger), 'FinanceJournalEntry', receipt.journalEntryId],
        ['InvoiceAllocation', source.allocations[0].id, hash(source.allocations[0]), 'FinanceOutflowAllocation', targetAllocation.id],
      ];
      for (const [sourceEntity, sourceId, checksum, targetEntity, targetId] of maps) {
        await tx.nurixExcelFinancialSourceMap.upsert({
          where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity, sourceId } },
          create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity, sourceId, sourceChecksum: checksum, targetEntity, targetId, state: 'APPLIED' }, update: { sourceChecksum: checksum, targetEntity, targetId, state: 'APPLIED' },
        });
      }
      const summary = { sourceInvoice: source.number, sourceId: source.id, documentId: receipt.documentId, documentNumber: receipt.documentNumber, grossAmount: receipt.grossAmount, netAmount: receipt.netAmount, vatAmount: receipt.vatAmount, allocations: 1, ledgers: 1 };
      await tx.nurixExcelFinancialReceipt.upsert({
        where: { executionId_sequence: { executionId: execution.id, sequence: 1 } },
        create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: hash(summary), summaryJson: summary, createdByUserId: actorUserId },
        update: { waveId: wave.id, receiptSha256: hash(summary), summaryJson: summary },
      });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, leaseToken: null, leaseExpiresAt: null } });
      return { executionId: execution.id, ...summary, reusedDocument: Boolean(existing) };
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...result }));
  }
} finally {
  await app.close();
}
