# BASEER ERP central filters decision

**Decision status:** Approved by the owner on 2026-08-15.

## Non-negotiable requirement

No Finance, Dashboard, or Reports screen may be declared complete unless it uses the central filter contract. Filters are not a visual convenience; they define the exact company and period scope of every read, chart, export, and printed report.

## Central filter contract

Every applicable read request must use a server-validated context containing:

| Filter | Rule |
|---|---|
| Company | Mandatory. The server authorises the selected company through the user's membership; a browser-supplied company ID never grants access. |
| Business period | Mandatory where a report or dashboard is period-based. Uses Baseer Business Date semantics and an explicit inclusive start/end range. |
| Module filters | Optional and controlled: document status/type, branch, sales/payment channel, supplier, customer, cost centre, or comparable module dimensions. |
| Presentation preferences | Optional only: language, chart grouping, sort order, and saved view. They cannot change authority, company scope, financial calculations, or source data. |

The central filter state must be reusable by screens, exports, print/PDF output, and API requests. A report cannot silently apply a different period or company than the user sees on screen.

## Approved interaction model (Noorix visual reference)

The owner reviewed the Noorix filter interface on 2026-08-15. BASEER ERP must preserve the following interaction model while applying the stricter server-authorisation rules in this decision:

| Period mode | Required interaction |
|---|---|
| All | Full authorised history for the selected company, subject to server-side summary/query limits. |
| Day | Calendar picker for one explicit business date. |
| Month | Choose one year/month or a month range. |
| Range | Choose an explicit inclusive start and end date. |
| Year | Choose one business/reporting year. |
| Quarter | Choose year plus Q1, Q2, Q3, or Q4. |

The filter bar must use a two-step interaction: the user chooses values, then selects **Apply**. A visible **Reset** action returns the filter to its authorised default. Dashboard cards, tables, charts, print/PDF output, and exports refresh only after Apply.

Weekly performance is an analytics result derived from the selected period, not a seventh global period filter. The UI must show the effective selected company and period after Apply so the user can see exactly what is being analysed.
## Security and data rules

- Company scope comes from the authenticated server context and company membership checks, with row-level security as a database backstop.
- The server rejects an unauthorised company filter; it does not fall back to another company or return partial cross-company data.
- A user may save a preferred filter view, but saved preferences are never a permission grant.
- Financial filters are applied before aggregation. Browser calculations, browser-local filtering of unrestricted data, and client-provided totals are forbidden.
- Exports, printouts, and dashboard API responses must include the effective company and date range in their safe receipt/metadata.

## UX rules

- A shared filter bar shows the selected company and period clearly.
- Module-specific filters appear only when relevant and do not replace the central company/period controls.
- Changing a central filter refreshes all dependent read-only cards, tables, charts, and exports consistently.
- The browser may store display preferences, but the server remains the authority for the effective filter and results.

## Acceptance gate

Before a financial dashboard, report, or export is accepted, automated checks must prove:

1. the same central company/period yields the same scope on screen, API, PDF, and export;
2. an unauthorised company ID is refused and cannot leak data;
3. company/period filters are applied before summary aggregation;
4. changing module filters cannot bypass the central company/period scope;
5. saved views do not grant data access or change server-authorised scope.

## Current boundary

Company context and Business Date are already foundation services. The reusable user-interface filter bar and the shared API query contract are mandatory work in the first Finance/Reports Gate A and Gate B delivery; no dashboard/report UI may bypass them.
