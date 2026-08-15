# Finance Journal Kernel — Delivery Record

**Status:** Implemented source foundation; database rehearsal remains a local-test/deployment step.  
**Scope:** BASEER ERP only. No Noorix data, source, or database was modified.

## Delivered

- Immutable double-entry journal entries and lines, scoped by tenant, company, fiscal period, account, source reference, and actor.
- Database-enforced journal invariants: at least two lines, positive balanced debit/credit totals, and exactly one debit or credit value on every line.
- Sealing after the initial lines are posted. A sealed entry cannot receive extra lines, and entries/lines cannot be deleted or edited.
- Reversal by a separate sealed entry only. The original can move from `POSTED` to `REVERSED` only when that database-linked reversal exists.
- Central posting service that runs inside the caller transaction, validates exactly one open period and active company accounts, serializes duplicate source posting, and writes audit evidence.
- Fiscal-period lifecycle: open, close with a mandatory reason, lock, and reopen of closed periods only with a mandatory reason. Locked periods remain correction-by-reversal/adjustment only.
- A shared advisory lock between posting and period transitions, so an entry cannot pass its open-period check and then commit after that period has closed.
- Database prevention of overlapping company fiscal periods and append-only protection for audit events. The database-role grant script explicitly removes update/delete from `AuditEvent`.

## Deliberate boundaries

- There are no public journal endpoints. Any future command must first use authorized company context and idempotency before it enters this transaction-only posting service.
- Supplier dues, sales, expenses, loans, recurring reminders, reports, and Noorix import are not yet connected to the journal. They must use this kernel rather than write balances directly.
- The source code was validated, but no migration was applied because the test-only `BASEER_TEST_DB_PASSWORD` and `BASEER_TEST_BOOTSTRAP_PASSWORD` values are still unset. No substitute secret was created.

## Verification completed

- `prisma format`
- `prisma validate`
- `prisma generate`
- `npm run check --prefix apps/api`
- `npm run build --prefix apps/api`

## Next mandatory increment

Build one complete supplier-dues transaction slice: create due, partial/full payment, reversal, idempotency, audit, company authorization, and journal/vault linkage. Ordinary management reports must continue to count only paid amounts, as documented in the approved cash-basis policy.
