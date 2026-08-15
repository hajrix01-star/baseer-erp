# Module Governance Committee and Delivery Gates

**Status:** Mandatory governance standard  
**Applies to:** Every Baseer ERP module, capability, migration, financial workflow, report, and cross-cutting platform change.

This standard supplements:

- `BASEER_ERP_ENGINEERING_STANDARD.md`
- `NOORIX_DISCOVERY_AND_PARITY_STANDARD.md`

No capability advances merely because its UI looks finished or its code compiles. It advances only when the relevant committee roles record evidence and answer the gate questions below.

## 1. The committee

The committee is a working mechanism, not a meeting that delays delivery. One qualified person may hold more than one role in a small team, but every role and decision must be explicitly recorded.

| Role | Responsibility | Cannot approve alone |
| --- | --- | --- |
| Product owner | Confirms the intended business behavior, priorities, and intentional exceptions | Security, financial correctness, or migration safety alone |
| Domain investigator | Studies Noorix behavior, workflows, data, exceptions, and parity evidence | A new design without reviewing its technical effect |
| Solution architect / planner | Defines module boundary, data ownership, contracts, dependencies, ADRs, and delivery plan | Business policy or final acceptance alone |
| Security and isolation reviewer | Reviews identity, permissions, tenant/company scope, RLS, secrets, input validation, and abuse paths | Product parity alone |
| Finance / domain reviewer | Validates ledger, VAT, serial, vault, period, cancellation, and report consequences where applicable | UI usability or production operation alone |
| Implementation team | Builds backend, migrations, tests, and native UI against approved contracts | Its own final quality gate alone |
| QA and parity examiner | Runs contract, integration, end-to-end, regression, accessibility, and Noorix parity checks | Architecture exceptions or owner policy changes alone |
| Operations and migration reviewer | Validates observability, backup/restore, deployment, rollback, performance, and migration rehearsal | Business scope or UI quality alone |
| Independent monitor | Checks that no required evidence, known defect, legacy handoff, or unapproved deviation was hidden | Product priority decisions |

## 2. Evidence register

Every capability has one delivery record containing links to its evidence:

1. Noorix discovery record and workflow map.
2. Preserve / harden / correct / defer decision register.
3. ADR, module boundary, dependency map, and API/data contract.
4. Permission and company-isolation matrix.
5. Financial/tax/serial/cancellation effect record, if relevant.
6. Test plan and actual results.
7. UX/accessibility/mobile review.
8. Migration and reconciliation impact.
9. Operational dashboard, alert, backup, rollback, and release notes.
10. Owner acceptance decision and known deferred items.

An unanswered question is a blocker, not an implicit approval.

## 3. Gate A — before design and build

### Questions the committee must answer

| Question | Required answer / evidence |
| --- | --- |
| What user problem does this capability solve? | One clear outcome and the users/roles who need it |
| What is its exact Noorix equivalent? | Routes, tabs, jobs, APIs/services, entities, and reports inspected |
| What are the input steps, defaults, and validations? | Workflow map from entry to success/failure/retry/cancel |
| Which behaviors are deliberate exceptions? | Explicit list, e.g. negative vault balances, historical owner amendment, gross VAT display |
| What is the source of truth? | The canonical domain/ledger/document source; never a browser total or duplicate table |
| What changes after the command? | Document/status, serial, ledger, VAT, vault, inventory/HR effect, audit, notifications, attachments |
| Which permissions and scopes apply? | Exact permission plus tenant/company/owner boundaries |
| Which data must migrate? | Mapping, legacy IDs, ambiguity policy, reconciliation fields |
| Does it require a new policy? | Approved ADR before implementation; no developer assumption |
| What does “complete” mean? | Native task completion, parity scenarios, tests, and acceptance criteria |

### Gate A approval

The product owner, domain investigator, architect, security reviewer, and finance/domain reviewer where applicable must mark the discovery record **ready**. Only then may implementation begin.

## 4. Gate B — during design and implementation

### Questions the committee must continuously answer

