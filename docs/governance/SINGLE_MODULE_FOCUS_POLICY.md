# Single-Module Focus Policy

**Status:** Mandatory delivery policy  
**Purpose:** Prevent fragmented work, superficial patches, and false completion in Baseer ERP.

## 1. One active module at a time

Baseer ERP follows a **single-module focus** model:

- Only one business module may be in active build status at any time.
- The active module includes all of its required vertical work: discovery, architecture, backend, database, contracts, tests, native UI, accessibility, reconciliation, operations, and acceptance.
- No new module starts because its screen appears easier, more attractive, or more urgent while the current module has unresolved mandatory gates.
- Cross-cutting platform work is allowed only when it is a documented dependency of the active module, such as identity, business date, audit, sequence allocation, or a shared UI component required by that module.

## 2. What “complete” means

A module is not complete when a card, route, dashboard, or form exists. It is complete only after it has passed Gate C in `MODULE_GOVERNANCE_COMMITTEE_AND_GATES.md` and all of the following are true:

1. Its Noorix workflows and deliberate exceptions are understood and documented.
2. Its backend owns all business rules, calculations, dates, totals, and financial effects.
3. Its data model, audit, permissions, company isolation, idempotency, serials, cancellation, and migrations are complete where relevant.
4. Its native UI supports the full intended task: list, detail, create, edit, cancel/reverse, retry, history, filters, errors, empty state, and mobile/desktop bilingual use as applicable.
5. Its parity and security tests pass, including exceptional and historical cases.
6. It has no silent legacy handoff for a required user journey.
7. Its operational evidence, migration impact, and owner acceptance are recorded.

## 3. Prohibited patterns

The following are prohibited:

- Starting a new module while the current module has unresolved P0/P1 issues or incomplete required workflow.
- Calling a module complete because a dashboard or landing page is visually finished.
- Building a UI patch without its backend contract, audit, permissions, and tests.
- Replacing an unfinished workflow with a hidden link, redirect, or embedded legacy screen.
- Moving to another section to avoid an unresolved discovery, accounting, migration, or parity decision.
- Mixing unrelated refactors into the active module unless they are required and explicitly approved as a dependency.

## 4. Permitted interruption protocol

An interruption is allowed only for:

1. A P0 security, data-loss, or production outage.
2. A shared-platform blocker that makes the active module impossible to complete.
3. An explicit owner decision to change priority.

For every interruption, record:

`reason -> affected active module -> exact paused gate -> new owner decision -> resumption condition`

The team returns to the paused module before beginning ordinary feature work elsewhere.

## 5. Visible module board

The delivery register must always show exactly one of these states for each module:

- **Not started** — no discovery approval.
- **Discovery** — Noorix understanding and parity record in progress.
- **Active build** — the only module receiving normal feature work.
- **Verification** — implementation complete; committee evidence and acceptance underway.
- **Complete** — all gates passed; no required legacy handoff remains.
- **Deferred** — consciously excluded, with reason and later milestone.

Only one row may be **Active build**. A module in **Verification** remains the focus until accepted or returned to build.

## 6. Definition of a patch versus a vertical slice

A **patch** changes a visible symptom or isolated line of code. It may be appropriate for an urgent bug, but it is not module delivery.

A **vertical slice** delivers one complete user outcome through all layers:

`policy -> data -> backend command/read model -> audit/security -> tests -> native UI -> operational proof`

Baseer ERP is built from vertical slices, then closed module by module. This produces a coherent ERP rather than a collection of polished but incomplete cards.

