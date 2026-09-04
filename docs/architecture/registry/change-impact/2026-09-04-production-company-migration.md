# BASEER-IMPACT-2026-09-04-PRODUCTION-COMPANY-MIGRATION

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `ARCHITECTURAL`.
- **Revision:** `0fd3ea6089c9dbd6c28dd85009098d6fe3b5fb74` (production release
  verified on 2026-09-04).
- **Source:** the locally verified BASEER ERP dataset, frozen in an immutable
  custom PostgreSQL dump on 2026-09-04.
- **Target:** the isolated BASEER ERP production tenant on the Hostinger VPS.

## Decision

The migration is a scoped, application-aware BASEER ERP to BASEER ERP bridge.
It does **not** restore the source database into production and does not reuse
the source tenant, user, role, session, volume, network, or secret state.

The only planned companies are ARZ, مشويات المعلم الشامي, and دوحة المستهلك.
Each receives a new target company identifier and a source-to-target lineage
map. The active production owner is the sole migrated company member, using the
target system Company Manager role; no source user, password hash, session, or
token is copied.

## Data boundary

The writer may import only the documented business domains after a successful
dry run: company settings, finance and ledger history, HR/payroll history,
attendance when present, and operations catalog/history. Every business row is
rewritten to the target tenant and target company identity. Financial values and
posted statuses are copied as immutable historical facts; no UI calculation or
new financial posting is performed.

The writer explicitly excludes authentication, sessions, idempotency receipts,
runtime audit records, backup jobs, AI/provider configuration and receipts,
report output runs, and file/blob metadata until their source payload and
retention contract can be verified. An excluded source row is recorded as a
migration exception, never silently converted to an incomplete live record.

## Invariants and gates

1. Production is backed up before its first write and the source snapshot hash
   is fixed in the migration run record.
2. Each company begins `migrationReviewLocked=true`; it cannot accept normal
   operational writes until quantity and financial reconciliation succeeds.
3. The importer is deterministic and idempotent: a stable source fingerprint,
   target mapping rows, and per-company advisory lock prevent duplicate writes.
4. Source and target counts, daily-sales gross/net/VAT, journal debit/credit,
   payroll totals, and company membership are reconciled before a company can
   be unlocked.
5. Failure stops only the affected company/domain. The rollback path restores
   the pre-migration production backup; Noorix and `baseer.hajrix.com` are not
   touched.

## Required verification

- Export schema/data closure profile from the three source companies only.
- Run the bridge into an isolated local target database, then run domain
  reconciliation and an idempotent replay.
- Run the production writer only after the local rehearsal is green, retaining
  the production review lock.
- Have `$alpha-delivery-team` review the reconciliation receipt before any
  company is unlocked for normal writes.

## Rehearsal receipt

The approved three-company bundle was imported into a newly created local
database with the source schema only. The independent verifier reported:

- every allow-listed table count matched;
- daily-sales gross, net and VAT matched per company;
- journal debit equalled credit per company and matched the source;
- the three target companies remained review-locked and had exactly one owner
  membership each; and
- repeating the same bundle returned an idempotent replay receipt without any
  new row write, followed by the same green reconciliation.

The rehearsal proves the bridge logic against the source snapshot, not a
production cutover. The production review lock remains mandatory.

## Production staging receipt

The scoped writer ran once against the isolated Hostinger production tenant
after the green CI release. The run is `STAGED` under the approved immutable
source fingerprint. All 50 allow-listed entity counts matched the bridge
package, the daily-sales gross/net/VAT and journal debit/credit totals matched
per source company, and every journal remained balanced. The three companies
remain `migrationReviewLocked=true`; each has exactly one membership for the
active production owner. HTTPS health was green after the write and the
temporary sensitive bridge package was removed from the host.

This is a staging completion record, **not** an unlock decision. The next
authority is the independent `$alpha-delivery-team` review, followed by an
explicit owner decision to unlock the companies for normal operational writes.
