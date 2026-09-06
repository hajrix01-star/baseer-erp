# Build governance — cashier effective permissions and role-card details

## G0 — product contract

- Cashiers who were granted a sales-closing action retain access to the daily-sales
  register; its required read capability is derived from the action.
- A sales closing can use its authorised internal vault workflow without exposing
  the Vaults department to the cashier.
- Purchases are named and grouped visibly in the role permission picker.
- Role cards have an intentional reveal control for their effective permissions.

## G1 — engineering plan

- Keep storage unchanged; calculate the dependency closure in the server's two
  access projections.
- Remove vault-read as an automatic dependency of operational financial actions.
- Reuse presentation metadata for the role-card detail list and add focused UI
  styling and localisation.

## G2 — acceptance design

- Exercise a legacy action-only cashier role against `CompanyContextService` and
  assert the daily-sales read capability is granted while vault read is absent.
- Assert lifecycle role creation stores no vault permission for sales closing.
- Run permission and authorization consistency checks, type checks, and the
  administration lifecycle verification.

## G3 — implementation authorization

G0–G2 are satisfied by the documented, side-effect-free effective-grant model.
Implementation may proceed within the files listed in the architecture impact
record.

## G4 — verification evidence

- `npm run check:permissions` passed (141 capabilities).
- `npm run check:authorization-consistency` passed.
- `npm run check --workspace @baseer-erp/web` passed.
- `npm run check --workspace @baseer-erp/api` passed after the shared contracts
  build.
- `npm run test:e2e --workspace @baseer-erp/web -- administration-mocked-auth.spec.ts`
  passed for desktop and mobile, including the role-card permission reveal.
- The lifecycle verification script contains the legacy cashier effective-grant
  assertion. Its local execution is blocked only because `DATABASE_URL` is not
  configured in this workspace; the release workflow provides its isolated test
  database.
- Independent delivery review found and closed a P1 legacy-data edge case:
  runtime expansion now ignores retired unknown codes while creation and update
  remain strict. The role-card itself is now the accessible reveal control.
