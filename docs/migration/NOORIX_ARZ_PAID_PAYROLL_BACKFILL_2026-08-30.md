# Noorix ARZ paid payroll backfill — 2026-08-30

## Scope and approval

- Source company: Noorix ARZ (`cmnf604ka009ay8lm556wgd9c`), frozen local rehearsal snapshot.
- Target: Baseer ARZ (`7e64301f-c87e-4d98-9881-35328ace117b`).
- Owner-authorized execution: `APPLY_APPROVED_NOORIX_ARZ_PAID_PAYROLL_V1`.
- Execution: `68de8f54-1622-43de-91d7-29ab6ac38cc4`.

## What was written

Seven paid payroll records were created with immutable source maps:

| Source | Target treatment | Paid amount |
|---|---|---:|
| PR-2604-001 through PR-2608-001 | Five monthly payroll runs, status `PAID` | 163,284.7600 |
| SAL-20260426-001 | One independent paid salary record | 2,500.0000 |
| SAL-20260509-001 | One independent paid salary record | 750.0000 |
| Total | 7 paid runs, 75 payroll lines, 8 source-vault allocations | 166,534.7600 |

Each record has an accrual journal, a payment journal, a payroll payment, source-to-target mappings, and an audit event. The wave committed 7/7 items with no failures.

## Accounting treatment for historic advances

Historic employee-advance settlements had already been migrated as source-backed journals. Re-applying them through the standard payroll approval workflow would credit employee advances and debit payroll expense a second time. The backfill therefore:

- retains `13,900.0000` as advance deductions on the payroll records and their lines;
- creates no duplicate payroll-advance application or settlement;
- posts the remaining payroll accrual and the verified cash payment only.

The source contains `216.0000` of advance carryover evidence that is not applied to the related salary net. It remains preserved by the earlier evidence record rather than being forced into an incorrect payroll settlement.

## Verification

- Noorix active salary invoices: **7 / 166,534.7600**.
- Baseer paid payroll runs: **7 / 166,534.7600**.
- Baseer payroll payments: **7 / 166,534.7600**, all with journal entries.
- New payroll journals balance: debit = credit for both accrual and payment groups.
- Source ledger allocations: **8**, all mapped and posted.

## Current financial reconciliation snapshot

| Area | Noorix active | Baseer | Result |
|---|---:|---:|---|
| Sales | 217 / 2,064,177.0000 | 216 posted closings / 2,064,177.0000 | Amount matches; Baseer uses daily closing documents rather than a one-to-one invoice count. |
| Purchases | 663 / 227,501.1000 | 663 posted / 227,501.1000 | Match. |
| Expenses + fixed expenses + HR expenses | 109 / 328,255.4300 | 109 posted / 328,255.4300 | Match. |
| Employee advances issued | 34 / 28,716.0000 | 34 / 28,716.0000 | Match. |
| Employee advance settlements | 21,116.0000 | 21,116.0000 | Match. |
| Salary payments | 7 / 166,534.7600 | 7 / 166,534.7600 | Match. |
| Total vault balances | 1,313,169.7100 | 1,313,169.7100 | Match. |

### Remaining review item

Individual vault balances still contain offsetting historical allocation differences (bank `+18,850.0000`, Sifi `-15,000.0000`, Abdulجيل `-3,850.0000`; net zero). They pre-date the payroll wave and may represent internal transfers or historical vault routing. Do not auto-adjust them without source transfer evidence.
