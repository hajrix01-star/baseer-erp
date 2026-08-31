/**
 * Owner-approved historical reconstruction for Al-Shami's Noorix Al-Rajhi financing.
 *
 * Scope is deliberately one-sided: it writes Al-Shami only.  ARZ receives no
 * journal or mutation.  The four source-proved repayments are posted as loan
 * repayments (never as expenses or supplier invoices).  Noorix has no future
 * instalment schedule, so this writer records the source-stated 48-month term
 * and the four realised instalments only; it creates no invented future plan.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-arz-financing-loan/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_ARZ_FINANCING_LOAN_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const SOURCE_LOAN_ID = 'cmskm6bcy0005zjxh579v5q0k';
const ARZ_COMPANY_ID = '7e64301f-c87e-4d98-9881-35328ace117b';
const SOURCE_BANK_VAULT_ID = 'cmnaiviq8000xwavxoqjln3z7';
const RECONSTRUCTED_OPENING_DATE = '2026-04-24';
const SOURCE_OPENING_DATE = '2026-08-08';
const SOURCE_DOCUMENT_NUMBER = `NOORIX-LOAN-${SOURCE_LOAN_ID}`;
const INTERCOMPANY_ACCOUNT_CODE = 'IC-ARZ-REC';
// Noorix stores no schedule.  This is nevertheless a source-proved reference
// instalment: two of the four posted payments equal it and 21 historical
// payments total exactly 21 × this amount.  It satisfies Baseer's positive
// contractual-field constraint without inventing a future payment plan.
const REFERENCE_INSTALLMENT_AMOUNT = '15423.5400';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);
const day = (value) => new Date(`${value}T00:00:00.000Z`);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-arz-financing-loan-backfill.mjs <package-uuid> <tenant-uuid> <al-shami-company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}
if (companyId === ARZ_COMPANY_ID) throw new Error('This writer must target Al-Shami, never ARZ.');

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const sourceSql = `
SELECT json_build_object(
  'loan', (SELECT json_build_object(
    'id', id, 'nameAr', name_ar, 'creditorName', creditor_name,
    'openingAmount', opening_amount::text, 'outstandingAmount', outstanding_amount::text,
    'historicalPaymentsCount', historical_payments_count, 'historicalPaidAmount', historical_paid_amount::text,
    'openingDate', to_char(opening_date::date, 'YYYY-MM-DD'), 'notes', coalesce(notes, ''), 'isActive', is_active,
    'openingLedgerId', opening_ledger_entry_id
  ) FROM loans WHERE id='${SOURCE_LOAN_ID}' AND company_id='${SOURCE_COMPANY_ID}'),
  'payments', coalesce((SELECT json_agg(json_build_object(
    'id', p.id, 'amount', p.amount::text, 'businessDate', to_char(p.transaction_date::date, 'YYYY-MM-DD'),
    'status', p.status, 'notes', coalesce(p.notes, ''), 'vaultSourceId', p.vault_id,
    'sourceInvoiceId', p.source_invoice_id, 'sourceLedgerId', p.source_ledger_entry_id, 'ledgerId', p.ledger_entry_id,
    'ledger', (SELECT json_build_object('id', l.id, 'amount', l.amount::text,
      'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'), 'status', l.status,
      'referenceType', l.reference_type, 'referenceId', l.reference_id, 'vaultId', l.vault_id,
      'debitCode', da.code, 'creditCode', ca.code)
      FROM ledger_entries l LEFT JOIN accounts da ON da.id=l.debit_account_id LEFT JOIN accounts ca ON ca.id=l.credit_account_id
      WHERE l.id=p.ledger_entry_id)
  ) ORDER BY p.transaction_date, p.id) FROM loan_payments p WHERE p.loan_id='${SOURCE_LOAN_ID}' AND p.company_id='${SOURCE_COMPANY_ID}'), '[]'::json),
  'cancelledInvoices', coalesce((SELECT json_agg(json_build_object(
    'id', i.id, 'number', i.invoice_number, 'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
    'amount', i.total_amount::text, 'status', i.status
  ) ORDER BY i.transaction_date) FROM invoices i WHERE i.id IN (
    SELECT source_invoice_id FROM loan_payments WHERE loan_id='${SOURCE_LOAN_ID}' AND source_invoice_id IS NOT NULL
  )), '[]'::json)
)::text;`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix loan source was returned.');
const source = JSON.parse(raw);
const loan = source.loan;
const payments = source.payments;
const cancelledInvoices = source.cancelledInvoices;
if (!loan || loan.id !== SOURCE_LOAN_ID || !loan.isActive || loan.nameAr !== 'تمويل الراجحي' || loan.creditorName !== 'مصرف الراجحي' || fixed(loan.openingAmount) !== '462571.1200' || fixed(loan.outstandingAmount) !== '401012.0400' || loan.historicalPaymentsCount !== 21 || fixed(loan.historicalPaidAmount) !== '323894.3400' || loan.openingDate !== SOURCE_OPENING_DATE) {
  throw new Error('The reviewed Noorix loan source changed.');
}
const expectedPayments = [
  ['2026-04-25', '15423.5400'], ['2026-05-21', '15423.5400'], ['2026-06-22', '15356.0000'], ['2026-07-22', '15356.0000'],
];
if (payments.length !== 4 || payments.some((payment, index) => payment.status !== 'posted' || payment.vaultSourceId !== SOURCE_BANK_VAULT_ID || payment.ledger?.status !== 'active' || payment.ledger?.referenceType !== 'loan_payment' || payment.ledger?.referenceId !== payment.id || payment.ledger?.vaultId !== SOURCE_BANK_VAULT_ID || payment.ledger?.debitCode !== 'LOAN-001' || payment.ledger?.creditCode !== 'V-002' || payment.businessDate !== expectedPayments[index][0] || fixed(payment.amount) !== expectedPayments[index][1] || fixed(payment.ledger.amount) !== expectedPayments[index][1] || payment.ledger.businessDate !== expectedPayments[index][0])) {
  throw new Error('The reviewed Noorix loan-payment evidence changed.');
}
if (cancelledInvoices.length !== 3 || cancelledInvoices.some((invoice) => invoice.status !== 'cancelled') || cancelledInvoices.map((invoice) => invoice.number).join(',') !== 'EXP-20260425-003,EXP-20260622-002,EXP-20260722-004') {
  throw new Error('Cancelled invoice evidence changed; no expense documents may be created.');
}
const paymentsTotal = fixed(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
if (paymentsTotal !== '61559.0800' || fixed(Number(loan.openingAmount) - Number(paymentsTotal)) !== fixed(loan.outstandingAmount)) throw new Error('Noorix loan reconciliation does not balance.');
const planChecksum = sha({ version: VERSION, source, reconstructedOpeningDate: RECONSTRUCTED_OPENING_DATE, arzCompanyId: ARZ_COMPANY_ID, treatment: 'ARZ_OWES_FULL_UNIFIED_FINANCING;NO_ARZ_WRITE;NO_FUTURE_SCHEDULE_FABRICATION' });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const target = await database.inTenantTransaction(tenantId, async (tx) => {
    const [packageRow, arz, existingLoan, accounts, vaultMap] = await Promise.all([
      tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } }),
      tx.company.findFirst({ where: { id: ARZ_COMPANY_ID, tenantId, status: 'ACTIVE' }, select: { id: true, nameAr: true } }),
      tx.financeInclusiveLoan.findFirst({ where: { tenantId, companyId, sourceDocumentNumber: SOURCE_DOCUMENT_NUMBER }, select: { id: true, remainingAmount: true } }),
      tx.financeAccount.findMany({ where: { tenantId, companyId, status: 'ACTIVE', systemKey: { in: ['INCLUSIVE_LOANS', 'OPENING_BALANCE_CLEARING'] } }, select: { id: true, systemKey: true, type: true } }),
      tx.nurixExcelFinancialSourceMap.findFirst({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: SOURCE_BANK_VAULT_ID, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { targetId: true } }),
    ]);
    if (!packageRow || !arz || arz.nameAr !== 'ARZ') throw new Error('Approved package or ARZ company identity is unavailable.');
    const loanAccount = accounts.find((account) => account.systemKey === 'INCLUSIVE_LOANS' && account.type === 'LIABILITY');
    const openingAccount = accounts.find((account) => account.systemKey === 'OPENING_BALANCE_CLEARING' && account.type === 'EQUITY');
    if (!loanAccount || !openingAccount) throw new Error('Required active loan/opening accounts are unavailable.');
    if (!vaultMap?.targetId) throw new Error('The Noorix bank vault is not mapped.');
    const vault = await tx.financeVault.findFirst({ where: { id: vaultMap.targetId, tenantId, companyId, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, nameAr: true } });
    if (!vault) throw new Error('Mapped bank vault is not active.');
    const intercompanyAccount = await tx.financeAccount.findFirst({ where: { tenantId, companyId, code: INTERCOMPANY_ACCOUNT_CODE }, select: { id: true, type: true, nameAr: true } });
    if (intercompanyAccount && (intercompanyAccount.type !== 'ASSET' || intercompanyAccount.nameAr !== 'ذمم شركات شقيقة — ARZ')) throw new Error('Intercompany account code is already used by a different account.');
    return { existingLoan, loanAccountId: loanAccount.id, openingAccountId: openingAccount.id, vault, intercompanyAccountId: intercompanyAccount?.id ?? null };
  });
  const dry = {
    status: 'PARSED_DRY_RUN', version: VERSION, planChecksum,
    targetCompanyId: companyId, noArzWrites: true, sourceLoan: loan.nameAr,
    reconstructedOpeningDate: RECONSTRUCTED_OPENING_DATE, sourceOpeningDate: SOURCE_OPENING_DATE,
    openingAmount: fixed(loan.openingAmount), verifiedPayments: payments.map((payment) => ({ date: payment.businessDate, amount: fixed(payment.amount), sourceInvoiceId: payment.sourceInvoiceId ?? null })),
    paymentsTotal, remainingAmount: fixed(loan.outstandingAmount),
    intercompanyReceivable: { company: 'ARZ', amount: fixed(loan.openingAmount), accountCode: INTERCOMPANY_ACCOUNT_CODE },
    referenceInstallmentAmount: REFERENCE_INSTALLMENT_AMOUNT,
    cancelledExpenseEvidenceOnly: cancelledInvoices.map((invoice) => invoice.number),
    futureSchedule: 'NOT_CREATED_SOURCE_NOT_AVAILABLE', existingLoan: target.existingLoan ? { id: target.existingLoan.id, remainingAmount: target.existingLoan.remainingAmount.toFixed(4) } : null,
    financialWrites: 0,
  };
  console.log(JSON.stringify(dry, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const result = await database.inTenantTransaction(tenantId, async (tx) => {
      const existingExecution = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true, status: true } });
      if (existingExecution) {
        if (existingExecution.financialPlanSha256 !== planChecksum) throw new Error('Existing loan execution differs from the frozen plan.');
        const existing = await tx.financeInclusiveLoan.findFirstOrThrow({ where: { tenantId, companyId, sourceDocumentNumber: SOURCE_DOCUMENT_NUMBER }, select: { id: true, remainingAmount: true } });
        return { reused: true, loanId: existing.id, remainingAmount: existing.remainingAmount.toFixed(4), executionId: existingExecution.id };
      }
      if (target.existingLoan) throw new Error('The Noorix loan already exists without a matching execution.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${companyId}:${SOURCE_DOCUMENT_NUMBER}`}, 0))`;
      const execution = await tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner approved one-sided Al-Shami record: unified Al-Rajhi loan, four proven repayments, and ARZ receivable. No ARZ mutation; no invented future schedule.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() }, select: { id: true } });
      const intercompanyAccount = target.intercompanyAccountId ? { id: target.intercompanyAccountId } : await tx.financeAccount.create({ data: { id: randomUUID(), tenantId, companyId, code: INTERCOMPANY_ACCOUNT_CODE, nameAr: 'ذمم شركات شقيقة — ARZ', nameEn: 'Related-company receivable — ARZ', type: 'ASSET', isSystem: false, status: 'ACTIVE' }, select: { id: true } });
      const loanId = randomUUID();
      const openingJournal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-al-shami-loan-opening:${SOURCE_LOAN_ID}`, sourceType: 'nurix_al_shami_historical_loan_opening', sourceReference: SOURCE_LOAN_ID, businessDate: day(RECONSTRUCTED_OPENING_DATE), description: `ترحيل نوركس: ${loan.nameAr} — افتتاح اقتصادي مُعاد بناؤه قبل أول دفعة موثقة`, lines: [{ accountId: target.openingAccountId, debitAmount: fixed(loan.openingAmount) }, { accountId: target.loanAccountId, creditAmount: fixed(loan.openingAmount) }] });
      await tx.financeInclusiveLoan.create({ data: { id: loanId, tenantId, companyId, sourceDocumentNumber: SOURCE_DOCUMENT_NUMBER, originalAmount: fixed(loan.openingAmount), openingOutstandingAmount: fixed(loan.openingAmount), paidAmount: '0.0000', remainingAmount: fixed(loan.openingAmount), installmentAmount: REFERENCE_INSTALLMENT_AMOUNT, termMonths: 48, firstInstallmentDueDate: day(payments[0].businessDate), openingBusinessDate: day(RECONSTRUCTED_OPENING_DATE), openingJournalEntryId: openingJournal.journalEntryId, notes: `نوركس: ${loan.notes}\nتمويل موحد شامل الربح. استُخدم كامل التمويل في ARZ، وARZ مطالبة بإرجاع كامل التمويل للمعلم الشامي. لا يوجد تعديل في ARZ ضمن هذا الترحيل.\nقيد نوركس الافتتاحي نُشر في ${SOURCE_OPENING_DATE} بأثر رجعي؛ أعيد البناء اقتصاديًا في ${RECONSTRUCTED_OPENING_DATE} قبل أول دفعة مثبتة. سجل نوركس يذكر 48 قسطًا لكنه لا يحتوي جدولًا مستقبليًا بالمبالغ أو التواريخ؛ لذلك لم يُنشأ جدول افتراضي. مبلغ القسط المرجعي ${REFERENCE_INSTALLMENT_AMOUNT} مثبت من 21 دفعة تاريخية ومن دفعتين فعليتين؛ والدفعات الأخرى تختلف عنه.`.slice(0, 2000) } });
      const receivableJournal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-al-shami-arz-receivable:${SOURCE_LOAN_ID}`, sourceType: 'nurix_al_shami_arz_financing_receivable', sourceReference: SOURCE_LOAN_ID, businessDate: day(RECONSTRUCTED_OPENING_DATE), description: `ذمة تمويل موحد على ARZ مقابل ${loan.nameAr}`, lines: [{ accountId: intercompanyAccount.id, debitAmount: fixed(loan.openingAmount) }, { accountId: target.openingAccountId, creditAmount: fixed(loan.openingAmount) }] });
      let remaining = Number(loan.openingAmount); let paid = 0; const paymentReceipts = [];
      for (const payment of payments) {
        const paymentId = randomUUID(); const amount = Number(payment.amount); remaining -= amount; paid += amount;
        const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-al-shami-loan-payment:${payment.id}`, sourceType: 'nurix_al_shami_historical_loan_payment', sourceReference: payment.id, businessDate: day(payment.businessDate), description: `سداد تمويل الراجحي تاريخي — ${payment.businessDate}`, lines: [{ accountId: target.loanAccountId, debitAmount: fixed(amount) }, { accountId: target.vault.accountId, creditAmount: fixed(amount) }] });
        await tx.financeInclusiveLoanPayment.create({ data: { id: paymentId, tenantId, companyId, loanId, vaultId: target.vault.id, amount: fixed(amount), businessDate: day(payment.businessDate), journalEntryId: journal.journalEntryId } });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [{ id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'LoanPayment', sourceId: payment.id, sourceChecksum: sha(payment), targetEntity: 'FinanceInclusiveLoanPayment', targetId: paymentId, state: 'APPLIED' }, { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'LoanPaymentLedger', sourceId: payment.ledgerId, sourceChecksum: sha(payment.ledger), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' }] });
        if (payment.sourceInvoiceId) await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: payment.sourceInvoiceId, field: 'loan_reclassification' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'Invoice', sourceId: payment.sourceInvoiceId, sourceChecksum: sha(payment.sourceInvoiceId), targetEntity: 'FinanceInclusiveLoanPayment', targetId: paymentId, field: 'loan_reclassification', exactText: `فاتورة نوركس الملغاة أعيد تصنيفها كسداد للقرض ${loan.nameAr}. لا تُنشأ كمصروف أو فاتورة في بصير.` }, update: { targetEntity: 'FinanceInclusiveLoanPayment', targetId: paymentId, exactText: `فاتورة نوركس الملغاة أعيد تصنيفها كسداد للقرض ${loan.nameAr}. لا تُنشأ كمصروف أو فاتورة في بصير.` } });
        paymentReceipts.push({ paymentId, journalEntryId: journal.journalEntryId, amount: fixed(amount), remainingAmount: fixed(remaining) });
      }
      if (fixed(remaining) !== fixed(loan.outstandingAmount) || fixed(paid) !== paymentsTotal) throw new Error('Target loan reconstruction does not reconcile.');
      await tx.financeInclusiveLoan.update({ where: { id: loanId }, data: { paidAmount: fixed(paid), remainingAmount: fixed(remaining) } });
      await tx.nurixExcelFinancialSourceMap.createMany({ data: [{ id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'Loan', sourceId: SOURCE_LOAN_ID, sourceChecksum: sha(loan), targetEntity: 'FinanceInclusiveLoan', targetId: loanId, state: 'APPLIED' }, { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'LoanOpeningLedger', sourceId: loan.openingLedgerId, sourceChecksum: sha({ sourceId: loan.openingLedgerId, amount: loan.openingAmount, sourceDate: SOURCE_OPENING_DATE }), targetEntity: 'FinanceJournalEntry', targetId: openingJournal.journalEntryId, state: 'APPLIED' }] });
      await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'Loan', sourceId: SOURCE_LOAN_ID, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'Loan', sourceId: SOURCE_LOAN_ID, sourceChecksum: sha(loan), targetEntity: 'FinanceInclusiveLoan', targetId: loanId, field: 'notes', exactText: loan.notes }, update: { sourceChecksum: sha(loan), targetEntity: 'FinanceInclusiveLoan', targetId: loanId, exactText: loan.notes } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.arz_financing_loan.completed', entityType: 'FinanceInclusiveLoan', entityId: loanId, requestId: `nurix-al-shami-arz-loan:${planChecksum}`, afterJson: { ownerDecision: { recipientCompanyId: ARZ_COMPANY_ID, recipientCompanyNameAr: 'ARZ', fullUnifiedAmountReceivable: fixed(loan.openingAmount), noArzWrite: true, noExpenseInvoices: true, futureSchedule: 'NOT_CREATED_SOURCE_NOT_AVAILABLE' }, openingJournalEntryId: openingJournal.journalEntryId, receivableJournalEntryId: receivableJournal.journalEntryId, paymentReceipts } } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: null, waveSequence: 1 } });
      return { reused: false, executionId: execution.id, loanId, openingJournalEntryId: openingJournal.journalEntryId, receivableJournalEntryId: receivableJournal.journalEntryId, intercompanyAccountId: intercompanyAccount.id, paymentReceipts, remainingAmount: fixed(remaining) };
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dry, financialWrites: 7, result }, null, 2));
  }
} finally { await app.close(); }
