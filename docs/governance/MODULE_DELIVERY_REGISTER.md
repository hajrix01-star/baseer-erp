# BASEER ERP Module Delivery Register

**Last updated:** 2026-08-24
**Current authority:** [CURRENT_DELIVERY_AUTHORITY.md](CURRENT_DELIVERY_AUTHORITY.md)

## Current focus

| Field | Value |
| --- | --- |
| Active work | **Marketing & Reputation — A1 + P2 internal analytics + P3a connection control centre.** سجل الحملات وسياسة ردود السمعة وروابط المستندات والسياق وقراءة التقويم، ثم حالة طلب تهيئة Google المعزولة بلا اتصال حي. |
| Open owner acceptance | قبول A1/P2 بعد اختبارات contracts/API/RLS/audit/UI. تبقى Production وNoorix والتقارير الرسمية وGoogle وAI بوابات مستقلة. |
| Next decision gate | قبول A1 ثم اكتمال القسم الداخلي. الموصلات تأتي آخر النطاق؛ وعند اعتماد كل PDR يكون ربط كل شركة ذاتياً من الواجهة، لا تدخلاً برمجياً. |
| Explicitly deferred | Noorix import/cutover, production release, external bank connectivity/automated reconciliation, official reports/P&L, assets accounting, invitations/MFA, Google/provider integration and AI provider execution. |

## Portfolio state

