-- Read-only evidence queries for the August 2026 reconciliation audit.
-- Scope is the seeded local company: مشويات المعلم الشامي.
\pset format unaligned
\pset fieldsep '|'
\pset pager off

\echo '01_LEDGER_INTEGRITY'
WITH scoped AS (
  SELECT e.id, e."businessDate", e.status, e."isSealed",
    COALESCE(SUM(l."debitAmount"), 0) AS debit,
    COALESCE(SUM(l."creditAmount"), 0) AS credit
  FROM "FinanceJournalEntry" e
  LEFT JOIN "FinanceJournalLine" l ON l."journalEntryId" = e.id
  WHERE e."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND e."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
  GROUP BY e.id, e."businessDate", e.status, e."isSealed"
)
SELECT COUNT(*) AS entry_count,
  COUNT(*) FILTER (WHERE "isSealed") AS sealed_count,
  COUNT(*) FILTER (WHERE NOT "isSealed") AS unsealed_count,
  COUNT(*) FILTER (WHERE debit <> credit) AS imbalanced_count,
  COALESCE(SUM(debit), 0) AS total_debit,
  COALESCE(SUM(credit), 0) AS total_credit,
  MIN("businessDate") AS first_business_date,
  MAX("businessDate") AS last_business_date
FROM scoped;

\echo '02_JOURNAL_BY_SOURCE'
SELECT "sourceType", COUNT(DISTINCT e.id) AS entries,
  SUM(l."debitAmount") AS debit, SUM(l."creditAmount") AS credit
FROM "FinanceJournalEntry" e
JOIN "FinanceJournalLine" l ON l."journalEntryId" = e.id
WHERE e."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
  AND e."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
  AND e."isSealed" AND e.status IN ('POSTED', 'REVERSED')
GROUP BY "sourceType"
ORDER BY "sourceType";

\echo '03_DAILY_PROJECTION_VS_LEDGER'
WITH ledger AS (
  SELECT l."accountId", SUM(l."debitAmount") AS debit, SUM(l."creditAmount") AS credit
  FROM "FinanceJournalLine" l
  JOIN "FinanceJournalEntry" e ON e.id = l."journalEntryId"
  WHERE e."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND e."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
    AND e."isSealed" AND e.status IN ('POSTED', 'REVERSED')
  GROUP BY l."accountId"
), projection AS (
  SELECT "accountId", SUM("debitAmount") AS debit, SUM("creditAmount") AS credit
  FROM "FinanceAccountDailyBalance"
  WHERE "tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND "companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
  GROUP BY "accountId"
)
SELECT COUNT(*) FILTER (WHERE COALESCE(l.debit,0) <> COALESCE(p.debit,0)
                            OR COALESCE(l.credit,0) <> COALESCE(p.credit,0)) AS mismatched_accounts,
  COALESCE(SUM(l.debit),0) AS ledger_debit,
  COALESCE(SUM(l.credit),0) AS ledger_credit,
  COALESCE(SUM(p.debit),0) AS projection_debit,
  COALESCE(SUM(p.credit),0) AS projection_credit
FROM ledger l FULL OUTER JOIN projection p ON p."accountId" = l."accountId";

\echo '03B_MONTHLY_PROJECTION_VS_LEDGER'
WITH ledger AS (
  SELECT l."accountId", SUM(l."debitAmount") AS debit, SUM(l."creditAmount") AS credit
  FROM "FinanceJournalLine" l
  JOIN "FinanceJournalEntry" e ON e.id = l."journalEntryId"
  WHERE e."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND e."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
    AND e."businessDate" >= DATE '2026-08-01' AND e."businessDate" <= DATE '2026-08-23'
    AND e."isSealed" AND e.status IN ('POSTED', 'REVERSED')
  GROUP BY l."accountId"
), projection AS (
  SELECT "accountId", SUM("debitAmount") AS debit, SUM("creditAmount") AS credit
  FROM "FinanceAccountMonthlyBalance"
  WHERE "tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND "companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
    AND "monthStart" = DATE '2026-08-01'
  GROUP BY "accountId"
)
SELECT COUNT(*) FILTER (WHERE COALESCE(l.debit,0) <> COALESCE(p.debit,0)
                            OR COALESCE(l.credit,0) <> COALESCE(p.credit,0)) AS mismatched_accounts,
  COALESCE(SUM(l.debit),0) AS ledger_debit,
  COALESCE(SUM(l.credit),0) AS ledger_credit,
  COALESCE(SUM(p.debit),0) AS projection_debit,
  COALESCE(SUM(p.credit),0) AS projection_credit
FROM ledger l FULL OUTER JOIN projection p ON p."accountId" = l."accountId";

