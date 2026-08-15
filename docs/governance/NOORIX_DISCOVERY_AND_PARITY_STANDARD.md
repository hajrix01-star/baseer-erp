# Noorix Discovery and Workflow-Parity Standard

**Status:** Mandatory and binding extension to `BASEER_ERP_ENGINEERING_STANDARD.md`  
**Applies before:** Any Baseer ERP module, route, API, schema, report, or migration is designed.

## 1. Why Noorix must be understood first

Noorix is the current operational system for the owner's companies. It is not merely an old interface and it is not source code to copy. It is the reference from which Baseer ERP must learn:

- what each section is for;
- what a user enters and in what order;
- which defaults and exceptions are deliberate;
- which document, serial, accounting, tax, reporting, and audit effects follow;
- which company, role, and owner permissions govern the workflow.

The purpose of Baseer ERP is to build a more professional, coherent, secure, mobile-ready, bilingual application **without accidentally changing the intended operational steps, sections, or business outcomes of Noorix**.

## 2. Required investigation before build

For each module and every user task inside it, the delivery owner must inspect Noorix in this order:

1. The module's business purpose and the users who rely on it.
2. The visible route, navigation, tables, forms, filters, defaults, empty states, and exports.
3. The complete input journey: entry point, prerequisite context, fields, field order, conditional fields, validation, confirmation, retry, edit, and cancellation.
4. The backend/API/service implementation, DTOs, authorization, company/tenant predicates, transaction boundaries, and audit behavior.
5. The underlying data model, relations, serials, status transitions, attachments, and report readers.
6. Accounting, VAT, vault, inventory, payroll, or other downstream effects where relevant.
7. Historical and exceptional cases using representative data, not just a happy-path screenshot.

Discovery is incomplete if it relies only on a UI screenshot, a document, or a single endpoint where executable behavior and data relationships are available.

## 3. Mandatory parity record

Before code starts, publish a Module Discovery Record containing:

| Required item | What it proves |
| --- | --- |
| Purpose and boundaries | Why the module exists and what it must not own |
| Noorix section map | Routes, screens, tabs, user jobs, and dependencies |
| Workflow map | Inputs, defaults, validations, commands, outcomes, edits, cancels, retries |
| Data and source-of-truth map | Tables/entities and authoritative write/read source |
| Effects map | Serial, ledger, VAT, vault, inventory, payroll, audit, notifications, attachments |
| Permission/company map | Exact permissions and tenant/company/owner rules |
| Exception register | Deliberate non-standard policies and their reason |
| Parity decision register | Preserve, harden, correct, or defer for every capability |
| Acceptance fixtures | Normal, historical, cancelled, retry, denied, multi-company, and exceptional cases |
| Migration impact | Legacy fields/IDs/statuses/files/references that must map or be rejected |

Every workflow is drawn in this form:

`entry point -> context -> input/defaults -> validation -> command -> serial/document -> domain or accounting effect -> list/report visibility -> edit/cancel/retry -> audit`

## 4. Four permitted decisions for legacy behavior

Every observed Noorix behavior receives one documented decision:

1. **Preserve** — it is intentional and Baseer ERP keeps the same material outcome.
2. **Harden** — the outcome remains the same, while security, concurrency, audit, validation, accessibility, or recovery improves.
3. **Correct** — a verified defect is changed only after recording the old and new outcome and obtaining approval.
4. **Defer** — the capability is not in the current release and appears in the delivery register. It cannot be silently hidden behind a legacy route.

No fifth category exists. “We assumed it was unimportant” is not an acceptable decision.

## 5. Explicit policies already approved for parity

- Month filters represent the whole Saudi calendar month; period movement starts at zero.
- Cumulative balances are separate and labelled **as of date**.
- Negative vault balances are intentionally permitted; Baseer ERP may warn but must not introduce an insufficient-funds block.
- The owner may amend or cancel prior operations; there is no automatic period-close policy.
- Cancellation is retained in history with audit and serial preservation; posted financial history is not hard-deleted.
- Every financial operation has a central immutable serial; cancellation never releases it.
- Management reports default to gross amounts including VAT. A server-side **Separate VAT** view returns gross, net, and tax without changing the accounting entry.
- The date authority is `Asia/Riyadh`; business date, issuance instant, and audit timestamp are separate meanings.
- All calculations, totals, date ranges, balances, VAT handling, and report timelines are performed by the backend.

## 6. What can improve, and what cannot change by accident

Baseer ERP may improve language, layout, navigation, speed, mobile behavior, RTL/LTR handling, accessibility, validation messages, audit clarity, concurrency safety, and permission enforcement.

It may not accidentally change:

- the required business steps or deliberate defaults;
- accounting, VAT, period, serial, or cancellation outcomes;
- historical record visibility;
- special owner authority or company/role boundaries;
- an intentional exception such as permitted negative vault balances.

## 7. Completion gate

Before a Baseer ERP capability replaces its Noorix equivalent:

1. The discovery record and decision register are approved.
2. Backend contract tests prove the intended workflow and security boundaries.
3. Golden fixtures compare Noorix and Baseer ERP for normal, historical, cancelled, retried, multi-company, negative-vault, gross-VAT, and VAT-separated cases where relevant.
4. The native UI completes the task without a silent Noorix handoff.
5. Any intentional behavior difference is visible, approved, and documented.
6. The owner accepts the result using representative company data.

