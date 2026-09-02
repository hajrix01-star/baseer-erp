import { execFileSync } from 'node:child_process';

const DATABASE_CONTAINER = 'baseer-erp-postgres';
const DATABASE_NAME = 'baseer_erp_test';
const DATABASE_USER = 'postgres';

const companies = Object.freeze({
  ARZ: '7e64301f-c87e-4d98-9881-35328ace117b',
  AL_SHAMI: '4af6969a-161f-4e13-8acc-103d8aa26a70',
});

const expected = Object.freeze({
  ARZ: {
    payroll: { runs: 7, gross: '185934.7600', advances: '13900.0000', admin: '5500.0000', net: '166534.7600', paid: '166534.7600', accrualJournals: 7 },
    lines: { count: 75, gross: '185934.7600', advances: '13900.0000', admin: '5500.0000', net: '166534.7600', paid: '166534.7600', arithmeticDelta: '0.0000' },
    payments: { count: 7, amount: '166534.7600', journals: 7, allocations: 8, allocationAmount: '166534.7600', vaultLines: 8, vaultOutflow: '166534.7600' },
    advanceLedger: { issuedCount: 34, issued: '28716.0000', settlementRows: 25, settled: '21116.0000', remaining: '7600.0000', settlementWithJournal: 25, settlementWithoutJournal: 0, payrollApplications: 0, payrollApplicationAmount: '0.0000' },
    evidence: { runs: 5, sourceAdvances: '14116.0000', appliedAdvances: '13900.0000', carryover: '216.0000' },
    journals: {
      accrualExpenseDebit: '172034.7600', accrualPayableCredit: '166534.7600', accrualAdminCredit: '5500.0000',
      advanceIssueAssetDebit: '28716.0000', advanceSettlementAssetCredit: '21116.0000', advanceSettlementExpenseDebit: '21116.0000',
    },
  },
  AL_SHAMI: {
    payroll: { runs: 5, gross: '215125.9583', advances: '77650.0000', admin: '1049.0000', net: '137326.9383', paid: '137326.9383', accrualJournals: 0 },
    lines: { count: 67, gross: '215125.9583', advances: '77650.0000', admin: '1049.0000', net: '137326.9383', paid: '137326.9383', arithmeticDelta: '-899.9800' },
    payments: { count: 8, amount: '137326.9383', journals: 8, allocations: 8, allocationAmount: '137326.9383', vaultLines: 8, vaultOutflow: '137326.9383' },
    advanceLedger: { issuedCount: 116, issued: '84200.0000', settlementRows: 98, settled: '71650.0000', remaining: '12550.0000', settlementWithJournal: 0, settlementWithoutJournal: 98, payrollApplications: 0, payrollApplicationAmount: '0.0000' },
    journals: { paidPayrollExpenseDebit: '137326.9383', advanceIssueAssetDebit: '84200.0000' },
    approvedExceptions: { payrollVsLinkedSettlements: '6000.0000', sourceArithmeticDelta: '-899.9800' },
  },
});