| Scope | State | Delivered locally | Boundary still open |
| --- | --- | --- | --- |
| Baseer UI Platform Enablement | **Active — operating authority for eligible libraries** | Governance, monitor model, staged plan, CSS-budget recovery, complete-session HR E2E fixture and local-database guard are recorded and re-verified at `cc9c89d3300fd09c7cf9da413f85b172e32d6d62`. HR now has bounded React Aria controls, an RHF/Zod validation form, company/session-scoped Query read and an ECharts operational visualisation with a matching HTML table. Docker hardening removes the Prisma advisory path from the public API runtime while keeping a hardened internal migration job. | The [operating authority](LIBRARY_ADOPTION_OPERATING_AUTHORITY.md) permits further eligible library phases after their gates, without per-library owner authorization. Excluded categories and the current Prisma P1 remain separately governed; no production, dashboard, API/RLS/permission or financial change is implied. |
| Platform foundation | Verified locally | Identity, company context, RBAC, audit, idempotency, business date, sequences, files, output and observability foundations. | Production backup/restore evidence and production deployment. |
| Finance journal and master data | **Closed — local owner acceptance** | Posted balanced journal, periods, accounts/categories, suppliers, tax-rate configuration, recurring profiles, dues and inclusive loans; governed cancellation policy. | Tax-code model beyond one company VAT rate; production controls remain separate. |
| Finance and Accounting UI migration | **Closed — local owner acceptance and library migration** | Forms, Gregorian dates, scoped remote selectors and server cursor grids are centralized; money remains exact Decimal strings and account summaries are server-owned. Reference `a1cbf54`; inventory/browser/HTTP/RLS/journal/period/budget gates pass. | Production, Noorix, formal reporting, bank connectivity and volume certification remain separate. |
| Purchase & Expense | **Closed — local owner acceptance** | Batch purchase/expense input, VAT-inclusive server calculation, supplier credit on cash payment, recurring expenses, payment histories and governed cancellation. | Official long-range reporting and production are separate scopes. |
| Expenses & Obligations | **Closed — local owner acceptance** | Cash payments, supplier dues, recurring profiles, loan obligations, settlement paths and governed cancellation. | Official long-range reporting and production are separate scopes. |
| Treasury and vaults | **Closed — local owner acceptance** | Ledger-derived balances, vault lifecycle, payment methods, balanced internal transfer, bounded activity, daily account-balance projection and control observations. | Bank connectivity, automated reconciliation and external transfer remain excluded. |
| Suppliers and categories | **Closed — local owner acceptance** | Company-scoped master-data maintenance, safeguarded archive, category hierarchy and server-backed lookup for long lists. | Future seed/business-profile extensions are separate. |
| Unified Invoice Register | **Closed — local owner acceptance (read-only)** | Posted financial movements except internal vault transfers, server filters, dynamic server summaries, stable pages and cancelled-status presentation. | Official report/P&L scope; multi-year aggregate read model and volume proof. |
| Daily Sales Closing | Ready for owner acceptance | Aggregated operating-day close, bounded history and read-only operational calendar. | Owner UI acceptance; it is not a POS or formal reporting replacement. |
| Human Resources | **Closed — local owner acceptance and library migration** | Employee file, compensation, leave, services, advances/deductions, payroll and final settlements use the central form/combobox/date/query/chart/grid adapters. Reference `6942b50`; inventory, browser, HTTP, RLS and financial gates pass. | For another database: apply HR RLS as table owner and re-run lifecycle, HTTP, integrity and browser gates. Production/cutover acceptance remains separate. |
| Administration and access | **Closed — local owner acceptance and library migration** | Company/user/role forms, company/session-scoped overview query, intentional bounded users table, session revocation, audit redaction, last-owner protection and Administration RLS 9/9. Final reference `33a7175`; browser/lifecycle/RBAC/session/build/budget gates pass. | Invitations, MFA, horizontal API scaling and production file lifecycle remain separate. |
| Reports | **Closed — local owner acceptance and library migration** | Live catalogue/documents queries; snapshot Trial Balance, cash-performance and VAT reads; frozen ReportRun/document boundaries; intentional bounded report tables; HTTP/RLS/policy/browser evidence. Reference `82ae65d`; inventory/build/budget/audit gates pass. | Formal accrual P&L, official tax filing, Hajri Tax implementation, long-range scale proof and production remain separate. |
| Decision Intelligence | **Closed — local owner acceptance and library migration** | Section-scoped company/session queries, centralized forms and dates, exact decimal policy inputs, stable idempotency mismatch receipts and Decision HTTP/RLS/browser evidence. Reference `97c99bf`; inventory/build/budget/audit gates pass. | New metrics, chart-series contracts, external providers, decision policies and production remain separate. |
| Command Center | **Closed — local owner acceptance and library migration** | The live operational calendar uses a company/session/period-scoped Query, capability guard, exact Decimal display and server receipt verification. Reference `9742d09`; Command HTTP/RLS/browser/build/budget/audit gates pass. | New executive KPIs, priorities, alerts/activity features and production remain separate product scopes. |
| Operations (catalogue, purchasing, inventory and custody) | **Closed — local owner acceptance and library migration** | Items, units, recipes/conversions, purchase request/receipt, inventory movement, custody, internal registration and operation reports. Browser E2E, 12-scope DB verifier, migration inventory and release budgets pass from `c53ba7d`; server paging/filtering covers the large catalogue and report surfaces. | No financial policy, formal financial report, Noorix or external integration is activated. Intentional bounded `DataTable` surfaces are final lightweight decisions, not legacy. |
| Assets & Warranty | **Closed locally inside Operations Core — Gate A** | Operations section: Purchase & Expense follow-up marker, company-scoped queue and operational asset/warranty register; archive, permissions, audit, idempotency and no-finance-posting behavior are verified. | Capitalization, depreciation, disposal, claims, attachments and split-source assets remain separate scopes rather than unfinished Gate A work. |
| Migration and cutover | Discovery only | Noorix mapping/discovery and cutover gates. | Importer, staging dry run, reconciliation and cutover approval. |
| Marketing & Reputation | **Active — A1 + P2 + P3a control centre** | سجل الحملات وسياسة ردود السمعة، وروابط مرجعية مدققة للمستند المالي القائم والسياق المنشور، وقراءات الحملة/التقويم الخادمية، وإيقاف حملة مدقق (تاريخ + سبب + نهاية فعلية للفترة)، وحالة/طلب تهيئة Google معزول. لا provider facts ولا أسرار أو اتصال خارجي. | اختبار/قبول القسم الداخلي وP3a أولاً. الموصلات الحية هي آخر بناء النطاق: PDR منفصل ثم تفعيل ذاتي من الواجهة لكل شركة لـAds (read-only) وGoogle Business (read ثم ردود حية محكومة). |
| Inbound, AI provider, remaining modules | **Basira pilot active; other work deferred** | One local/personal OpenAI explanation-only path for checksum-valid Decision alerts, behind `platform.ai.use`, server-only frozen brief, encrypted credential and explicit server enablement. | Provider configuration, manual quality review and pilot evidence are required before any outbound request. Generic chat, actions/tools, other modules/providers and production remain deferred. |

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
