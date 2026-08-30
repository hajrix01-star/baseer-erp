# ARZ Noorix live-purchase backfill — 2026-08-30

## Scope

The current Noorix snapshot contained 87 active purchase invoices that were outside the verified Excel package because their source category was blank. All had a single active `PUR-001` debit ledger, one complete payment allocation, and an active source ledger.

| Metric | Result |
| --- | ---: |
| Source invoices | 87 |
| Source gross amount | 7,170.6000 |
| New Baseer documents | 76 |
| Existing documents safely reused and mapped | 11 |
| Source maps / posted journals / allocations | 87 / 87 / 87 |
| Active duplicate supplier-invoice references | 0 |

## Historical projection rules

- A blank Noorix category with a single `PUR-001` debit ledger maps to the active Baseer category `PUR-001`.
- An allocation must equal the invoice gross amount and the one active ledger must equal the same amount. Otherwise the writer refuses the record.
- If Noorix has a supplier-invoice date after the financial movement date, Baseer records the movement date in its constrained date field and retains the original Noorix date in the document note and source checksum.
- Noorix source net/VAT values are preserved exactly to four decimal places. The ordinary entry screen is not used because it can recompute VAT differently.

## Corrected rounding exception

`PUR-20260621-001` (250.0000) was initially created through the ordinary screen with net/VAT `217.3913 / 32.6087`. Noorix evidence is `217.3900 / 32.6100`. The initial document was reversed and replaced with `PUR-20260621-0002`, preserving the Noorix figures. Both the reversal and replacement remain auditable.

## Reconciliation result

After the wave, active purchases match the current Noorix snapshot exactly:

| System | Invoice count | Gross amount |
| --- | ---: | ---: |
| Noorix | 663 | 227,501.1000 |
| Baseer | 663 | 227,501.1000 |
