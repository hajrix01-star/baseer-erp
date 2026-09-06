# Payroll employee selection and summary cards

- BASEER-ARCH v1.0; ARCHITECTURAL (payroll population / financial preview contract).
- Base c82c0f357250a6966ab847802f361fa9d1f07b67; codex/payroll-selection-summary.
- Reuse prior payroll period impact record, HR owner and current components. No schema, migration, dependencies or posted-data edits.

## G0 / financial journey
Create defaults to all eligible active employees. A user can uncheck any employee or clear/select all; removed employees contribute neither salary nor settlements to preview or saved payroll. Existing on-leave explicit inclusion remains explicit. Editing restores the saved employee set from all stored lines. Preview -> draft -> approval/payment keeps existing locks, fiscal guards, month-end issuance and audit.

## G1 / bounded reads
Reuse 50-row preview pages (max100), existing 500-row population batches and10000-line write limit. Selection is global, including unloaded pages. Optional explicit selected IDs restore saved drafts; exclusions support all-minus without loading every employee in the browser. Cap selection arrays10000 and reject duplicates/foreign-company IDs. One debounced250ms preview per input burst; stale requests aborted/sequence fenced. Existing pagination retained; no browser totals from partial rows. No production load test or real payroll issuance.

## G2 / financial authority and contract
Proposed selectedEmployeeIds?: UUID[] (omitted = existing default population; [] = none), excludedEmployeeIds?: UUID[] (all-minus selection). Server resolves selection within company and existing eligibility rules; unselected employees' compensation exceptions and applications do not block selected valid employees. Explicit applications for an unselected employee fail. Preview totals and per-row estimatedNetAmount use existing Decimal backend math. Remove browser Number/reduce payroll arithmetic. Display no stale totals and block submit until the preview matches current employee/application input. Missing data, negative net and over-balance settlements fail visibly. Retain existing four-decimal financial storage contract; no monetary precision migration.

## G3 / direct route
Use existing React/RHF/Zod and Nest/Prisma, existing preview endpoint rather than a new calculator/service. Preserve idempotency compatibility by omitting absent selection fields from canonical old payloads. Reuse installed node_modules from the previous isolated repair. No library evaluation/installation needed.

## G4 / interface
Reuse BaseerSummaryMetricGrid/Metric, BaseerCheckbox, BaseerMoney, BaseerButton and current dialog. Four cards after month/notes: gross, administrative deductions, advance settlements, net. Responsive2-column cards on small screens, four on desktop; accessible selection controls and keyboard support; Western digits AR/EN. Hide employeeNumber in create/edit editor label only; IDs/snapshots/audit unchanged. Maintain existing compensation eligibility statuses and explicit leave exception label. Summary loading state and disabled creation prevent stale receipt submission.

| Before | After | Why |
|---|---|---|
| Employee number plus name | Name and accessible checkbox | Faster selection and requested privacy in editor |
| Footer-only locally calculated net | Four server-calculated cards and footer net | Complete financial context with one source |
| Auto population only | Default all, clear/select and per-employee choice | User controls saved scope |

## Gates and evidence
G0–G4 independent review requested before application edits. Parent owns frontend/client/css/e2e/docs; backend owner receives bounded service/contracts/tests scope after gate approval. Reuse existing independent reviewer. Required: subset/none/full/default, paging/unloaded population, restoration, leave, foreign IDs, decimal settlements, stale response/error, matching persisted amounts, API/contract/web checks, AR/EN mobile/desktop and independent delivery GO before normal PR/CI/deploy.

- Gate refinement: selection arrays are mutually exclusive and optional without defaults; duplicate/foreign/status-invalid IDs rejected. New editor starts exclusions-only; saved drafts use explicit IDs. Existing eligibility and requested selected:boolean are separate; unselected row contribution net is0.0000. Selecting no one returns zero preview, while create/update empty remains rejected.
- Preview pagination refinement: one current50-row page with Previous/Next. Changing inputs recalculates this page and global totals once per debounced burst, independent of company size. Selection persists across page changes; no refetch-all-loaded-pages fan-out. Deselect removes that employee applications; clearing all removes all applications.

