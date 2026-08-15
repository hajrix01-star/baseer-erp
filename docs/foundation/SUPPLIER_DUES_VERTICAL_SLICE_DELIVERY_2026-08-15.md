# Supplier Dues Vertical Slice — Delivery Record

**Status:** Implemented and verified on the isolated BASEER Docker test database.  
**Scope:** BASEER ERP private companies only. No Noorix source, data, database, or production service was changed.

## Owner policy implemented

- An unpaid supplier due is an outstanding commitment, not a cash-management expense or cash movement.
- A partial or full payment is the only event included in the management cash source, on its payment business date and for its paid amount.
- A reversed payment disappears from that management cash source in the same transaction.
- Existing Noorix supplier document numbers are retained as due source numbers; Baseer adds linked partial payment and reversal behavior without changing Noorix history.

## Delivered

- Create a supplier due in one tenant transaction with idempotency, audit evidence, supplier/category validation, and a sealed double-entry journal: debit active purchase/expense category account; credit the system supplier-dues account.
- Record partial or full payment with a company-scoped active vault and a sealed journal: debit supplier dues; credit vault asset account.
- Reverse a payment by a linked reversal record, original payment status transition to `REVERSED`, due balance restoration, and a journal reversal in the same transaction.
- Advisory locks and conditional updates protect due/payment concurrency. The due amount, paid amount, and remaining amount remain constrained and linked to immutable journal entries.
- An explicit cash-report projection reads only posted, sealed-journal payments and carries immutable category snapshots, amount, payment date, and vault. It deliberately cannot read unpaid due rows.

## Review result

The accounting, security, and Noorix-policy reviewers found no remaining P0 issue in this source increment. The authorized HTTP boundary is implemented: create, payment, reversal, full history, and paid-only cash projection derive live company context and require capabilities and idempotency for writes.

## Verification

- `prisma format`, `prisma validate`, and `prisma generate` passed.
- `npm run check --prefix apps/api` and `npm run build --prefix apps/api` passed.
- Docker/database rehearsal passed on the isolated BASEER test database, including HTTP authorization, idempotency replay, company isolation, partial payment, reversal, and paid-only cash projection.

## Subsequent scope boundary

Recurring reminders, inclusive loans, company setup commands, and their verification are complete. The next permitted scope is the bilingual company-setup UI only; do not begin live Noorix migration, reports, or sales operations.