\echo '04_SALES_DOCUMENT_TO_EVENT'
WITH sales AS (
  SELECT COUNT(*) AS documents, SUM("grossAmount") AS gross, SUM("netAmount") AS net, SUM("vatAmount") AS vat
  FROM "FinanceDailySalesClosing"
  WHERE "tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND "companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
    AND status = 'POSTED'
), events AS (
  SELECT COUNT(*) AS events, SUM("grossAmount") AS gross, SUM("netAmount") AS net, SUM("vatAmount") AS vat
  FROM "FinanceCashPerformanceEvent"
  WHERE "tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND "companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
    AND kind = 'SALES_COLLECTION'
)
SELECT * FROM sales CROSS JOIN events;

\echo '05_OUTFLOW_DOCUMENT_TO_EVENT'
SELECT d.kind, (d."recurringExpenseProfileId" IS NOT NULL) AS recurring,
  COUNT(*) AS documents, SUM(d."grossAmount") AS document_gross,
  COUNT(e.id) AS linked_events, COALESCE(SUM(e."grossAmount"),0) AS event_gross,
  COUNT(*) FILTER (WHERE e.id IS NULL) AS documents_without_event
FROM "FinanceOutflowDocument" d
LEFT JOIN "FinanceCashPerformanceEvent" e ON e."sourceJournalEntryId" = d."journalEntryId"
WHERE d."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
  AND d."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
  AND d.status = 'POSTED'
GROUP BY d.kind, (d."recurringExpenseProfileId" IS NOT NULL)
ORDER BY d.kind, recurring;

\echo '06_PAYROLL_AND_ADVANCES'
SELECT r."runNumber", r.status, r."grossAmount", r."netPayableAmount", r."paidAmount",
  COUNT(p.id) AS payment_rows, COALESCE(SUM(p.amount),0) AS payment_sum,
  COUNT(e.id) AS performance_events, COALESCE(SUM(e."grossAmount"),0) AS performance_event_sum
FROM "HrPayrollRun" r
LEFT JOIN "HrPayrollPayment" p ON p."payrollRunId" = r.id
LEFT JOIN "FinanceCashPerformanceEvent" e ON e."sourceJournalEntryId" = p."journalEntryId"
WHERE r."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
  AND r."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
GROUP BY r."runNumber", r.status, r."grossAmount", r."netPayableAmount", r."paidAmount";

SELECT a."advanceNumber", a.status, a."originalAmount", a."settledAmount", a."remainingAmount",
  COALESCE(SUM(alloc.amount),0) AS allocated_from_vaults,
  COUNT(e.id) AS cash_performance_events_for_issue
FROM "HrEmployeeAdvance" a
LEFT JOIN "HrEmployeeAdvancePayoutAllocation" alloc ON alloc."advanceId" = a.id
LEFT JOIN "FinanceCashPerformanceEvent" e ON e."sourceJournalEntryId" = a."issueJournalEntryId"
WHERE a."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
  AND a."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
GROUP BY a."advanceNumber", a.status, a."originalAmount", a."settledAmount", a."remainingAmount";

\echo '07_VAULT_LEDGER_TO_EVENTS'
WITH vault_lines AS (
  SELECT e.id, SUM(l."debitAmount") FILTER (WHERE l."accountId" = v."accountId") AS inflow,
    SUM(l."creditAmount") FILTER (WHERE l."accountId" = v."accountId") AS outflow
  FROM "FinanceJournalEntry" e
  JOIN "FinanceJournalLine" l ON l."journalEntryId" = e.id
  JOIN "FinanceVault" v ON v."accountId" = l."accountId" AND v."companyId" = e."companyId"
  WHERE e."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND e."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
    AND e."isSealed" AND e.status IN ('POSTED', 'REVERSED')
  GROUP BY e.id
), external_vault_lines AS (
  SELECT * FROM vault_lines WHERE COALESCE(inflow,0)=0 OR COALESCE(outflow,0)=0
), events AS (
  SELECT COALESCE(SUM("grossAmount") FILTER (WHERE direction='INFLOW'),0) AS inflow,
    COALESCE(SUM("grossAmount") FILTER (WHERE direction='OUTFLOW'),0) AS outflow
  FROM "FinanceCashPerformanceEvent"
  WHERE "tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
    AND "companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
)
SELECT COALESCE(SUM(inflow),0) AS ledger_external_inflow,
  COALESCE(SUM(outflow),0) AS ledger_external_outflow,
  (SELECT inflow FROM events) AS event_inflow,
  (SELECT outflow FROM events) AS event_outflow
FROM external_vault_lines;

\echo '08_VAT_SETTLEMENT_TO_EVENTS'
SELECT s.kind, s.status, COUNT(*) AS settlements, SUM(s.amount) AS settlement_amount,
  COUNT(e.id) AS linked_events, COALESCE(SUM(e."grossAmount"),0) AS event_amount
FROM "FinanceVatSettlement" s
LEFT JOIN "FinanceCashPerformanceEvent" e ON e."sourceJournalEntryId" = s."journalEntryId"
WHERE s."tenantId" = '6ffae759-800e-4653-8543-51013f5ef751'
  AND s."companyId" = '4af6969a-161f-4e13-8acc-103d8aa26a70'
GROUP BY s.kind, s.status;