## Implementation and delivery evidence
- G0–G4 approved by the independent reviewer before application edits. Optional employeeStatus in saved detail uses the existing paged employee relation; restoration uses current ON_LEAVE status and falls back to historical eligibility only when the field is absent. A returned ACTIVE employee is not treated as still on leave.
- Resolved review findings: remember known incomplete application pages globally, with selection-aware guards; prevent approval of a persisted draft while selection/applications have unsaved changes; restore prorated on-leave employees; cancel pending automatic preview when manually refreshing.
- Passed final contracts/API/web builds and payroll period verifier. Actual local test-database lifecycle and HTTP verifiers passed after employeeStatus changes, including prorated leave restoration and return to ACTIVE. No production payroll was created.
- Full payroll browser suite: 34 passed. After final employeeStatus additions, eight focused AR/EN desktop/mobile selection and restoration cases passed. Parent visually inspected desktop/mobile screenshots; responsive table width was corrected and final web build passed. The final CSS-only gross-row span adjustment does not change calculations.
- Passed architecture, central transport, financial boundaries, localization, numeric policy and UI governance checks; git diff --check clean. Financial coverage includes global paged selection, subset/none/default, Decimal settlements, stale responses, saved membership, foreign-company rejection, and application truncation.
- Independent delivery review found no remaining source blockers. Its conditional GO required final lifecycle/HTTP/web success and documentation; all three passed and are recorded above, satisfying local GO. Normal PR CI, merge, immutable deployment and public readiness/release checks remain the release gate.
- Rollback: revert this source commit through the existing release pipeline. No database migration, dependency addition or posted payroll data mutation. Existing company boundaries, payment/reversal/fiscal safeguards and month-end issuance remain in place.

## Approval integrity extension — 2026-09-06
- The user explicitly authorized completing the approval guard, merging PR44 and deploying to the existing site. Reuse BASEER-ARCH v1.0 and this contract; ARCHITECTURAL financial extension, independently approved G0–G4 before edits.
- After locking/loading a DRAFT, validate the saved financial receipt before account initialization or posting. Exact Decimal values: finite, at most the existing four decimals; nonnegative line/header amounts and positive applications; each application subtotal equals its line field; net equals gross minus both application types and cannot be negative. Sum lines equals header amounts and employeeCount; employee/source IDs are unique and scoped to their company and employee. Do not recalculate historical compensation from today's agreement.
- Direct route: existing service and loaded line/application relations, O(lines + applications), existing write limit10000; no extra per-row query, schema, dependency or historical data edit. Idempotency reservation rolls back in the same transaction on rejection; successful replay and date/fiscal/payment/reversal behavior remain unchanged.
- Central typed AR/EN errors explain over-salary selection and inconsistent draft amounts. Existing PR44 UI hides stale totals and prevents saving failed previews. Add browser rejection/recovery coverage plus service boundary and actual database atomic rejection/retry tests. Independent delivery review and normal CI remain required before the explicitly authorized merge/deploy.
- Extension verification completed: contracts and API rebuilt successfully (the first API attempt exposed stale pre-rebase contract output; rebuilding contracts resolved it), focused period/selection/integrity verifier passed, and actual test-database lifecycle and HTTP verifiers passed. Seven persisted corruptions (header gross/settlement/count, line gross/settlement/net, application amount) were rejected with unchanged draft, source balance, journals, settlements, movements and approval receipt; normal save repaired each and the same approval key succeeded afterward.
- Full payroll browser suite:36 passed on the explicitly isolated port5307, including AR/EN desktop/mobile over-salary rejection followed by valid zero-net correction. An initial default-port attempt connected to another task's test server and was stopped; its failures are not acceptance evidence. Web build and architecture/central-transport/financial-boundary/localization guards passed. No production issuance or historical adjustment was used for validation.
- Independent source review found no blockers; its final conditions were API build and actual database rollback/retry success, both satisfied above. Local GO for the complete PR44 candidate, with normal CI and immutable deployment still required. Source ownership checks use the already loaded relations; existing locked settlement methods retain balance/date/status checks.
