# Baseer Company Archive V1 — Data Ownership Registry

**Status:** Gate 2 approved registry; it is an allow-list, never a generic database dump.  
**Scope:** A company archive is imported only as a new company. Every source read uses the live `tenantId` and `companyId`; imports create new IDs and never import source identities, roles, sessions, jobs, or secrets.

## Registry rules

| Classification | Archive action |
| --- | --- |
| `company/source` | A named domain adapter exports canonical JSONL and remaps all identifiers on import. |
| `company/derived` | Do not export it as truth; rebuild after source data is restored. |
| `tenant/global/excluded` | Do not export or import it. |
| `company/excluded-v1` | Explicitly absent until its dependency/security contract is closed. An unknown domain file fails closed. |

The current manifest records the archive/application/schema versions, source tenant, selected company summary and checksummed file list. Registry version, adapter versions, source-profile hash and an explicit `excludedDomains` list are required before the archive becomes a generally restorable company archive; they are not yet claimed by the controlled export slice. A model with a `companyId` is **not** automatically permitted.

## Platform and identity

| Models | Classification | Decision |
| --- | --- | --- |
| `Company` | `company/source` | Export a safe company-profile projection only. Import generates a new company ID and starts it `ARCHIVED` until reconciliation passes. |
| `CompanyBranding`, `FileMetadata`, HR document blobs | `company/excluded-v1` | Binary copying, re-encryption, quarantine, scan and storage-reference remapping require the later attachment adapter. Never copy a storage reference. |
| `DocumentSerialCounter`, `FinanceLedgerRevision` | `company/derived` | Reseed from imported immutable sources after reconciliation. |
| `AuditEvent`, idempotency, all Backup records | `company/excluded-v1` | These are local operational evidence. The target creates fresh restore audit events. |
| `Tenant`, `User`, roles, memberships, sessions, tenant administration, owner briefs | `tenant/global/excluded` | No access identity or privileged source state crosses into the target company. |

## Finance registry and dependency order

**Source masters:** `CompanyFinanceProfile`, accounts, fiscal periods, vaults, P&L mapping/version/lines, categories, suppliers, recurring profiles, operational days, cash-performance coverage, and loan baselines.

Categories and suppliers are inserted in a two-pass cycle: categories initially omit parent/suggested supplier, suppliers bind their categories, then category trees and suggested suppliers are patched. `SupplierCopyProvenance` is excluded because it may disclose another company.

**Immutable/source facts:** journals and journal lines; supplier dues/payments; outflow batches/documents/revisions/allocations; VAT settlements; vault reconciliations; daily sales closings/allocations; recurring coverage; loan payments/installments; cash-performance events/historical imports; and approved future adapters for planning artifacts.

**Derived:** account daily/monthly balances, daily financial summaries, sales-channel summaries, reporting runs/documents. They are rebuilt from source journals and facts.

An import adapter must use a tightly scoped, audited restore mode, not normal posting commands: normal posting would create duplicate journals. Source actors are not copied. Non-null actor references require a dedicated restore-actor provenance contract before that model is admitted.

## HR registry and dependency order

**Source:** employees; promotions/leaves; compensation policies/versions/profiles; services and financial movements; advances and their allocations/settlements/deferrals; administrative deductions/actions; payroll run/lines/applications/payments/allocations; final settlements/recoveries/payments/allocations; employee letters as source snapshots.

**Excluded V1:** HR binary documents and their metadata/blob/version graph. Those enter only after the attachment adapter can create new encrypted blobs, storage references and scans while proving SHA-256 equality.

## Operations registry and dependency order

**Source:** sections, units, items, item units, conversion versions/edges, recipe versions/lines, custody profiles, purchase requests/lines, purchase receipts/lines, custody events, internal registrations/lines/consumptions, inventory movements, asset/warranty records/lines after their finance document dependency.

**Derived:** `OperationsInventoryBalance`. It is rebuilt from immutable movements in effective order; copied running balances are never trusted.

## Explicitly excluded V1 domains

- Decision Intelligence: company context/evidence/alerts and all tenant/global context data.
- Inbound Evidence: Gmail/OAuth/messages/attachments/analysis, all tenant scoped.
- Marketing: campaigns and links pending closure of Decision/Finance dependencies; provider OAuth/connections and reply policy are excluded.
- AI: provider configuration, encrypted credentials, usage, interpretations, activations, identity and evaluation data.
- Generic business attachments outside the explicitly approved future binary adapter.

## Reconciliation invariants

Before a restored company may activate:

1. Every journal has at least two lines and exact debit/credit equality; entry counts, line counts and per-entry sums match the manifest.
2. Reversal relationships, document references, supplier dues/payments, vault/reconciliation balances and daily-sales allocations resolve after ID mapping.
3. Rebuilt Finance projections and trial balance agree with immutable journals.
4. Payroll, advances, loans and final settlements recompute from their immutable sources and linked journals.
5. Replayed inventory movements reproduce every expected running quantity/value/cost and final inventory balance.
6. All included attachment bytes pass hash, encryption, quarantine and scan checks. In V1 no attachment is silently reported as included.

## Required Gate 2 failure behavior

- Unknown/undeclared domain payload: reject the archive.
- Missing mapping, source actor, cross-company reference or incomplete dependency closure: fail the export/import stage with a correlation ID.
- Changed/missing attachment bytes: reject the attachment stage; never publish an artifact as verified.
- Reconciliation mismatch: preserve the target as inactive/archived and report failure; do not activate it.

## References

- `apps/api/prisma/schema.prisma`
- `docs/backup-recovery/BACKUP_RECOVERY_GATE_0_DESIGN.md`
- `docs/foundation/FILE_METADATA_GATE_A_DISCOVERY.md`
- `docs/foundation/FINANCE_JOURNAL_KERNEL_DELIVERY_2026-08-15.md`
- `docs/foundation/REPORTING_R0_A_ACCOUNTING_POLICY_2026-08-20.md`
- `docs/architecture/OPERATIONS_ORDERS_RECIPE_AND_CUSTODY_IMPLEMENTATION_BLUEPRINT_2026-08-20.md`
