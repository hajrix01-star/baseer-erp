# Actual Financial Movements — Ledger and Event Policy

**Status:** superseded as a report source by the sealed-ledger vault-line policy on 2026-08-20.

`FinanceCashPerformanceEvent` remains an immutable, tenant-RLS-protected enrichment record for known operational sources. It preserves gross/net/VAT splits and snapshots used by VAT-exclusive presentation. It is not the completeness boundary of the **الربح والخسارة المالي** report.

The report reads sealed `FinanceJournalLine` records on configured `FinanceVault.accountId` accounts with the frozen `ReportRun.ledgerRevision` cutoff. This makes a real advance, final-settlement payment, loan repayment, owner movement, or future source visible even if its command has not yet been extended with an event writer. A source-specific event can enrich VAT presentation, but its absence never hides a VAT-inclusive financial movement.

Only a genuine internal transfer is excluded: source type `vault_transfer`, or a journal whose every line belongs to a company vault account. An opposite reversal remains a separate movement at its own business date.

For VAT-exclusive presentation, paid sales and purchase/expense source lines require a matching trusted event with a known gross/net split. Otherwise the report returns `COVERAGE_INCOMPLETE`; it does not infer tax from balances.

This policy is intentionally distinct from the formal accrual P&L policy.
