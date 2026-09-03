# BASEER-IMPACT-2026-09-03-HR-ADVANCE-ACTION-CONTRACT

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Module:** `people-attendance-payroll`; owner: `apps/web/src/hr-workspace-content.tsx`.
- **Decision owner:** Baseer ERP owner, 2026-09-03.

## Decision

The employee-advance primary action remains a normal, fixed action in the
advances-and-deductions workspace header.  It is not a floating viewport
command.  It is visible only to a session with `hr.advances.issue`, opens the
existing advance-entry dialog, and does not create a financial movement until
the existing dialog is explicitly submitted.

## Boundaries

- No API, permission, financial calculation, database, or payroll behavior
  changes.
- The action is scoped to the HR advances workspace and retains Arabic/English
  accessible naming through the existing `hrText` copy.
- Acceptance evidence must verify visibility for the authorized role and the
  existing dialog/request path; it must not assert a retired fixed-position
  CSS contract.

## Verification and rollback

- Verify the focused HR acceptance test on Chromium, then the complete Linux
  web-acceptance gate before release.
- Roll back by reverting the aligned test and documentation only; the product
  action already implements the accepted owner decision.