const sql = String.raw`
WITH scoped_companies(code, company_id) AS (
  VALUES ('ARZ', '${companies.ARZ}'::uuid), ('AL_SHAMI', '${companies.AL_SHAMI}'::uuid)
), payroll AS (
  SELECT r."companyId" company_id, count(*)::int runs,
    coalesce(sum(r."grossAmount"),0)::text gross,
    coalesce(sum(r."advanceSettlementAmount"),0)::text advances,
    coalesce(sum(r."administrativeDeductionAmount"),0)::text admin,
    coalesce(sum(r."netPayableAmount"),0)::text net,
    coalesce(sum(r."paidAmount"),0)::text paid,
    count(r."accrualJournalEntryId")::int accrual_journals
  FROM "HrPayrollRun" r JOIN scoped_companies c ON c.company_id=r."companyId" GROUP BY r."companyId"
), payroll_lines AS (
  SELECT l."companyId" company_id, count(*)::int lines,
    coalesce(sum(l."grossSalary"),0)::text gross,
    coalesce(sum(l."advanceSettlementAmount"),0)::text advances,
    coalesce(sum(l."administrativeDeductionAmount"),0)::text admin,
    coalesce(sum(l."netPayableAmount"),0)::text net,
    coalesce(sum(l."paidAmount"),0)::text paid,
    coalesce(sum(l."grossSalary"-l."advanceSettlementAmount"-l."administrativeDeductionAmount"-l."netPayableAmount"),0)::text arithmetic_delta
  FROM "HrPayrollLine" l JOIN scoped_companies c ON c.company_id=l."companyId" GROUP BY l."companyId"
), payments AS (
  SELECT p."companyId" company_id, count(*)::int payments, coalesce(sum(p.amount),0)::text amount,
    count(DISTINCT p."journalEntryId")::int journals
  FROM "HrPayrollPayment" p JOIN scoped_companies c ON c.company_id=p."companyId" GROUP BY p."companyId"
), allocations AS (
  SELECT p."companyId" company_id, count(a.id)::int allocations, coalesce(sum(a.amount),0)::text amount
  FROM "HrPayrollPayment" p JOIN "HrPayrollPaymentAllocation" a ON a."payrollPaymentId"=p.id
  JOIN scoped_companies c ON c.company_id=p."companyId" GROUP BY p."companyId"
), advances AS (
  SELECT a."companyId" company_id, count(*)::int issued_count,
    coalesce(sum(a."originalAmount"),0)::text issued,
    coalesce(sum(a."settledAmount"),0)::text settled,
    coalesce(sum(a."remainingAmount"),0)::text remaining
  FROM "HrEmployeeAdvance" a JOIN scoped_companies c ON c.company_id=a."companyId" GROUP BY a."companyId"
), settlements AS (
  SELECT a."companyId" company_id, count(s.id)::int settlement_rows,
    coalesce(sum(s.amount),0)::text amount,
    count(s."journalEntryId")::int with_journal,
    (count(*)-count(s."journalEntryId"))::int without_journal
  FROM "HrEmployeeAdvance" a JOIN "HrEmployeeAdvanceSettlement" s ON s."advanceId"=a.id
  JOIN scoped_companies c ON c.company_id=a."companyId" GROUP BY a."companyId"
), applications AS (
  SELECT app."companyId" company_id, count(*)::int application_rows, coalesce(sum(app.amount),0)::text amount
  FROM "HrPayrollAdvanceApplication" app JOIN scoped_companies c ON c.company_id=app."companyId" GROUP BY app."companyId"
), evidence AS (
  SELECT e."companyId" company_id, count(*)::int runs,
    coalesce(sum(e."sourceAdvancesAmount"),0)::text source_advances,
    coalesce(sum(e."appliedAdvancesAmount"),0)::text applied_advances,
    coalesce(sum(e."advanceCarryoverEvidenceAmount"),0)::text carryover
  FROM "NurixHistoricalPayrollEvidence" e JOIN scoped_companies c ON c.company_id=e."companyId" GROUP BY e."companyId"
), payroll_vault_lines AS (
  SELECT j."companyId" company_id, count(l.id)::int vault_lines,
    coalesce(sum(l."creditAmount"-l."debitAmount"),0)::text vault_outflow
  FROM "FinanceJournalEntry" j JOIN scoped_companies c ON c.company_id=j."companyId"
  JOIN "FinanceJournalLine" l ON l."journalEntryId"=j.id
  JOIN "FinanceVault" v ON v."companyId"=j."companyId" AND v."accountId"=l."accountId"
  WHERE j."sourceType" IN ('nurix_historical_paid_payroll_payment','nurix_al_shami_historical_paid_payroll')
  GROUP BY j."companyId"
), journal_accounts AS (
  SELECT c.code, j."sourceType" source_type, coalesce(a."systemKey",'NO_SYSTEM_KEY') account_key,
    count(DISTINCT j.id)::int journals, coalesce(sum(l."debitAmount"),0)::text debit,
    coalesce(sum(l."creditAmount"),0)::text credit
  FROM scoped_companies c JOIN "FinanceJournalEntry" j ON j."companyId"=c.company_id
  JOIN "FinanceJournalLine" l ON l."journalEntryId"=j.id JOIN "FinanceAccount" a ON a.id=l."accountId"
  WHERE j."sourceType" IN (
    'nurix_historical_paid_payroll_accrual','nurix_historical_paid_payroll_payment',
    'nurix_historical_employee_advance_issue','nurix_historical_employee_advance_settlement',
    'nurix_al_shami_historical_paid_payroll','nurix_al_shami_historical_advance_issue'
  ) GROUP BY c.code,j."sourceType",a."systemKey"
), journal_quality AS (
  SELECT c.code, j."sourceType" source_type, count(*)::int journals,
    bool_and(j."isSealed") sealed, bool_and(j.status='POSTED') posted,
    coalesce(sum(x.debit-x.credit),0)::text imbalance
  FROM scoped_companies c JOIN "FinanceJournalEntry" j ON j."companyId"=c.company_id
  JOIN LATERAL (SELECT sum(l."debitAmount") debit,sum(l."creditAmount") credit FROM "FinanceJournalLine" l WHERE l."journalEntryId"=j.id) x ON true
  WHERE j."sourceType" ILIKE '%payroll%' OR j."sourceType" ILIKE '%advance%'
  GROUP BY c.code,j."sourceType"
), source_map_quality AS (
  SELECT c.code, m."sourceEntity" source_entity, count(*)::int maps,
    count(DISTINCT m."sourceId")::int distinct_sources,
    (count(*)-count(DISTINCT m."sourceId"))::int duplicate_sources
  FROM scoped_companies c JOIN "NurixExcelFinancialSourceMap" m ON m."targetCompanyId"=c.company_id
  WHERE m."sourceEntity" ILIKE '%Payroll%' OR m."sourceEntity" ILIKE '%Advance%'
  GROUP BY c.code,m."sourceEntity"
)
SELECT json_build_object(
  'companies', (SELECT json_agg(json_build_object(
    'code', c.code,
    'payroll', json_build_object('runs',coalesce(p.runs,0),'gross',coalesce(p.gross,'0'),'advances',coalesce(p.advances,'0'),'admin',coalesce(p.admin,'0'),'net',coalesce(p.net,'0'),'paid',coalesce(p.paid,'0'),'accrualJournals',coalesce(p.accrual_journals,0)),
    'lines', json_build_object('count',coalesce(pl.lines,0),'gross',coalesce(pl.gross,'0'),'advances',coalesce(pl.advances,'0'),'admin',coalesce(pl.admin,'0'),'net',coalesce(pl.net,'0'),'paid',coalesce(pl.paid,'0'),'arithmeticDelta',coalesce(pl.arithmetic_delta,'0')),
    'payments', json_build_object('count',coalesce(py.payments,0),'amount',coalesce(py.amount,'0'),'journals',coalesce(py.journals,0),'allocations',coalesce(al.allocations,0),'allocationAmount',coalesce(al.amount,'0'),'vaultLines',coalesce(vl.vault_lines,0),'vaultOutflow',coalesce(vl.vault_outflow,'0')),
    'advances', json_build_object('issuedCount',coalesce(ad.issued_count,0),'issued',coalesce(ad.issued,'0'),'settled',coalesce(ad.settled,'0'),'remaining',coalesce(ad.remaining,'0'),'settlementRows',coalesce(st.settlement_rows,0),'settlementAmount',coalesce(st.amount,'0'),'settlementWithJournal',coalesce(st.with_journal,0),'settlementWithoutJournal',coalesce(st.without_journal,0),'payrollApplications',coalesce(ap.application_rows,0),'payrollApplicationAmount',coalesce(ap.amount,'0')),
    'evidence', json_build_object('runs',coalesce(ev.runs,0),'sourceAdvances',coalesce(ev.source_advances,'0'),'appliedAdvances',coalesce(ev.applied_advances,'0'),'carryover',coalesce(ev.carryover,'0'))
  ) ORDER BY c.code) FROM scoped_companies c
    LEFT JOIN payroll p ON p.company_id=c.company_id LEFT JOIN payroll_lines pl ON pl.company_id=c.company_id
    LEFT JOIN payments py ON py.company_id=c.company_id LEFT JOIN allocations al ON al.company_id=c.company_id
    LEFT JOIN advances ad ON ad.company_id=c.company_id LEFT JOIN settlements st ON st.company_id=c.company_id
    LEFT JOIN applications ap ON ap.company_id=c.company_id LEFT JOIN evidence ev ON ev.company_id=c.company_id
    LEFT JOIN payroll_vault_lines vl ON vl.company_id=c.company_id),
  'journalAccounts', (SELECT coalesce(json_agg(row_to_json(journal_accounts) ORDER BY code,source_type,account_key),'[]'::json) FROM journal_accounts),
  'journalQuality', (SELECT coalesce(json_agg(row_to_json(journal_quality) ORDER BY code,source_type),'[]'::json) FROM journal_quality),
  'sourceMapQuality', (SELECT coalesce(json_agg(row_to_json(source_map_quality) ORDER BY code,source_entity),'[]'::json) FROM source_map_quality)
)::text;
`;

