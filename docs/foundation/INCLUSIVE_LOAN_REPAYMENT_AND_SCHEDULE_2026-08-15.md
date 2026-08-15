# Inclusive Loan Repayment and Schedule — Delivery Record

**Status:** Implemented and verified on the isolated BASEER Docker test database.  
**Scope:** BASEER ERP only. No Noorix data, database, or service was changed.

## Behavior

- The opening loan records an already-existing inclusive liability; it does not put cash into a vault.
- A plan is generated from the first due date, monthly term, and installment amount. The final installment may be lower than the regular installment, but the plan must exactly cover the opening outstanding balance.
- Each actual repayment posts **debit inclusive-loan liability / credit selected vault asset** and decreases the single inclusive balance.
- A repayment reversal creates a linked reversal record, marks the original payment reversed, restores the balance, and reverses the journal entry. No history is deleted.
- Baseer deliberately does not split principal, interest, or fees in loan data, posting, schedule, or reporting.

## Delivered controls

- Tenant/company-isolated installment-plan and repayment records with RLS, composite foreign keys, amount constraints, and reversal uniqueness.
- Idempotency, audit events, advisory locks, conditional balance updates, active-vault checks, and open-period journal posting for payment commands.
- Authorized HTTP commands are exposed only through live company context, capability checks, strict request/response contracts, and idempotency keys.

## Verification

- Prisma format, validate, and generate passed.
- API TypeScript check and build passed.
- The BASEER-only Docker test database verification passed for repayment and reversal. No Noorix, production, or real data was accessed.
