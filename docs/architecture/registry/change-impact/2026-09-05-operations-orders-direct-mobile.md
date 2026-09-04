# BASEER-IMPACT-2026-09-05-OPERATIONS-ORDERS-DIRECT-MOBILE

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Owner module:** `operations-inventory-commercial`.
- **Scope:** the visible `الطلبات` entry point, its existing Requests & Custody
  workstation, the existing purchase-request dialog, and their focused browser
  acceptance coverage.  The change intentionally leaves catalog, custody,
  registration, report APIs, data, permissions, posting and deep-link
  compatibility unchanged.

## G0 — Contract and ERP control

The owner requests that selecting `الطلبات` enters purchase requests and
custody directly, without the intermediate “فتح إدارة طلبات الشراء والعهدة”
action.  On mobile the working surface must use the available width with a
two-column item grid, compact margins, clean cards and no sparkline/ornamental
chart.  The purchase date must start empty and the user must choose it before
submitting.

The Noorix reference supplied by the owner is used as visual evidence only:
one operational form, explicit date selection, payment-method choices, a
two-column mobile item picker and a fixed action summary.  It is not copied as
code or as a data contract.  Baseer keeps its own central components and its
server-owned purchase/custody workflow.

Acceptance: the visible Operations route opens the Requests & Custody tab
directly; catalog remains an explicit tab; the creation dialog has no default
date and cannot submit without an intentionally selected Gregorian date;
desktop and narrow RTL mobile have no page-level horizontal overflow; existing
server validation, permissions, audit and posting behavior remain unchanged.

## G1 — Capacity and continuity

No additional API request, unbounded read, client aggregation or cache is
introduced.  The direct route only changes the first rendered existing tab;
the item picker keeps its existing server-bounded search/paging behavior.
The baseline target remains the documented 30-employee/company operational
profile; the critical path is one request dialog with a bounded item result.
Rollback is the single application commit; no data, image, schema or Noorix
resource is modified.

## G2 — Data, contracts and accounting boundary

All amounts, balances, stock availability, payment/custody consequences and
posting decisions remain server-owned.  The browser sends the selected raw
date and existing request fields only; it must not synthesize a date or derive
financial totals.  The build may proceed only if the existing create command
already rejects an absent business date.  Otherwise this work stops and is
reclassified `ARCHITECTURAL` for a server-contract change.  No schema,
migration, permission, endpoint, posting or production-data operation is in
this slice.

## G3 — Direct technical path

No dependency or UI library is added.  The direct path is to change the
existing Operations route's initial tab and remove the intermediate launcher,
while reusing Baseer workspace tabs, cards, buttons, dialog and date-picker.
The alternative—duplicating Noorix's page or adding a second Orders flow—is
rejected because it would split the same server workflow and permissions.

## G4 — Experience system

Use the existing Baseer shell, `BaseerWorkspaceTabs`, dialog, form fields and
central date picker.  The feature keeps Arabic/English and RTL/LTR support,
western date numerals, visible labels/errors/focus, touch-sized controls and a
two-column mobile grid only where the cards remain readable.  Cards are quiet
selection surfaces with name and unit/context; no sparkline, ornamental color
bar or client-calculated operational signal is added.  No decorative motion is
introduced because this is a frequent operational flow.

## G5 — Implementation and focused evidence

The visible Operations route (`operations-catalog`, legacy section 5) and the
retained section-6 deep link now both enter the existing Requests & Custody
runtime immediately.  The former launcher-only summary component is removed;
catalog, registration and reports remain explicit workspace tabs.  Changing
between retained deep links remounts the workspace, so an open operational
dialog cannot obstruct the destination.

The purchase request dialog resets `businessDate` to an empty string.  The
central Baseer calendar still exposes a Gregorian `YYYY-MM-DD` field, and the
existing shared contract was verified to require `z.string().date()` before
the command reaches the server.  No endpoint or schema was changed.

The item cards have no decorative accent element.  The existing two-column
mobile grid is retained with compact dialog margins and readable card height;
the focused responsive test asserts no page-level horizontal overflow.

Evidence on 2026-09-05:

- `npm run check --workspace @baseer-erp/web` — passed.
- `npm run test:e2e --workspace @baseer-erp/web -- operations-mocked-auth.spec.ts --workers=4 --reporter=list` — 26 passed (desktop and mobile).
- Focused acceptance covers direct entry, the absent initial date, calendar
  accessibility, tab access, and desktop/mobile viewport boundaries.

## Delivery boundary

The owner explicitly authorizes production publication.  Publication may use
only the already-approved isolated Baseer release path in
`BASEER-IMPACT-2026-09-03-PRIVATE-VPS-ISOLATION`: immutable CI images,
preflight, isolated Compose project, health checks, and no Noorix container,
volume, network, secret or DNS modification.  A live deployment is attempted
only after the focused checks, full CI and independent delivery review are
green.