const raw = execFileSync('docker', [
  'exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', DATABASE_CONTAINER,
  'psql', '-U', DATABASE_USER, '-d', DATABASE_NAME, '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', sql,
], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();

if (!raw) throw new Error('The read-only payroll reconciliation query returned no data.');
const source = JSON.parse(raw);
const blockers = [];
const approvedHistoricalExceptions = [];
const matched = [];

const normalizeMoney = (value) => {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));
  if (!match) throw new Error(`Invalid money returned by the audit query: ${value}`);
  return `${match[1]}${match[2]}.${(match[3] ?? '').padEnd(4, '0')}`;
};
const moneyUnits = (value) => {
  const normalized = normalizeMoney(value);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction] = unsigned.split('.');
  const units = BigInt(whole) * 10_000n + BigInt(fraction);
  return negative ? -units : units;
};
const fixed = (units) => {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  return `${negative ? '-' : ''}${absolute / 10_000n}.${String(absolute % 10_000n).padStart(4, '0')}`;
};
const companyByCode = new Map(source.companies.map((company) => [company.code, company]));
const journal = (code, sourceType, accountKey) => source.journalAccounts.find((row) => row.code === code && row.source_type === sourceType && row.account_key === accountKey) ?? { journals: 0, debit: '0', credit: '0' };

