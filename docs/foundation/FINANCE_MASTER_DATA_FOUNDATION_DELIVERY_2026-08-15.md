# Finance Master-Data Foundation — Delivery Record

**Status:** Implemented source foundation; database application remains a local-test/deployment step.  
**Date:** 2026-08-15  
**Scope:** BASEER ERP only. No Noorix database, source data, or production service was changed.

## Delivered now

- Company-isolated finance profile, accounts, categories, suppliers, and supplier-copy provenance in the Prisma schema.
- A new additive Baseer-only SQL migration with composite company/tenant foreign keys, constraints, indexes, row-level security, and forced RLS.
- Protected finance account seed service for a company. It preserves compatible Noorix codes where meanings match and adds BASEER controls for supplier dues, VAT input/output, prepaid expenses, owner equity, retained earnings, and fixed assets.
- Company-local base categories for purchases, sales, government fees, rent/utilities, payroll, operations, marketing, finance, and legacy asset/equipment expenses.
- An initialization service that runs in one tenant transaction, serializes concurrent initialization, creates an audit event, and is idempotent after the first successful seed.
- Authenticated supplier-copy API: it shows only supplier cards from companies the actor is allowed to read, then copies a selected supplier into the target company with category mapping, duplicate checks, idempotency, provenance, and audit evidence. It exposes no source invoices, dues, balances, payments, employees, or attachments.
- Company-isolated fiscal-period and vault tables with forced row-level security. Periods have open/closed/locked lifecycle fields; vaults must map to one active asset account and can independently be a sales channel or payment destination.
- Server guards that reject a financial date unless exactly one open company period covers it, reject overlapping periods, and reject payment destinations outside the company or without an active asset account.

## Explicitly not delivered in this increment

- Company-setup screen that combines seed review and the supplier-copy API into a guided browser workflow.
- Journal posting, invoices, supplier dues, partial payments, recurring-expense reminders, loans, reports, and browser configuration screens for periods/vaults.
- Noorix import or live data migration.

These remain separate Finance increments because they require their own authoritative posting, period, reconciliation, and report-read-model controls.

## Verification

- `prisma validate` passed for `apps/api/prisma/schema.prisma`.
- Prisma client generation passed.
- `npm run check --prefix apps/api` passed.
- `npm run build --prefix apps/api` passed.

The Docker migration rehearsal was not run because the local test-only `BASEER_TEST_DB_PASSWORD` and `BASEER_TEST_BOOTSTRAP_PASSWORD` values are unset. No substitute secret was created and no database was changed.

## Next implementation increment

Build supplier dues and partial payments on the completed period/vault guards, then add recurring-expense reminders and inclusive-loan records. The browser company-setup workflow follows the same server foundations.

