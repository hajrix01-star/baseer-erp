# BASEER ERP production company migration — 2026-09-04

## Contract

| Item | Decision |
|---|---|
| Source | Local, verified BASEER ERP PostgreSQL snapshot dated 2026-09-04 |
| Target | Isolated BASEER ERP production database on the Hostinger VPS |
| Companies | ARZ; مشويات المعلم الشامي; دوحة المستهلك |
| Identity | Only the active production owner receives the three company memberships |
| Target state | New target company IDs, review-locked until reconciliation and independent delivery review |
| Rollback | Restore the production pre-migration dump; never alter the source or the separate Noorix/Baseer applications |

The three source companies are currently all active and share one documented
manager login. The target contains the active owner but no company, role, or
business data; this is why sign-in succeeds while workspace selection fails.

## Baseline inventory

The source has 56 non-empty company-scoped tables for this scope. Material
examples are 531 daily sales closings, 3,373 journal entries, 8,333 journal
lines, 51 employees, 15 payroll runs, 771 operations items, and 776 item units.
The complete reproducible count profile is held under
`artifacts/migration/dry-run/` and is not a deployment input.

The full local database contains many fixture and demonstration companies.
Those are explicitly out of scope and cannot be introduced by this migration.

## Wave plan

| Wave | Writer responsibility | Exit evidence |
|---|---|---|
| 0 — rehearsal | Read source closure and build a signed, sanitised bridge package | Fixed source hash, selected company map, excluded-data list |
| 1 — foundation | Target system manager role, review-locked companies, owner memberships, branding and finance profile | Exactly three target companies, one owner membership each |
| 2 — finance | Accounts, periods, categories, vaults, documents, closings, journals, lines, balances and supported evidence | Per-company counts; gross/net/VAT; debit equals credit; no duplicate lineage |
| 3 — people | Employees, terms, compensation, advances, payroll, and attendance if present | Per-company employee/payroll counts and payroll total reconciliation |
| 4 — operations | Sections, units, catalog, conversions and recipes | Count and dependency reconciliation |
| 5 — closure | Replay protection, exception review, production health and delivery review | No running/failed wave; every scope matched or documented historical evidence |

## Explicit exclusions

The first bridge package excludes user credentials, sessions, authentication
throttles, idempotency receipts, raw audit logs, backups, report-output jobs,
AI/provider state and file/blob payloads. These are not business facts that can
be safely recreated without their controlled storage, retention, and ownership
contracts. They remain a recorded migration exception, not a hidden omission.

## Run record requirements

Every execution records: source snapshot SHA-256, transform version, source and
target company IDs, actor identity, per-table counts, financial totals, errors,
exception state, and replay result. The writer must acquire a per-company
advisory lock and use the existing `LegacyMigrationRun`,
`LegacyMigrationCompanyMap`, and `LegacyMigrationRecordMap` lineage model.

## Current status

- [x] Source snapshot preserved.
- [x] Production pre-migration backup preserved.
- [x] Scope and owner mapping verified.
- [x] Target application isolation verified.
- [x] Scoped bridge exporter/importer implemented.
- [x] Isolated local rehearsal and idempotent replay: all selected counts,
  daily-sales gross/net/VAT, and journal debit/credit matched; replay made no
  additional write.
- [ ] Production waves and reconciliation.
- [ ] Independent delivery approval and company unlock.
