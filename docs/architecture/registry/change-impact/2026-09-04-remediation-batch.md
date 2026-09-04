# BASEER-IMPACT-2026-09-04-REMEDIATION-BATCH

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `ARCHITECTURAL` for
  the payroll-preview, public attendance-presentation, and server-output
  contracts; `CONTROLLED` for operations navigation; remaining visual changes
  are `LOCAL`.
- **Modules:** `platform-identity-administration`, `finance-accounting`,
  `operations-inventory-commercial`, `people-attendance-payroll`, and
  `marketing-decision-reports`.
- **Decision owner:** Baseer ERP owner, 2026-09-04.

## Decision

The remediation batch keeps financial and payroll truth server-owned, adds no
database migration or dependency, and uses existing Baseer primitives.  A
payroll KPI becomes a server read for the most recent eligible uncreated
month; the public attendance portal receives only a minimal company
presentation read; and printable A4 documents are server-rendered snapshots
through the existing output boundary.  Navigation and visual improvements do
not change permissions or records.

## Contract boundaries

- Payroll preview is company-scoped and requires `hr.payroll.read`; it returns
  one explicit target month and never creates, approves, pays, reverses, or
  posts a payroll run.
- Attendance presentation validates the existing public tenant/company scope,
  returns only display names and whether an approved logo exists. The logo is
  served from a separate scope-validated endpoint without a storage reference;
  both reads are no-store and rate limited and expose no employee, membership,
  or schedule data.
- Output requests retain report code, company, authorized filters, generated
  time, and server-derived content.  Browser-page printing and client-side
  financial aggregation are excluded.
- Legacy operations deep links continue to resolve to their tab under the one
  visible `طلبات` navigation node.  Existing permissions remain authoritative.

## Non-goals

- No automatic P&L-map creation or account assignment.
- No deletion of Noorix historical evidence, owner-activation backend API, or
  shared administration overview read.
- No production data changes, CSP widening, font download, or deployment.

## Verification and rollback

- Verify contracts with focused API/HTTP policy tests, web typechecks and
  narrow browser checks for RTL/LTR and mobile/desktop surfaces.
- Validate every affected output with server snapshot metadata and A4 layout;
  retain pagination and permission checks.
- Revert application and contract commits together if a contract consumer
  fails; no database rollback is necessary for this batch.

## G5 execution note — 2026-09-04

The completed local work stays within the existing contracts: responsive
collection channels, operations navigation consolidation, duplicate HR
snapshot removal, conditional Noorix evidence tab, administration navigation
cleanup, supplier ordinal, Baseer-login owner-activation UI removal, and
scoped navigation/title presentation fixes. The attendance entry screen now
uses the approved Baseer wordmark, but it deliberately does **not** claim a
tenant company logo until the constrained public-presentation contract above
exists.

The public attendance branding contract is now implemented: it returns only
the Arabic/English display names and an approved-logo flag for an active
company; the client requests a separately validated, no-store logo asset and
falls back to the Baseer mark. The payroll missing-month preview is now also
implemented as `GET /hr/payroll-runs/missing-month-preview`: it evaluates the
immediately preceding completed calendar month only, returns an explicit
`NO_UNCREATED_MONTH` state when a non-reversed payroll already exists, and
otherwise reads eligible employees' effective compensation plus open advance
and deduction balances. It never creates, approves, pays, reverses, or posts
a payroll run. The first operations A4 slice is now implemented through the
central output boundary for received materials and representative custody;
it replays bounded server reads for the requested period and never prints the
application shell. The remaining output catalogue is still an architectural
work item because each marketing/operations surface needs its own server
source and authorization. P&L mapping remains an approved company
configuration; and CSP is
not widened because the source contains no Google-Fonts request and the
published host has not provided inspectable deployment assets during this
run.
