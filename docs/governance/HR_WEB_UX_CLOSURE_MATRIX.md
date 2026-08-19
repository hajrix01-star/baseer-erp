# HR Web UX closure matrix

Updated: 2026-08-20. Scope: `apps/web/src`, Arabic and English, desktop and mobile.

Legend: ✅ verified by automated behavior or shared primitive; 🔴 release blocker.

## Routes and tabs

| Surface | Source | Functional | Visual | Mobile | RTL | A11y | Closure note |
|---|---|---:|---:|---:|---:|---:|---|
| HR overview | `hr-overview-workspace.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Mock-auth quick actions exercised in both Playwright projects |
| Employees register — cards/table/filter/paging | `hr-workspace.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Server search, cursor scoped to search, stale-response guard; profile opened from register in mobile test |
| Employee profile — overview | `hr-employee-profile-dialog.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Exact server counts, stable wide dialog and cached photo |
| Employee profile — employment | `hr-employee-promotions-panel.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Lazy panel; no duplicate employee request; tab and actions exercised in both viewports |
| Employee profile — payroll/settlements/advances/deductions | `hr-employee-profile-dialog.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Lazy and cached per tab; each ledger section and detail history paginates with dedupe/stale guards |
| Employee profile — leave history | `hr-employee-profile-dialog.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Lazy and cached per tab; tab exercised in both viewports |
| Employee profile — documents/letters | `hr-employee-documents-panel.tsx`, `hr-employee-letters-panel.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Lazy panels; paginated letters; upload/preview and document/letter actions exercised |
| Leave & return | `hr-leave-workspace.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Create/detail/return and nested modal containment exercised |
| Payroll | `hr-payroll-workspace.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Server search/paging and table containment tested; preview blocks truncated applications |
| Advances & deductions | `hr-workspace.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Server search, remote employee lookup, detail and financial action dialogs exercised |
| Residencies & services | `hr-services-workspace.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Direct route-stage dialog exercised; server search/summary, remote employee lookup and cost reversal |
| Salary tools | `hr-salary-tools-workspace.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | Independent lazy journey |

## Dialogs and confirmations

| Flow / dialog | Primitive | Functional | Stable size | Mobile / RTL | A11y | Inline async error |
|---|---|---:|---:|---:|---:|---:|
| Employee onboarding | `BaseerFormDialog` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Employee edit | `BaseerFormDialog` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Employee photo preview/upload | `BaseerDialog` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Compensation agreement | `BaseerFormDialog` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Salary increase/decrease | `BaseerFormDialog` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Promotion | `BaseerFormDialog` | ✅ | ✅ | ✅ | ✅ | ✅ |
| End-of-service workspace and actions | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Document create/detail/replace/revoke | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Letter issue/detail/revoke | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leave create/return/detail | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Payroll create/preview | `BaseerDialog` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Payroll detail/discard/pay/reverse | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Compensation policies/create/version | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Advance detail/issue/repay/defer/reverse | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Deduction detail/create/defer/cancel | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Service detail/create/edit/renew/cancel/cost/reverse | central dialogs | ✅ | ✅ | ✅ | ✅ | ✅ |

## Closure gates

| Gate | State | Evidence / next action |
|---|---:|---|
| Shared modal stack; Escape closes topmost; nested body scroll lock | ✅ | `use-dialog-focus-trap.ts`; mobile/desktop nested-dialog assertions |
| Consistent modal widths and responsive collapse | ✅ | `baseer-form.css`, `BaseerFormDialog` |
| Error is visible and announced inside the active dialog | ✅ | Dynamic `BaseerDialog` error slot + topmost error channel; failed onboarding POST asserted inside dialog |
| Authenticated desktop/mobile/RTL/LTR journey coverage | ✅ | Mock-auth HR suite: 12 scenarios × desktop/mobile; full suite 29 passed, 1 intentionally skipped |
| POST completion does not retry after refresh | ✅ | Onboarding success closes and refreshes with exactly one POST in E2E |
| HR route JavaScript budget | ✅ | Largest HR journey: leave 59,329 B; services 55,821 B; both below 85,000 B. Largest HR route CSS: leave 10,031 B / 16,000 B. |
| Server search and aggregate summaries | ✅ | Employees, payroll, leaves, services, advances, deductions and final settlements |
| Reversal controls | ✅ | Advance issue, service cost, payroll payment and final-settlement payment |
| Release CSS budget | 🔴 | Only failing budget: global startup stylesheet 88,894 B / 58,000 B. HR route CSS is already split (largest HR chunk 8.29 KB); global extraction is explicitly outside this HR change set. |