function assertEqual(company, path, actual, wanted) {
  const money = typeof wanted === 'string' && /^-?\d+\.\d{4}$/.test(wanted);
  const left = money ? normalizeMoney(actual) : actual;
  if (left === wanted) matched.push({ company, check: path, actual: left });
  else blockers.push({ company, check: path, expected: wanted, actual: left });
}

function auditCompany(code) {
  const actual = companyByCode.get(code);
  if (!actual) { blockers.push({ company: code, check: 'company_scope', expected: 'present', actual: 'missing' }); return; }
  const target = expected[code];
  for (const [key, value] of Object.entries(target.payroll)) assertEqual(code, `payroll.${key}`, actual.payroll[key], value);
  for (const [key, value] of Object.entries(target.lines)) assertEqual(code, `lines.${key}`, actual.lines[key], value);
  for (const [key, value] of Object.entries(target.payments)) assertEqual(code, `payments.${key}`, actual.payments[key], value);
  const advanceMapping = {
    issuedCount: 'issuedCount', issued: 'issued', settlementRows: 'settlementRows', settled: 'settlementAmount', remaining: 'remaining',
    settlementWithJournal: 'settlementWithJournal', settlementWithoutJournal: 'settlementWithoutJournal', payrollApplications: 'payrollApplications', payrollApplicationAmount: 'payrollApplicationAmount',
  };
  for (const [key, sourceKey] of Object.entries(advanceMapping)) assertEqual(code, `advances.${key}`, actual.advances[sourceKey], target.advanceLedger[key]);
}

auditCompany('ARZ');
auditCompany('AL_SHAMI');

const arz = companyByCode.get('ARZ');
for (const [key, value] of Object.entries(expected.ARZ.evidence)) assertEqual('ARZ', `evidence.${key}`, arz.evidence[key], value);
assertEqual('ARZ', 'journal.accrual.payrollExpense.debit', journal('ARZ','nurix_historical_paid_payroll_accrual','PAYROLL_EXPENSE').debit, expected.ARZ.journals.accrualExpenseDebit);
assertEqual('ARZ', 'journal.accrual.payrollPayable.credit', journal('ARZ','nurix_historical_paid_payroll_accrual','PAYROLL_PAYABLE').credit, expected.ARZ.journals.accrualPayableCredit);
assertEqual('ARZ', 'journal.accrual.adminRecovery.credit', journal('ARZ','nurix_historical_paid_payroll_accrual','EMPLOYEE_ADMIN_DEDUCTION_RECOVERY').credit, expected.ARZ.journals.accrualAdminCredit);
assertEqual('ARZ', 'journal.advanceIssue.asset.debit', journal('ARZ','nurix_historical_employee_advance_issue','EMPLOYEE_ADVANCES').debit, expected.ARZ.journals.advanceIssueAssetDebit);
assertEqual('ARZ', 'journal.advanceSettlement.asset.credit', journal('ARZ','nurix_historical_employee_advance_settlement','EMPLOYEE_ADVANCES').credit, expected.ARZ.journals.advanceSettlementAssetCredit);
assertEqual('ARZ', 'journal.advanceSettlement.expense.debit', journal('ARZ','nurix_historical_employee_advance_settlement','PAYROLL_EXPENSE').debit, expected.ARZ.journals.advanceSettlementExpenseDebit);

const shami = companyByCode.get('AL_SHAMI');
assertEqual('AL_SHAMI', 'journal.paidPayroll.expense.debit', journal('AL_SHAMI','nurix_al_shami_historical_paid_payroll','PAYROLL_EXPENSE').debit, expected.AL_SHAMI.journals.paidPayrollExpenseDebit);
assertEqual('AL_SHAMI', 'journal.advanceIssue.asset.debit', journal('AL_SHAMI','nurix_al_shami_historical_advance_issue','EMPLOYEE_ADVANCES').debit, expected.AL_SHAMI.journals.advanceIssueAssetDebit);

