# Inclusive Opening Loans and Recurring Reminders — Decision and Delivery

**Status:** Implemented and verified on the isolated BASEER Docker test database.  
**Scope:** BASEER ERP private companies. No Noorix data or database was changed.

## Owner decision implemented

An inclusive loan can already have been disbursed and spent outside the company cash currently visible in Baseer. Creating such a loan must therefore **not** add money to a vault, income, or expense.

The loan creation record stores:

- original inclusive loan amount;
- opening outstanding amount when Baseer begins (defaults to the original amount in the future setup screen unless the owner enters the remaining balance);
- installment amount, number of months, and first installment due date;
- source document number and optional notes.

Its opening journal is **debit opening-balance clearing / credit inclusive loans**. It records the existing liability while keeping every vault unchanged. The owner-approved inclusive policy remains in force: Baseer does not split principal, interest, or fees.

## Recurring expenses

Recurring expenses are profiles/reminders only: category, optional supplier, expected amount, interval, and next reminder date. Creating one never posts a due, expense, vault movement, or journal entry. A real paid bill will later use the approved supplier-due or expense command.

## Delivered source components

- Company-isolated Prisma records and RLS migration for recurring profiles, inclusive loans, and future loan payment records.
- `RecurringExpenseService.createProfile`, which only creates an auditable reminder profile.
- `InclusiveLoanService.createOpeningLoan`, which validates the opening loan data, uses idempotency and audit evidence, and posts the opening liability without a cash movement.

## Delivered continuation

Loan installment payments and reversals are now implemented and verified. They post debit inclusive-loan liability / credit selected vault and never split principal, interest, or fees. A future UI may show the stored schedule; it must not calculate financial values in the browser.

## Verification

- Prisma format, validate, and generate passed.
- API TypeScript check and build passed.
- The isolated BASEER Docker test database verification passed, including opening loans, repayment, reversal, company isolation, journal integrity, and period locking. Evidence: `scripts/run-finance-gate-b-db-verification.mjs` and `scripts/run-gate-b-db-verification.mjs`.
