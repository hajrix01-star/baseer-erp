# Baseer ERP Delivery Control Protocol

**Status:** Mandatory operating protocol  
**Goal:** Turn the engineering rules into visible controls instead of relying on personal memory or promises.

## 1. Control rule

Every implementation task must declare, before any code change:

```text
Active scope:
Delivery stage: Discovery | Design | Backend | Native UI | Verification | Cutover
Why this work is required by the active scope:
Evidence that will prove completion:
```

If the task cannot name an active scope and a delivery stage, it is not started. It is recorded as a proposal or deferred work instead.

## 2. Mandatory control records

The repository maintains these records for every capability:

| Record | Purpose |
| --- | --- |
| `MODULE_DELIVERY_REGISTER.md` | Shows the only active scope, current stage, blockers, and next gate |
| Module Discovery Record | Noorix understanding, workflow and parity evidence |
| Decision Register | Preserve / harden / correct / defer decisions |
| Evidence Checklist | Links to contracts, tests, security review, UX review, reconciliation, and acceptance |
| AI Skill Decision | Records whether and when Basira is useful for the module; it is not a requirement to build a chat |
| Exception Log | Explicit owner-approved interruptions or policy deviations |

No status may be inferred from conversation alone; it must be recorded in the delivery register.

## 3. Start-of-work control

Before beginning a task, the delivery lead must verify:

1. The task belongs to the single active scope.
2. The required earlier gate is complete.
3. There is no unresolved P0/P1 blocker in that scope.
4. It does not silently create a legacy handoff, browser calculation, duplicate source of truth, or unapproved policy change.
5. If it is a cross-cutting task, it is an approved dependency of the active scope.

If any answer is no, work stops or an owner priority decision is requested.

## 4. End-of-work control

At the end of every implementation task, the delivery lead records:

1. Exact files/contracts changed.
2. Tests and checks executed, with results.
3. Which gate question became satisfied.
4. Remaining known risks or blockers.
5. Whether the next task remains in the same active scope.
6. The module AI Skill Decision: S0 not needed, S1 guidance, S2 analysis, S3 reviewed draft, or S4 governed automation; see `AI_SKILL_READINESS_GATE_DECISION_2026-08-16.md`.

“Build passed” is never enough evidence by itself.

## 5. Independent review control

Before a scope can enter Verification or Complete, an independent reviewer checks:

- it satisfies the Noorix discovery and parity standard;
- its server owns calculations and business rules;
- permissions and tenant/company isolation are proved;
- financial policies, cancellations, serials, dates, and VAT are preserved where relevant;
- no silent legacy route is used for required work;
- acceptance evidence is real and not merely a checklist assertion.

The reviewer may return the scope to its prior stage. Completion cannot be self-approved by the implementer alone.

## 6. Visible interruption control

Any work outside the active scope requires an entry in the Exception Log:

```text
Date:
Interrupted scope and stage:
Reason: P0 | shared blocker | owner priority decision
Requested by:
Evidence:
Resumption condition:
```

Ordinary convenience, visual preference, or curiosity is not a valid interruption reason.

## 7. Enforcement behaviour

The delivery lead must:

- state the active scope and stage in progress updates;
- decline or defer ordinary unrelated implementation until the active scope passes its gate;
- surface contradictions with approved policy instead of guessing;
- report a blocker immediately rather than hiding it behind a partial screen;
- never label a scope complete while required evidence is missing.

