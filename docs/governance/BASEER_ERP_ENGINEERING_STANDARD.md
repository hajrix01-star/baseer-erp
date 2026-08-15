# Baseer ERP Engineering Standard

**Status:** Adopted baseline  
**Product:** Baseer ERP  
**Scope:** Every module, API, database migration, report, integration, and user interface.

## 1. Product principle

Baseer ERP is one modular ERP application: one identity model, one company context, one permission model, one accounting truth, one central theme system, and one database per environment. Modules are functional boundaries inside the same product; they are not separate applications or separate databases.

The `Classic` / `Baseer` choice is a visual theme preference only. It must never alter data, permissions, routes, workflows, calculations, or access to a module.

## 2. Mandatory delivery method

No module starts with a screen. Before implementation, its owner must produce and approve a **Module Discovery Record** covering:

1. Business purpose and user outcomes.
2. Current Noorix behavior and every deliberate exception.
3. Data entities, source of truth, permissions, company scope, and audit needs.
4. Financial, tax, serial, cancellation, date, and reporting effects.
5. Native API/read-model contracts and failure/retry behavior.
6. Parity matrix: preserve, harden, correct, or defer each legacy capability.
7. Acceptance tests and migration implications.

Implementation order is always:

`Discovery -> ADR and contract -> backend command/read model -> automated tests -> native UI -> reconciliation -> owner acceptance -> cutover`

A module cannot be called complete while its main workflow silently opens a legacy screen.

## 3. Backend is the business authority

- React/mobile clients display server receipts and collect input; they do not calculate totals, VAT, balances, ratios, period boundaries, serials, or ledger effects.
- Every financial command is server-side, validated, permission-scoped, company-scoped, idempotent, auditable, and atomic.
- Reads are server projections with explicit source, period, basis, currency, and generated-at metadata.
- UI filters carry an intent (such as `month=2026-07`); the server resolves dates, inclusion rules, aggregates, and timeline data.
- Decimal values remain decimal end-to-end. JavaScript floating-point arithmetic is prohibited for money.

## 4. Saudi business date and language rules

- The central business timezone is `Asia/Riyadh` unless a future approved company policy changes it.
- A business date is a calendar `DATE`; an event instant such as `issuedAt` is a separate timestamp; audit time is separate again.
- A selected month means its entire Saudi calendar month. Period movement begins at zero for the selected period; cumulative balances must be explicitly labelled **as of date**.
- All visible digits are English `0-9` in both Arabic and English interfaces.
- Every workflow supports Arabic RTL and English LTR on desktop and mobile. Touch targets are at least 44px; accessibility target is WCAG 2.2 AA.

## 5. Finance policies that must be preserved

### 5.1 Periods and prior data

- Baseer ERP is a personal multi-company ERP, not a resale accounting product with mandatory lock-down.
- There is no automatic fiscal-period closing policy.
- The owner may amend or cancel eligible historical operations. Authorization, audit, and integrity checks still apply.
- The operation history remains visible; an amendment must be traceable to its prior state.

### 5.2 Cancellation and deletion

- Cancellation preserves the document, its serial, reason, actor, and audit trail.
- Financial cancellation creates or marks the authoritative reversal/cancellation effect. It must not erase business history.
- Hard deletion is prohibited for posted financial documents, ledger evidence, and audit evidence.

### 5.3 Vaults and transfers

- Negative vault balances are permitted by product policy. They are not rejected merely because the resulting balance is negative.
- The backend may show a warning and retain monitoring data, but must not silently change the operation or block it under a generic insufficient-funds rule.
- A transfer never changes profit or loss: it affects the source and destination vaults only.
- Period movement and balance-as-of are different concepts and must be labelled separately.

### 5.4 Document serials

- Every financial operation receives a central, immutable, non-reusable serial.
- Existing recognizable prefixes may be retained through migration, including `DS`, `PUR`, `EXP`, `TRF`, and `TRV`.
- New serial allocation is atomic and concurrency-safe. Count-plus-one in application memory is prohibited.
- Cancellation never releases or reuses a serial.

