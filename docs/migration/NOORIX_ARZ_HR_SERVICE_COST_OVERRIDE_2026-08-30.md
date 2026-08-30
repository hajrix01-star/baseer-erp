# Noorix ARZ HR service-cost correction — 2026-08-30

## Owner-approved handling

Two Noorix residency service rows had impossible date pairs (expiry before issue). The owner approved ignoring those service start/end dates while retaining the original **operation date** and issuing the source-backed invoice.

This does not relax normal employee-service entry. A migration-only internal workflow may omit both service dates only when they are unknown or inconsistent; it still requires the employee, service reference, supplier, expense category, original operation date, paid allocation, source invoice reference, and a posted journal.

## Written and reconciled facts

| Employee | Noorix invoice | Baseer invoice | Operation date | Amount | Settlement |
| --- | --- | --- | --- | ---: | --- |
| AR-ST-028 Ahmed Dabbour | HR-20260609-001 | EXP-20260609-0001 | 2026-06-09 | 1,650.0000 | Bank V-002 |
| AR-ST-017 Shaheen | HR-20260825-001 | EXP-20260825-0001 | 2026-08-25 | 2,588.0000 | Bank V-002 |

Both employee-service records are `ISSUED`, both cost documents are `POSTED`, and both retain the Noorix invoice number as their supplier invoice reference. Source-to-target mappings and review acknowledgements were appended for auditability and idempotent retry.

## Preventing a repeat

For new company migrations, validate service issue/expiry order before the ordinary HR writer. If a source date pair is invalid but a matching active source invoice and ledger prove the amount, category, vault, employee, and transaction date, use the restricted historical workflow only after owner approval. Never manufacture an expiry date merely to satisfy a normal workflow validation.
