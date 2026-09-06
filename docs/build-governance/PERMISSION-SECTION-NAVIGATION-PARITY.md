# Build governance — permission section/navigation parity

## G0 — product contract

- Names and order in the role picker follow the visible system navigation,
  without renaming a section for convenience.
- «المشتريات» is a distinct Operations section; «طلبات المشتريات والعهدة» is
  not a substitute for it.

## G1 — delivery design

- Add server-owned presentation order metadata to the administration overview.
- Project `finance.purchase_expense.*` onto the Operations/Purchases surface.
- Sort picker modules and sections using that metadata; do not alter stored
  permission codes or authorization checks.

## G2 — verification plan

- Type-check contracts, API and web.
- Check the permission catalogue and authorization consistency.
- Add browser coverage proving Purchases follows Sales and is separate from
  purchase requests.

## G3 — implementation authorization

The change is limited to the server-owned presentation contract and its role
picker consumer. No migration, financial write path, or authority expansion is
permitted.

## G4 — verification evidence

- Contracts, API, and web TypeScript checks passed.
- Permission-catalog and authorization-consistency checks passed.
- Browser coverage passed on desktop and mobile: Purchases is under Operations,
  follows Sales, and remains distinct from Requests.