### 5.5 VAT and reports

- Management reports default to **gross amounts inclusive of VAT**. Example: a sale of 115 SAR is shown as sales of 115 SAR by default.
- The **Separate VAT** control requests a server projection that returns gross, net, and VAT separately; it never divides values in the browser or changes accounting entries.
- The authoritative financial record stores/derives `netAmount`, `taxAmount`, and `grossAmount` as appropriate. Switching display mode does not change a document or ledger entry.
- VAT disclosure uses approved, classified financial documents and server-side logic. Browser local storage, editable client totals, and dashboard widgets are never tax sources of truth.
- Profit-and-loss labels must explicitly state their basis. A gross management card must never be presented as accounting profit.

## 6. Security and data integrity

- Tenant and company isolation are enforced in every API and database query; database RLS is enabled for protected tenant data where applicable.
- Authorization is exact and server-enforced. A hidden UI control is not authorization.
- Write commands use strict allowlisted DTOs, transactions, audit logs, idempotency key plus canonical request hash, and safe replay/conflict behavior.
- Sensitive commands require confirmation phrases when appropriate; cancellation, archive, import, reset, and recovery must have explicit policies.
- No `any`, `as any`, or `as never` may bypass typing. A documented, locally contained boundary adapter is the only exception.
- Dependencies, secrets, CI artifacts, and build outputs are protected under a secure-development process aligned with NIST SSDF and OWASP ASVS.

## 7. Architecture and code quality

- Baseer ERP is a modular monolith: shared platform kernel plus bounded modules, not a set of disconnected micro-applications.
- Core owns identity, companies, permissions, sessions, theme tokens, business date, files, audit, idempotency, sequence allocation, errors, and observability.
- Modules own their workflows and contracts, but never duplicate the core, user, company, ledger, or theme tables.
- Public contracts are versioned and documented. Migrations are additive/reversible where possible, preflighted, and verified before production.
- Every pull request passes formatting, static type checks, unit tests, integration/contract tests, and targeted end-to-end tests. Financial changes also pass reconciliation fixtures.

## 8. Reliability and operation

- Production has structured logs, correlation IDs, metrics, alerts, backups, restore drills, and incident runbooks.
- Critical routes receive explicit availability and latency SLOs. Error budgets govern release pace when reliability degrades.
- Deployments are reversible and use staging/rehearsal for schema and data changes. No untested migration is applied to live data.

## 9. Noorix migration rule

- Noorix remains a read-only behavioral and data reference during the build. Baseer ERP must not dual-write to the online legacy system.
- Migration is conducted through repeatable snapshot/export, mapping, staging import, ambiguity rejection, and reconciliation.
- Reconciliation covers company/user mapping, documents, cancellations, serials, gross/net/VAT, ledger totals, vault movement and balance-as-of, attachments, and audit references.
- Cutover requires a short write freeze, final delta import, full reconciliation, owner approval, and a rollback/archive plan. Noorix then becomes read-only archive, not a hidden runtime dependency.

## 10. Definition of done for a capability

A capability is complete only when all conditions are true:

1. Its discovery and parity decisions are approved.
2. The server owns its rules and calculations.
3. Permission, tenant/company isolation, audit, idempotency, cancellation, and concurrency tests pass.
4. Native UI supports normal, empty, loading, denied, failure, retry, and stale-company states in Arabic and English on mobile and desktop.
5. There is no silent legacy handoff.
6. Its server report/timeline/filter data is reconciled with approved legacy fixtures where parity is required.
7. Observability, recovery, and operational documentation are present.
8. The owner has accepted the workflow.

## 11. External engineering references

- NIST Secure Software Development Framework (SSDF): https://csrc.nist.gov/projects/ssdf
- OWASP Application Security Verification Standard (ASVS): https://owasp.org/www-project-application-security-verification-standard/
- W3C Web Content Accessibility Guidelines 2.2: https://www.w3.org/TR/WCAG22/
- Google SRE Workbook, error-budget policy: https://sre.google/workbook/error-budget-policy/

