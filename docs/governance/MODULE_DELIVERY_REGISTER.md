# BASEER ERP Module Delivery Register

**Last updated:** 2026-08-21
**Current authority:** [CURRENT_DELIVERY_AUTHORITY.md](CURRENT_DELIVERY_AUTHORITY.md)

## Current focus

| Field | Value |
| --- | --- |
| Active work | **Operations Core — verification and owner acceptance**: catalogue, recipes/conversions, purchase request/receipt, inventory/custody, internal registration and operational Assets & Warranty Gate A. UI Platform Enablement remains an ongoing cross-cutting authority, not a competing business scope. |
| Open owner acceptance | Operations Core requires its consolidated browser and data-integrity acceptance. Reports remains a separate candidate. |
| Next decision gate | تشغيل بوابات Operations من revision محدد، ثم قبول المالك لتدفقات المستخدم. الإنتاج وNoorix والتقارير الرسمية تبقى بوابات منفصلة. |
| Explicitly deferred | Noorix import/cutover, production release, bank reconciliation, cash count/handover accounting, transfer reversal, official reports/P&L, assets accounting, external marketing/AI work. |

## Portfolio state

| Scope | State | Delivered locally | Boundary still open |
| --- | --- | --- | --- |
| Baseer UI Platform Enablement | **Active — operating authority for eligible libraries** | Governance, monitor model, staged plan, CSS-budget recovery, complete-session HR E2E fixture and local-database guard are recorded and re-verified at `cc9c89d3300fd09c7cf9da413f85b172e32d6d62`. HR now has bounded React Aria controls, an RHF/Zod validation form, company/session-scoped Query read and an ECharts operational visualisation with a matching HTML table. Docker hardening removes the Prisma advisory path from the public API runtime while keeping a hardened internal migration job. | The [operating authority](LIBRARY_ADOPTION_OPERATING_AUTHORITY.md) permits further eligible library phases after their gates, without per-library owner authorization. Excluded categories and the current Prisma P1 remain separately governed; no production, dashboard, API/RLS/permission or financial change is implied. |
| Platform foundation | Verified locally | Identity, company context, RBAC, audit, idempotency, business date, sequences, files, output and observability foundations. | Production backup/restore evidence and production deployment. |
| Finance journal and master data | **Closed — local owner acceptance** | Posted balanced journal, periods, accounts/categories, suppliers, tax-rate configuration, recurring profiles, dues and inclusive loans; governed cancellation policy. | Tax-code model beyond one company VAT rate; production controls remain separate. |
| Purchase & Expense | **Closed — local owner acceptance** | Batch purchase/expense input, VAT-inclusive server calculation, supplier credit on cash payment, recurring expenses, payment histories and governed cancellation. | Official long-range reporting and production are separate scopes. |
| Expenses & Obligations | **Closed — local owner acceptance** | Cash payments, supplier dues, recurring profiles, loan obligations, settlement paths and governed cancellation. | Official long-range reporting and production are separate scopes. |
| Treasury and vaults | **Closed — local owner acceptance** | Ledger-derived balances, vault lifecycle, payment methods, balanced internal transfer, bounded activity, daily account-balance projection and control observations. | Bank connectivity, automated reconciliation and external transfer remain excluded. |
| Suppliers and categories | **Closed — local owner acceptance** | Company-scoped master-data maintenance, safeguarded archive, category hierarchy and server-backed lookup for long lists. | Future seed/business-profile extensions are separate. |
| Unified Invoice Register | **Closed — local owner acceptance (read-only)** | Posted financial movements except internal vault transfers, server filters, dynamic server summaries, stable pages and cancelled-status presentation. | Official report/P&L scope; multi-year aggregate read model and volume proof. |
| Daily Sales Closing | Ready for owner acceptance | Aggregated operating-day close, bounded history and read-only operational calendar. | Owner UI acceptance; it is not a POS or formal reporting replacement. |
| Human Resources | **Closed — Go on local test database** | Employee file, compensation, leave, services, advances/deductions, payroll drafts through payment/cancellation, final settlements, print/output controls, RLS and HR browser coverage. | For another database: apply HR RLS as table owner and re-run the HR lifecycle, HTTP, integrity and browser gates. Production/cutover acceptance remains a separate decision. |
| Administration and access | Foundation enhanced | Company/user/role management, session revocation, audit redaction and last-owner protection. | Invitations, MFA and production file lifecycle. |
| Reports and Command Center | **Candidate in current working tree — local verification passed** | Report-run policy, personal cash-performance view, Ledger Trial Balance, VAT view, report documents and bounded output paths compile and their targeted policy verifiers pass; Finance Gate B and `verify:web-budget` pass after the fixture and route-splitting updates. | Owner/governance acceptance remains required. Formal accrual P&L remains deferred. |
| Operations (catalogue, purchasing, inventory and custody) | **Active — technical verification passed; owner acceptance pending** | Items, units, recipe/conversion data, purchase request/receipt, inventory movement, custody, internal registration and operation reports; purchase-cycle, Finance Gate B and `verify:web-budget` passed on the local test database. | Complete the recorded owner browser flow in [Operations verification](OPERATIONS_CORE_VERIFICATION_RECORD_2026-08-22.md). No financial policy or external integration is activated. |
| Assets & Warranty | **Active inside Operations Core — Gate A technically verified** | Operations section: Purchase & Expense follow-up marker, company-scoped queue, operational register, warranty dates/lines, archive, permissions, audit and idempotency. `verify:operations-assets-warranty` confirms no financial journal is created or changed; the shared web budget passes. | Gate A owner acceptance is part of Operations. Capitalization, depreciation, disposal, claims, attachments and split-source assets remain separate scopes. |
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
