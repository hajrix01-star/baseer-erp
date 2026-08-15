# ADR-001: Baseer ERP is a greenfield modular monolith

## Decision

Build Baseer ERP in this independent repository. It is the single replacement product, not a second permanent application.

## Architecture

- One React application and one Nest backend.
- One PostgreSQL database per environment; modules never own separate databases.
- Shared core owns identity, company context, permission enforcement, audit, idempotency, business dates, document sequences, file metadata, and error conventions.
- Every module publishes narrow backend contracts. React displays server receipts and never derives financial totals, tax, ledger effects, serials, or business-period boundaries.
- `classic` and `baseer` are visual themes only; they do not change routes, data, permissions, or workflow.

## Legacy boundary

Noorix is a read-only discovery and migration source. Baseer does not call Noorix APIs at runtime and does not use its UI, controllers, schema, browser local storage, or financial calculations as product dependencies.

## Data cutover

No data is imported during construction. Migration proceeds only through snapshot, mapping, staging import, reconciliation, owner approval, final write freeze, and cutover. There is no long-running dual write.

## Financial policy retained from Noorix

- A selected month represents complete period movement from zero.
- Negative treasury balances are allowed.
- The owner can amend or cancel prior operations; Baseer does not impose fiscal closing.
- Financial deletion means retained cancellation with audit and no serial reuse.
- Management reports default to gross amounts inclusive of VAT; tax separation is a backend display mode.
