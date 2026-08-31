/**
 * Owner-reviewed Noorix outflow backfill for the nine Al-Shami invoices that
 * have no consistent supplier-history category.  Rules are intentionally
 * explicit.  A missing exact posting category is a blocker, never a fallback.
 *
 * Usage:
 * node scripts/run-local-nurix-al-shami-reviewed-outflows-backfill.mjs \
 *   <package> <tenant> <company> <owner> DRY_RUN|APPLY_APPROVED_NOORIX_AL_SHAMI_REVIEWED_OUTFLOWS_V1
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-reviewed-outflows/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_REVIEWED_OUTFLOWS_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const UUID = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value, label = 'amount') => { const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}.`); return parsed.toFixed(4); };
const same = (left, right) => fixed(left) === fixed(right);
const moneyEquals = same;
const day = (value) => new Date(`${value}T00:00:00.000Z`);

// The owner approved these business meanings.  categoryCode is intentionally
// absent where Baseer does not yet have an exact posting leaf.
const RULES = Object.freeze([
  { sourceId: 'cmobzs5i7003t1s4erdjxqmvf', supplierName: 'شركة ديار صفوى للتجارة', sourceKind: 'purchase', targetKind: 'PURCHASE', categoryCode: 'P1-2', decision: 'دجاج' },
  { sourceId: 'cmnxehv5o000z1480zpre73pn', supplierName: 'مؤسسة عمر سعد العنزي', sourceKind: 'purchase', targetKind: 'EXPENSE', categoryCode: 'E5-4', decision: 'صيانة محل' },
  { sourceId: 'cmnuu73uk001emc8j0vsgmtwr', supplierName: 'شركة تطوير محطات الوقود للمحروقات', sourceKind: 'purchase', targetKind: 'EXPENSE', categoryCode: 'E5-3', decision: 'وقود ومواصلات' },
  { sourceId: 'cmo67pwvl00eng1b6k7kbfbk0', supplierName: 'مؤسسة عمر سعد العنزي', sourceKind: 'purchase', targetKind: 'EXPENSE', categoryCode: 'E5-4', decision: 'صيانة محل' },
  { sourceId: 'cmp8sujxb002cyvby455n73mt', supplierName: 'شركة حياة مثالية للتعبئة والتغليف', sourceKind: 'purchase', targetKind: 'PURCHASE', categoryCode: 'P3-4', decision: 'مواد تعبئة وتغليف' },
  { sourceId: 'cmpdqm77600c6m8wrgt2rp7th', supplierName: 'مؤسسة عمر سعد العنزي', sourceKind: 'purchase', targetKind: 'EXPENSE', categoryCode: 'E5-4', decision: 'صيانة محل' },
  { sourceId: 'cmpiub38w0139m8wr5hlw8amv', supplierName: 'مؤسسة عمر سعد العنزي', sourceKind: 'purchase', targetKind: 'EXPENSE', categoryCode: 'E5-4', decision: 'صيانة محل' },
  { sourceId: 'cmsny70q5000de481p6au8erb', supplierName: 'اعلانات قوقل', sourceKind: 'expense', targetKind: 'EXPENSE', categoryCode: 'E6-1', decision: 'حملات تسويقية' },
  { sourceId: 'cmswav8iz01azs10iqhjlvg7w', supplierName: 'مؤسسة عمر سعد العنزي', sourceKind: 'purchase', targetKind: 'EXPENSE', categoryCode: 'E5-4', decision: 'صيانة محل' },
]);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => UUID.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) throw new Error(`Usage: node scripts/run-local-nurix-al-shami-reviewed-outflows-backfill.mjs <package> <tenant> <company> <owner> DRY_RUN|${APPROVAL}`);
const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');

const sourceIds = RULES.map((rule) => `'${rule.sourceId}'`).join(', ');
const sourceSql = `SELECT coalesce(json_agg(json_build_object(
  'sourceId', i.id, 'invoiceNumber', i.invoice_number, 'kind', i.kind, 'status', i.status,
  'businessDate', to_char(i.transaction_date::date,'YYYY-MM-DD'), 'invoiceDate', to_char(coalesce(i.invoice_date,i.transaction_date)::date,'YYYY-MM-DD'),
  'gross',i.total_amount::text,'net',i.net_amount::text,'vat',i.tax_amount::text,'notes',coalesce(i.notes,''),'categorySourceId',i.category_id,
  'supplier',json_build_object('sourceId',i.supplier_id,'nameAr',s.name_ar),
  'ledgers',coalesce((SELECT json_agg(json_build_object('sourceId',l.id,'amount',l.amount::text,'debitCode',da.code,'creditCode',ca.code) ORDER BY l.id) FROM ledger_entries l JOIN accounts da ON da.id=l.debit_account_id JOIN accounts ca ON ca.id=l.credit_account_id WHERE l.company_id=i.company_id AND l.reference_id=i.id AND l.status='active'),'[]'::json),
  'allocations',coalesce((SELECT json_agg(json_build_object('sourceId',a.id,'amount',a.amount::text,'vaultSourceId',a.vault_id) ORDER BY a.id) FROM invoice_vault_allocations a WHERE a.invoice_id=i.id),'[]'::json)
) ORDER BY i.id),'[]'::json)::text FROM invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE i.company_id='${SOURCE_COMPANY_ID}' AND i.id IN (${sourceIds});`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No reviewed Noorix invoices were returned.');
const sourceRows = JSON.parse(raw);
if (!Array.isArray(sourceRows) || sourceRows.length !== RULES.length) throw new Error('The reviewed Noorix source set changed.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const { DocumentSerialService } = await import('../apps/api/dist/core-controls/document-serial.service.js');
const { FinanceCashPerformanceEventService } = await import('../apps/api/dist/finance/finance-cash-performance-event.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService); const journals = app.get(JournalPostingService); const serials = app.get(DocumentSerialService); const cashEvents = app.get(FinanceCashPerformanceEventService);
  const ruleById = new Map(RULES.map((rule) => [rule.sourceId, rule]));
  const target = await database.inTenantTransaction(tenantId, async (tx) => {
    const pkg = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
    if (!pkg) throw new Error('The selected package is not the approved Al-Shami package.');
    const [categories, supplierMaps, vaultMaps, invoiceMaps, profile] = await Promise.all([
      tx.financeCategory.findMany({ where: { tenantId, companyId, code: { in: RULES.flatMap((rule) => rule.categoryCode ? [rule.categoryCode] : []) }, status: 'ACTIVE', isPosting: true }, select: { id: true, code: true, kind: true, accountId: true, nameAr: true, nameEn: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Supplier', targetEntity: 'FinanceSupplier', state: { in: ['APPLIED','REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', targetEntity: 'FinanceVault', state: { in: ['APPLIED','REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: { in: RULES.map((rule) => rule.sourceId) }, state: { in: ['APPLIED','REUSED'] } }, select: { executionId: true, sourceId: true, targetId: true } }),
      tx.companyFinanceProfile.findFirst({ where: { tenantId, companyId }, select: { vatAccountingEnabled: true, vatRateBasisPoints: true } }),
    ]);
    if (!profile) throw new Error('Target financial profile is unavailable.');
    const [suppliers, vaults] = await Promise.all([
      tx.financeSupplier.findMany({ where: { tenantId, companyId, id: { in: supplierMaps.map((row) => row.targetId).filter((id) => UUID.test(id)) }, status: 'ACTIVE' }, select: { id: true } }),
      tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: vaultMaps.map((row) => row.targetId).filter((id) => UUID.test(id)) }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true } }),
    ]);
    const supplierIds = new Set(suppliers.map((row) => row.id)); const vaultById = new Map(vaults.map((row) => [row.id,row]));
    return { categoryByCode: new Map(categories.map((row) => [row.code,row])), categoryById: new Map(categories.map((row) => [row.id,row])), supplierIdBySource: new Map(supplierMaps.filter((row) => supplierIds.has(row.targetId)).map((row) => [row.sourceId,row.targetId])), vaultBySource: new Map(vaultMaps.filter((row) => vaultById.has(row.targetId)).map((row) => [row.sourceId,vaultById.get(row.targetId)])), invoiceMaps, profile };
  });
  const planned = []; const blockers = [];
  for (const source of sourceRows) {
    const rule = ruleById.get(source.sourceId);
    if (!rule || source.status !== 'active' || source.categorySourceId || source.kind !== rule.sourceKind || source.supplier?.nameAr !== rule.supplierName || source.ledgers.length !== 1 || source.allocations.length !== 1 || !same(source.ledgers[0].amount,source.gross) || !same(source.allocations[0].amount,source.gross)) throw new Error(`Immutable source proof changed for ${source.sourceId}.`);
    if (source.vat !== '0.0000' && (!target.profile.vatAccountingEnabled || target.profile.vatRateBasisPoints !== 1500)) throw new Error(`Target VAT profile cannot preserve ${source.sourceId}.`);
    if (!target.supplierIdBySource.has(source.supplier.sourceId)) { blockers.push({ sourceId: source.sourceId, invoiceNumber: source.invoiceNumber, grossAmount: fixed(source.gross), decision: rule.decision, reason: 'SUPPLIER_SOURCE_MAP_MISSING' }); continue; }
    if (!target.vaultBySource.has(source.allocations[0].vaultSourceId)) { blockers.push({ sourceId: source.sourceId, invoiceNumber: source.invoiceNumber, grossAmount: fixed(source.gross), decision: rule.decision, reason: 'VAULT_SOURCE_MAP_MISSING' }); continue; }
    if (rule.blocker) { blockers.push({ sourceId: source.sourceId, invoiceNumber: source.invoiceNumber, grossAmount: fixed(source.gross), decision: rule.decision, reason: rule.blocker }); continue; }
    const category = target.categoryByCode.get(rule.categoryCode);
    if (!category || category.kind !== rule.targetKind || !category.accountId) { blockers.push({ sourceId: source.sourceId, invoiceNumber: source.invoiceNumber, grossAmount: fixed(source.gross), decision: rule.decision, reason: `TARGET_POSTING_CATEGORY_UNAVAILABLE: ${rule.categoryCode}` }); continue; }
    const sourceChecksum = sha({ sourceId: source.sourceId, invoiceNumber: source.invoiceNumber, sourceKind: source.kind, businessDate: source.businessDate, invoiceDate: source.invoiceDate, gross: fixed(source.gross), net: fixed(source.net), vat: fixed(source.vat), supplierSourceId: source.supplier.sourceId, vaultSourceId: source.allocations[0].vaultSourceId, ledger: source.ledgers[0], allocation: source.allocations[0] });
    planned.push({ ...source, rule, category, sourceChecksum, supplierId: target.supplierIdBySource.get(source.supplier.sourceId), vault: target.vaultBySource.get(source.allocations[0].vaultSourceId) });
  }
  const planChecksum = sha({ version: VERSION, rules: RULES, planned: planned.map((row) => [row.sourceId,row.category.id,sha({ source: row.sourceId, gross: fixed(row.gross), categoryId: row.category.id, ledger: row.ledgers[0], allocation: row.allocations[0] })]), blockers });
  const dryRun = { status: 'PARSED_DRY_RUN', version: VERSION, planChecksum, reviewedRows: RULES.length, eligibleRows: planned.length, eligibleGross: fixed(planned.reduce((total,row) => total + Number(row.gross),0)), blockers, financialWrites: 0 };
  console.log(JSON.stringify(dryRun,null,2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    if (blockers.length) throw new Error('APPLY refused: resolve every listed source-map/category blocker first. No financial write was made.');
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true, status: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== planChecksum || ['CANCELLED', 'FAILED'].includes(existing.status)) throw new Error('The existing reviewed-outflow execution cannot be resumed safely.');
        return existing;
      }
      return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner-approved exact categories for the nine Noorix invoices previously held for review.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() }, select: { id: true, financialPlanSha256: true, status: true } });
    });
    const wave = await database.inTenantTransaction(tenantId, async (tx) => {
      const current = await tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: planned.length }, update: { status: 'RUNNING', plannedItems: planned.length }, select: { id: true } });
      for (const row of planned) await tx.nurixExcelFinancialItem.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId } }, create: { id: randomUUID(), executionId: execution.id, waveId: current.id, tenantId, targetCompanyId: companyId, sourceSheet: 'NoorixLiveInvoices', sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, operationKey: sha({ version: VERSION, sourceId: row.sourceId }), status: 'PENDING' }, update: { sourceChecksum: row.sourceChecksum, waveId: current.id } });
      const foreignMaps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: { in: planned.map((row) => row.sourceId) } }, select: { executionId: true, sourceId: true } });
      if (foreignMaps.some((map) => map.executionId !== execution.id)) throw new Error('A selected Noorix invoice is already mapped by another execution.');
      return current;
    });
    let posted = 0; let reused = 0;
    for (const row of planned) {
      const result = await database.inTenantTransaction(tenantId, async (tx) => {
        const existingMap = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId }, select: { targetId: true, sourceChecksum: true } });
        if (existingMap) {
          if (existingMap.sourceChecksum !== row.sourceChecksum) throw new Error(`Source checksum conflict for ${row.sourceId}.`);
          const existing = await tx.financeOutflowDocument.findFirst({ where: { id: existingMap.targetId, tenantId, companyId, status: 'POSTED' }, select: { id: true, grossAmount: true, netAmount: true, vatAmount: true, categoryId: true, kind: true } });
          if (!existing || !moneyEquals(existing.grossAmount, row.gross) || !moneyEquals(existing.netAmount, row.net) || !moneyEquals(existing.vatAmount, row.vat) || existing.categoryId !== row.category.id || existing.kind !== row.rule.targetKind) throw new Error(`Mapped target conflict for ${row.sourceId}.`);
          await tx.nurixExcelFinancialItem.update({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId } }, data: { status: 'REUSED', targetEntity: 'FinanceOutflowDocument', targetId: existing.id, resultCode: 'IDEMPOTENT_REUSE' } });
          return 'REUSED';
        }
        const duplicate = await tx.financeOutflowDocument.findFirst({ where: { tenantId, companyId, supplierInvoiceNumberNormalized: row.invoiceNumber.toUpperCase() }, select: { id: true } });
        if (duplicate) throw new Error(`Duplicate target supplier invoice blocks ${row.sourceId}.`);
        const category = target.categoryById.get(row.category.id);
        const vault = await tx.financeVault.findFirst({ where: { id: row.vault.id, tenantId, companyId, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true } });
        if (!category?.accountId || !vault) throw new Error(`Target references disappeared for ${row.sourceId}.`);
        const businessDate = day(row.businessDate); const isPurchase = row.rule.targetKind === 'PURCHASE';
        const sequence = await serials.reserveInTransaction(tx, { tenantId, companyId, actorUserId }, { series: isPurchase ? 'PURCHASE' : 'EXPENSE', businessDate: row.businessDate });
        const documentNumber = `${isPurchase ? 'PUR' : 'EXP'}-${row.businessDate.replaceAll('-', '')}-${sequence.toString().padStart(4, '0')}`;
        const lines = [{ accountId: category.accountId, debitAmount: fixed(row.net), description: documentNumber }];
        if (Number(row.vat) !== 0) { const vatInput = await tx.financeAccount.findFirst({ where: { tenantId, companyId, systemKey: 'VAT_INPUT', status: 'ACTIVE' }, select: { id: true } }); if (!vatInput) throw new Error('The VAT input account is unavailable.'); lines.push({ accountId: vatInput.id, debitAmount: fixed(row.vat), description: documentNumber }); }
        lines.push({ accountId: vault.accountId, creditAmount: fixed(row.gross), description: documentNumber });
        const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-al-shami-reviewed:${sha({ sourceId: row.sourceId }).slice(0, 42)}`, sourceType: 'nurix_al_shami_reviewed_historical_outflow', sourceReference: row.sourceId, businessDate, description: `ترحيل نوركس معتمد: ${row.invoiceNumber} — ${row.rule.decision}`, lines });
        const documentId = randomUUID(); const sourceInvoiceDateAfterBusinessDate = row.invoiceDate > row.businessDate;
        await tx.financeOutflowDocument.create({ data: { id: documentId, tenantId, companyId, kind: row.rule.targetKind, settlementKind: 'PAID', documentNumber, supplierId: row.supplierId, supplierNameSnapshotAr: row.supplier.nameAr, categoryId: category.id, supplierInvoiceNumber: row.invoiceNumber, supplierInvoiceNumberNormalized: row.invoiceNumber.toUpperCase(), businessDate, supplierInvoiceDate: day(sourceInvoiceDateAfterBusinessDate ? row.businessDate : row.invoiceDate), grossAmount: fixed(row.gross), netAmount: fixed(row.net), vatAmount: fixed(row.vat), vatRateBasisPoints: Number(row.vat) === 0 ? 0 : Math.round(Number(row.vat) * 10_000 / Number(row.net)), notes: `ترحيل نوركس بتصنيف معتمد: ${row.rule.decision}. نوع المصدر: ${row.kind}. ${row.notes}${sourceInvoiceDateAfterBusinessDate ? ` تاريخ فاتورة نوركس الأصلي: ${row.invoiceDate}.` : ''}`.trim().slice(0, 1_000), journalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
        const allocationId = randomUUID(); await tx.financeOutflowAllocation.create({ data: { id: allocationId, tenantId, companyId, documentId, vaultId: vault.id, grossAmount: fixed(row.gross), paymentMethod: vault.paymentMethod } });
        await cashEvents.recordInTransaction(tx, { tenantId, companyId, actorUserId }, { kind: isPurchase ? 'PURCHASE_PAYMENT' : 'OPERATING_EXPENSE_PAYMENT', direction: 'OUTFLOW', businessDate, grossAmount: fixed(row.gross), netAmount: fixed(row.net), vatAmount: fixed(row.vat), sourceType: 'nurix_al_shami_reviewed_historical_outflow', sourceId: documentId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision, category: { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, kind: category.kind }, destinations: [{ vaultId: vault.id, amount: fixed(row.gross), paymentMethod: vault.paymentMethod }] });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [ { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, state: 'APPLIED' }, { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'LedgerEntry', sourceId: row.ledgers[0].sourceId, sourceChecksum: sha(row.ledgers[0]), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' }, { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'InvoiceAllocation', sourceId: row.allocations[0].sourceId, sourceChecksum: sha(row.allocations[0]), targetEntity: 'FinanceOutflowAllocation', targetId: allocationId, state: 'APPLIED' } ] });
        if (row.notes) await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: row.sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, field: 'notes', exactText: row.notes }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, exactText: row.notes } });
        await tx.nurixExcelFinancialItem.update({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'Invoice', sourceId: row.sourceId } }, data: { status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: documentId, resultCode: 'POSTED_OWNER_REVIEWED_CATEGORY' } });
        return 'POSTED';
      });
      if (result === 'POSTED') posted += 1; else reused += 1;
    }
    await database.inTenantTransaction(tenantId, async (tx) => {
      const summary = { ...dryRun, status: 'COMPLETED', posted, reused, financialWrites: posted };
      await tx.nurixExcelFinancialWave.update({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, data: { status: 'COMMITTED', postedItems: posted, reusedItems: reused, committedAt: new Date(), reconciliationHash: sha(summary) } });
      await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: sha(summary), summaryJson: summary, createdByUserId: actorUserId }, update: { waveId: wave.id, receiptSha256: sha(summary), summaryJson: summary } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, leaseToken: null, leaseExpiresAt: null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.reviewed_outflows.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-al-shami-reviewed:${planChecksum}`, afterJson: summary } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dryRun, posted, reused, financialWrites: posted }, null, 2));
  }
} finally { await app.close(); }