| Question | Required answer / evidence |
| --- | --- |
| Is the backend still the only business authority? | No browser formulas, totals, period limits, VAT splits, or balance calculations |
| Is the contract narrow and typed? | Strict allowlisted input/output DTOs; no hidden broad payloads or `any` escapes |
| Are writes safe to repeat and race? | Transaction, idempotency key plus request hash, concurrency/replay/conflict tests |
| Is the command isolated? | Tenant/company predicates and exact permission tests, with RLS where applicable |
| Is historical behavior protected? | Immutable serials, retained cancellation/audit, no destructive posted-data deletion |
| Are special policies preserved? | E.g. Saudi business date, negative vault policy, VAT-gross default, owner historical authority |
| Do migration changes remain additive and recoverable? | Preflight, rollback/recovery plan, fixture and staging proof |
| Is the native UI independent? | No silent Noorix API/screen redirect; server receipts only |
| Is usability built in? | Arabic/English, RTL/LTR, English digits, mobile/desktop, keyboard, 44px targets, loading/error/empty states |
| Are new differences approved? | Updated decision register, ADR, test, and owner approval before merging |

### Continuous review rhythm

- **Planner/architect:** validates boundary and dependencies before each substantial change.
- **Security and domain reviewers:** inspect every command, migration, permission, or financial effect before merge.
- **QA examiner:** runs regression and parity fixtures continuously, not at the end.
- **Independent monitor:** reports blockers and unapproved deviations immediately.

## 5. Gate C — after build, before declaring completion

### Questions the committee must answer

| Question | Required answer / evidence |
| --- | --- |
| Can the user complete the full task natively? | Demonstrated create/list/detail/edit/cancel/retry/history journey without a legacy handoff |
| Does Baseer ERP produce the approved Noorix outcome? | Golden reconciliation for normal, historical, denied, cancelled, retry, cross-company, and exceptional cases |
| Are financial effects correct? | Server-side proof for serial, document, gross/net/VAT, ledger, vault, and reversal where relevant |
| Are permissions and data boundaries secure? | Passed denied, cross-tenant, cross-company, stale-session, and direct-API tests |
| Is accessibility and bilingual use complete? | Arabic RTL and English LTR, English digits, desktop/mobile, keyboard and screen-reader review |
| Can the system fail safely? | Rollback, audit-failure, timeout/retry, concurrency, unavailable dependency, and recovery tests |
| Can it operate in production? | Logs, metrics, alerts, backups/restore, runbook, deployment and rollback evidence |
| Can its data migrate and reconcile? | Staging import/dry run, rejection report, totals/statuses/serials/attachments reconciliation |
| Are deferred items visible? | Delivery register with owner-approved scope and no hidden legacy dependency |

### Gate C approval

A capability is **complete** only when QA/parity, security, operations/migration, domain reviewer, independent monitor, and product owner have accepted their evidence. A failure in any mandatory category returns the work to Gate B.

## 6. Gate D — cutover and post-release monitoring

### Before switching writers

1. Final read-only snapshot and migration rehearsal pass.
2. Noorix write freeze window, final delta import, and rollback plan are approved.
3. Reconciliation is 100% for required entities and approved exceptions are documented.
4. Backup and restore have been tested on the target environment.
5. Baseer ERP health, audit, and error monitoring are live.

### After release

1. Monitor completion, error, latency, and reconciliation signals against explicit SLOs.
2. Triage P0/P1 defects before advancing to the next module.
3. Run a blameless incident review when a material failure occurs, with a preventive action.
4. Keep Noorix read-only as an archive until the agreed retention/recovery period ends.

## 7. Committee decision format

Every decision uses this compact format:

```text
Capability:
Decision: Preserve | Harden | Correct | Defer
Noorix evidence:
Baseer ERP implementation decision:
Business/accounting/tax effect:
Security/company-scope effect:
Migration effect:
Tests and reconciliation evidence:
Approvers:
Open risks and next review date:
```

## 8. Non-negotiable stop conditions

Work stops and returns to discovery/design when any of these occurs:

- a rule, calculation, tax treatment, serial, or exception is not understood;
- a financial value is calculated in the UI;
- a cross-company/tenant or permission test fails;
- cancellation would erase posted history;
- a legacy redirect is being used to claim completion;
- migration reconciliation differs without an approved correction decision;
- a required reviewer has not supplied evidence.

