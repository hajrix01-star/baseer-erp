# Baseer ERP

Baseer ERP is the replacement, modular ERP for the owner and their companies.

It is built as one application, one production database, and one shared core:

- company context, users, permissions, theme, audit, files, dates, and sequences are central;
- modules are Finance, Operations, People, Documents, Reports, Administration, Growth, and Command Center;
- the legacy Noorix system is read-only discovery and migration source until the final cutover;
- no Baseer module may hand off a core workflow to the legacy system.

## Current stage

Foundation only. No production data connection, import, migration, or deployment is configured in this repository.

## Build order

1. Core platform: identity, companies, authorization, audit, business date, document sequence, files.
2. Finance end-to-end: financial kernel, dashboard, sales, treasury, expenses, purchases, liabilities, VAT.
3. Migration rehearsal and finance reconciliation.
4. Remaining modules, one completed module at a time.
5. Final cutover from Noorix after owner approval.

Read [the architecture decision](docs/architecture/ADR-001-GREENFIELD-BASEER-ERP.md) and [the module rulebook](docs/governance/MODULE_DELIVERY_RULEBOOK.md) before adding a feature.
