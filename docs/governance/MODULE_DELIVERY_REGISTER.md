# BASEER ERP Module Delivery Register

**Last updated:** 2026-08-20
**Current authority:** [CURRENT_DELIVERY_AUTHORITY.md](CURRENT_DELIVERY_AUTHORITY.md)

## Current focus

| Field | Value |
| --- | --- |
| Active work | Local stabilization of financial read scale and owner verification of existing Finance journeys. |
| Open owner acceptance | Purchase & Expense, Expenses & Obligations, Treasury, Suppliers, Categories, and Invoice Register in AR/EN, RTL/LTR, desktop and mobile. |
| Next decision gate | Record owner acceptance and the correction/cancellation policy before official financial reporting. |
| Explicitly deferred | Noorix import/cutover, production release, bank reconciliation, cash count/handover accounting, transfer reversal, official reports/P&L, assets accounting, external marketing/AI work. |

## Portfolio state

| Scope | State | Delivered locally | Boundary still open |
| --- | --- | --- | --- |
| Platform foundation | Verified locally | Identity, company context, RBAC, audit, idempotency, business date, sequences, files, output and observability foundations. | Production backup/restore evidence and production deployment. |
| Finance journal and master data | Phase 1 verified locally | Posted balanced journal, periods, accounts/categories, suppliers, tax-rate configuration, recurring profiles, dues and inclusive loans. | Financial correction/cancellation policy; tax-code model beyond one company VAT rate. |
| Purchase & Expense | Owner verification | Batch purchase/expense input, VAT-inclusive server calculation, supplier credit on cash payment, recurring expenses and payment histories. | AR/EN/RTL/LTR/mobile owner acceptance; correction/cancellation. |
| Expenses & Obligations | Owner verification | Cash payments, supplier dues, recurring profiles, loan obligations and settlement paths. | Owner acceptance; official long-range reporting. |
| Treasury and vaults | Owner verification | Ledger-derived balances, vault lifecycle, payment methods, balanced internal transfer, bounded activity and daily account-balance read projection. | Owner acceptance; cash count, reconciliation, external transfer and reversal are excluded. |
| Suppliers and categories | Owner verification | Company-scoped master-data maintenance, safeguarded archive, category hierarchy and server-backed lookup for long lists. | Owner acceptance and final seed/business-profile policy. |
| Unified Invoice Register | Read-only local delivery | Posted financial movements except internal vault transfers, server filters, dynamic server summaries and stable pages. | Official report/P&L scope; multi-year aggregate read model and volume proof. |
| Daily Sales Closing | Ready for owner acceptance | Aggregated operating-day close, bounded history and read-only operational calendar. | Owner UI acceptance; it is not a POS or formal reporting replacement. |
| Human Resources | **Closed — Go on local test database** | Employee file, compensation, leave, services, advances/deductions, payroll drafts through payment/cancellation, final settlements, print/output controls, RLS and HR browser coverage. | For another database: apply HR RLS as table owner and re-run the HR lifecycle, HTTP, integrity and browser gates. Production/cutover acceptance remains a separate decision. |
| Administration and access | Foundation enhanced | Company/user/role management, session revocation, audit redaction and last-owner protection. | Invitations, MFA and production file lifecycle. |
| Reports and Command Center | Not started as official reporting | Operational cards/calendar exist where stated by the source module. | Reconciled reports, P&L, exports and official report read models. |
| Assets & Warranty | Planned | Purchase follow-up marker only. | Dedicated asset/warranty register and separate capitalization/depreciation policy. |
| Migration and cutover | Discovery only | Noorix mapping/discovery and cutover gates. | Importer, staging dry run, reconciliation and cutover approval. |
| Marketing, inbound, AI provider, remaining modules | Not started or deferred | AI platform guardrails only; no provider execution. | Separate authorized scopes after core finance gates. |

## Financial read-scale baseline

The following are implemented locally and governed by [FINANCIAL_READ_SCALE_AND_PERIOD_STANDARD_2026-08-18.md](FINANCIAL_READ_SCALE_AND_PERIOD_STANDARD_2026-08-18.md):

- current Riyadh business month as the shared default for period-aware views;
- bounded server pages and stable cursors for the financial register, supplier due/payment history, daily sales, outflow history, and treasury activity;
- server-owned financial totals and filters; no browser totals from partially loaded records;
- remote lookup for large supplier/category selections;
- a rebuildable `FinanceAccountDailyBalance` projection sourced from posted journal lines for vault balance reads.

This baseline is not a production-volume certificate. Multi-year benchmark datasets, query plans, p95 measurements, and reporting fact/rollup models remain open.

## Required evidence before a state change

- `scripts/run-finance-gate-b-db-verification.mjs` for financial journal/integrity evidence.
- `scripts/run-finance-period-race-verification.mjs` for close-versus-post locking.
- `scripts/run-daily-sales-http-verification.mjs` for bounded financial read receipts.
- Contracts/API/Web checks and builds relevant to the change.
- Owner browser acceptance for user-facing financial journeys.
- Before production or cutover: backup/restore rehearsal, Noorix dry run/reconciliation, and the scale evidence described above.

## Control rule

Exactly one business scope may be active for new implementation or verification. A historical document is evidence, not an activation instruction. No browser calculation, direct database write, manual journal route, live Noorix migration, production deployment, external marketing action, or AI side effect is allowed outside the approved authority.
