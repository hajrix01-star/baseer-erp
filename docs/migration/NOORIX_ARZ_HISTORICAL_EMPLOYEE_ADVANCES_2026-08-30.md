# Noorix ARZ historical employee advances — 2026-08-30

## Result

- Execution: `5f43100a-b829-42dd-9526-29a4cd5c5d34`
- Source plan SHA-256: `8eacd36a56dd8d89ed7bc50aaa7d4f753ada8b21dc0e68dc7c2a6e910c5e7080`
- 34 active advances were imported: issued `28,716.0000`.
- 25 source-backed settlements were imported: settled `21,116.0000`.
- Open balance after migration: `7,600.0000`.
- Statuses: 22 settled, 1 partially settled, and 11 issued/open.
- One cancelled Noorix advance was retained as excluded lineage evidence only; it did not create a financial or HR fact.

## Evidence and accounting treatment

Each active Noorix advance required exactly one active source ledger, on the same business date and amount:

- Issue: `ADV-001` (employee advances) debit to the original vault account credit.
- Settlement: an invoice-linked Noorix employee deduction with an active `EXP-004` (payroll expense) debit to `ADV-001` credit ledger.

Baseer posted 34 immutable issue journals and 25 immutable settlement journals. It did not invent payroll runs, cash receipts, or settlement dates. The retained source mappings total 119, covering the HR facts, source invoices, and source ledger proofs.

## Safety and restart rules

The writer is `scripts/run-local-nurix-historical-employee-advance-import.mjs`. It only accepts the local `noorix_inspect` snapshot and the canonical Baseer test database. Before an apply it validates the frozen count, exact source-ledger accounts, date and amount equality, employee maps, accounts, vault maps, and that settlements never exceed issued amounts.

Read access to Noorix is a temporary `SELECT`-only, `NOBYPASSRLS` role scoped to the source tenant. It is removed after the run. The writer stores source checksums, idempotency keys, per-item states, and the plan checksum; interrupted runs resume without duplicating financial facts.

## Verification gate

The execution is complete only when all figures below match the source:

| Check | Expected |
| --- | ---: |
| Posted items | 59 |
| Excluded cancelled evidence | 1 |
| Advance issue journals | 34 |
| Settlement journals | 25 |
| Issued amount | 28,716.0000 |
| Settled amount | 21,116.0000 |
| Remaining amount | 7,600.0000 |