for (const row of source.journalQuality) {
  assertEqual(row.code, `journalQuality.${row.source_type}.sealed`, row.sealed, true);
  assertEqual(row.code, `journalQuality.${row.source_type}.posted`, row.posted, true);
  assertEqual(row.code, `journalQuality.${row.source_type}.imbalance`, row.imbalance, '0.0000');
}
for (const row of source.sourceMapQuality) assertEqual(row.code, `sourceMaps.${row.source_entity}.duplicateSources`, row.duplicate_sources, 0);

const shamiAdvanceDifference = fixed(moneyUnits(shami.payroll.advances) - moneyUnits(shami.advances.settlementAmount));
if (shamiAdvanceDifference === expected.AL_SHAMI.approvedExceptions.payrollVsLinkedSettlements) {
  approvedHistoricalExceptions.push({ company: 'AL_SHAMI', code: 'SOURCE_PAYROLL_ADVANCE_DEDUCTION_EXCEEDS_LINKED_SETTLEMENTS', amount: shamiAdvanceDifference, treatment: 'Preserved source payroll deduction snapshot; no settlement journal was fabricated.' });
} else blockers.push({ company: 'AL_SHAMI', check: 'approvedException.payrollVsLinkedSettlements', expected: expected.AL_SHAMI.approvedExceptions.payrollVsLinkedSettlements, actual: shamiAdvanceDifference });
if (normalizeMoney(shami.lines.arithmeticDelta) === expected.AL_SHAMI.approvedExceptions.sourceArithmeticDelta) {
  approvedHistoricalExceptions.push({ company: 'AL_SHAMI', code: 'SOURCE_PAYROLL_ARITHMETIC_EXCEPTION', amount: normalizeMoney(shami.lines.arithmeticDelta), treatment: 'Preserved exactly from Noorix PR-2606-001; no corrective journal was invented.' });
} else blockers.push({ company: 'AL_SHAMI', check: 'approvedException.sourceArithmeticDelta', expected: expected.AL_SHAMI.approvedExceptions.sourceArithmeticDelta, actual: normalizeMoney(shami.lines.arithmeticDelta) });
approvedHistoricalExceptions.push({ company: 'AL_SHAMI', code: 'HISTORICAL_CASH_BASIS_ONLY', amount: normalizeMoney(shami.payments.amount), treatment: 'No accrual or advance-settlement journal was created; only verified salary cash-payment journals were migrated.' });

const model = {
  grossSalary: '35.0000', appliedAdvance: '5.0000', administrativeDeduction: '0.0000', netPayrollPayment: '30.0000',
  standardBaseer: {
    accrual: { payrollExpenseDebit: '35.0000', employeeAdvancesCredit: '5.0000', payrollPayableCredit: '30.0000', balanced: true },
    payment: { payrollPayableDebit: '30.0000', vaultCredit: '30.0000', balanced: true },
    lifecycleCashOutflowIncludingEarlierAdvance: '35.0000', payrollDayCashOutflow: '30.0000', recognizedPayrollExpense: '35.0000',
  },
  historicalArzEquivalent: {
    advanceIssueCash: '5.0000', advanceSettlementExpense: '5.0000', remainingAccrualExpense: '30.0000', payrollPaymentCash: '30.0000', recognizedPayrollExpense: '35.0000', duplicateExpense: '0.0000',
  },
  historicalAlShamiCashBasis: {
    advanceIssueCash: '5.0000', paidPayrollExpenseAndCash: '30.0000', settlementJournal: '0.0000', recognizedPayrollExpense: '30.0000', lifecycleCashOutflow: '35.0000', classification: 'APPROVED_HISTORICAL_EXCEPTION',
  },
};

const result = {
  auditCode: 'payroll_advance_cash_reconciliation_v1', mode: 'READ_ONLY', generatedAt: new Date().toISOString(), database: { container: DATABASE_CONTAINER, name: DATABASE_NAME },
  classification: blockers.length ? 'blocker' : approvedHistoricalExceptions.length ? 'approved historical exception' : 'matched',
  summary: { matchedChecks: matched.length, approvedHistoricalExceptions: approvedHistoricalExceptions.length, blockers: blockers.length },
  model35_5_30: model,
  companies: source.companies,
  approvedHistoricalExceptions,
  blockers,
};

console.log(JSON.stringify(result, null, 2));
if (blockers.length) process.exitCode = 1;
