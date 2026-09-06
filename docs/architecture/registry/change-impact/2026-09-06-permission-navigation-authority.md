# Permission navigation authority — impact record

**Reference:** `BASEER-ARCH v1.0`
**Classification:** `ARCHITECTURAL`
**Scope:** Role grants, effective capabilities, web navigation, and the finance/operations page registry.

## Evidence and root cause

The permission model currently uses `finance.purchase_expense.read` as the
route condition for three different pages: Operations/Purchasing,
Operations/Expenses & obligations, and Finance/Unified financial register.
Consequently, a role granted purchasing can discover all three pages even
though they are distinct product sections. This is a capability-boundary
collision, not a drawer rendering defect.

The same model expands action grants to their read prerequisite both in the
editor and on persistence. The role card then presents the expanded set as
one list. It does not distinguish an administrator's direct grant from an
automatic prerequisite. Existing persisted roles may contain a read
prerequisite beside its parent action. It is semantically redundant, so a
subsequent role save canonicalizes it to the direct action while preserving
its effective runtime access.

## Decision

Separate direct role grants from effective runtime capabilities. Automatic
prerequisites remain available to authorization, but are not persisted as a
second direct choice and are labelled as automatic in the administration UI.

The first collision resolved by this change is the financial register:
`finance.ledger.read` is an explicit server-owned capability for both route
discovery and the invoice-register API. The purchasing/expenses split remains
a separately scoped follow-up; no client-side hiding may replace server
authorization.

## Boundaries

- Server remains the source of truth for grants and authorization.
- No financial calculation, journal, document data, or migration is changed
  without an explicit compatible server contract.
- A duplicated read prerequisite is canonicalized on an explicit role save;
  it remains effective through its parent action.
- The navigation registry consumes only the capability that authorizes the
  target page; it never derives section access from a neighbouring page.

## Required proof

1. A purchasing-only role exposes no Ledger route and its API guard rejects
   access to the register.
2. A ledger-only role exposes Ledger and no Operations purchase/expense route.
3. A create grant has its read prerequisite at runtime but the role card and
   editor mark it automatic rather than selected directly.
4. System finance roles receive the new ledger capability in the compatible
   migration; custom roles are not expanded.

## Reversal

The implementation is reversible by commit and migration rollback plan. The
migration adds one idempotent read grant to established system roles and does
not rewrite custom-role data.
