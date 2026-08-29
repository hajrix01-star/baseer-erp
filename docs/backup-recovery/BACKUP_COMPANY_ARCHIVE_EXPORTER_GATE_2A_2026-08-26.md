# Baseer Company Archive Exporter — Gate 2A Controlled Slice

**Date:** 2026-08-26  
**Decision:** `CONDITIONAL PASS — internal worker slice only`  
**This is not an import or restore approval. The present artifact is partial configuration only, not a restorable company archive.**

## What is implemented

The internal `CompanyArchiveExporter` consumes a durable, company-scoped backup job. It obtains one tenant-scoped PostgreSQL `REPEATABLE READ`, read-only snapshot, creates canonical JSONL payloads, then finalizes them only in private staging after every payload file has a matching SHA-256 digest. The Gate 2B packager turns that verified stage into the final encrypted artifact; see [the encryption record](BACKUP_ARCHIVE_ENCRYPTION_GATE_2B_2026-08-27.md).

The current closed registry contains exactly these safe, reviewed sources:

| Adapter | Contents | Reason for this limited start |
| --- | --- | --- |
| `company-profile` | Safe projection of the selected `Company` | Proves company selection without copying access identity. |
| `company-finance-profile` | `CompanyFinanceProfile` settings | Has no account, vault, user or external reference; it depends only on the company profile. |
| `finance-accounts` | `FinanceAccount` setup rows | Standalone finance master data. |
| `finance-categories` | `FinanceCategory` setup rows | Parent, account and suggested-supplier references must resolve within this archive; self-references and multi-category parent cycles fail closed. |
| `finance-fiscal-periods` | `FinanceFiscalPeriod` setup rows | Standalone finance calendar data. |
| `finance-recurring-expense-profiles` | `FinanceRecurringExpenseProfile` configuration | Category, optional supplier and optional default-vault references must resolve in the archive. Historical payment documents and coverage slots are deliberately excluded. |
| `finance-suppliers` | `FinanceSupplier` setup rows | Every category reference is verified. It is paired with categories in the explicit future two-pass restore group. |
| `finance-vaults` | `FinanceVault` setup rows | Every vault account reference is verified against the exported account set. |

This is intentionally **not a complete company archive**. It is `PARTIAL_CONFIGURATION_ONLY` and must not be offered to an importer, restore validator, or restore-as-new-company workflow. It contains no journals, documents, payroll, inventory, attachments, branding files, users, roles, sessions, credentials, audit evidence, backup history, tenant-global data, or any unregistered model. Derived `FinanceLedgerRevision` and balance projections are explicitly excluded. The registry in [data ownership V1](BACKUP_COMPANY_DATA_OWNERSHIP_V1.md) remains the governing plan for later reviewed adapters.

## Failure and interruption behavior

- The opt-in `BackupWorkerService` scans durable jobs only when `BASEER_BACKUP_WORKER_ENABLED=true`; HTTP continues to create and observe jobs only.
- An archive uses the durable job identifier as its archive identifier; restarting a worker claims the job with a new fence and restarts the deterministic export from a clean, fence-specific staging path.
- Every worker transition and artifact record is a database compare-and-set on the lease owner, monotonically increasing fence and database-time lease expiry. A stale worker is barred from changing job state or creating an artifact.
- Staged payloads are written atomically. A staged directory is never downloadable or importable.
- `manifest.json`, checksum index and private control marker are written only after payload verification. The plaintext stage is never renamed into a published namespace.
- The final artifact is a fully verified encrypted `.bca`; it is atomically created without replacement and its byte hash/size are recorded. A restarted packaging path re-verifies an existing encrypted artifact before writing its artifact record. A mismatch fails closed.
- Staging and publishing require `BASEER_BACKUP_ARCHIVE_STORAGE_ROOT`; it must be an absolute host path outside the application workspace and web root. There is no application-relative fallback path.
- Publishing requires `BASEER_ARCHIVE_APPLICATION_VERSION` and `BASEER_ARCHIVE_SCHEMA_VERSION`; missing compatibility metadata blocks publication.

## Deliberately not connected yet

1. No HTTP endpoint invokes the exporter.
2. The V1 archive download endpoint is direct Bearer authentication plus `backup.download`; it serves only an already VERIFIED encrypted `.bca`, has no download UI, does not unwrap keys, is not a signed grant/presigned URL, and rejects `Range` requests.
3. No upload, import, restore-as-new-company, retention job, isolated restore rehearsal, or download UI exists in this slice.
4. Compression/encryption is implemented internally only under [Gate 2B](BACKUP_ARCHIVE_ENCRYPTION_GATE_2B_2026-08-27.md); it is not a user-enabled delivery or restore feature.

## Required configuration before an internal worker test

- `BASEER_BACKUP_ARCHIVE_STORAGE_ROOT`: an absolute host path owned by the service account, outside the web root, not directly served by any reverse proxy, and covered by the owner's daily whole-server backup.
- `BASEER_ARCHIVE_APPLICATION_VERSION`: the deployed Baseer application version.
- `BASEER_ARCHIVE_SCHEMA_VERSION`: the Prisma migration/schema compatibility value selected for this deployment.
- `BASEER_ARCHIVE_KEK_KEYRING_V1`: a deployment-secret canonical JSON keyring required for encrypted artifact packaging; its rotation rule is documented in the Gate 2B record.

The deployment owner must provision and permission this path; source code must not create it in a public application directory.

## Evidence

| Check | Result |
| --- | --- |
| `npm run check --workspace @baseer-erp/api` | Pass |
| `npm run build --workspace @baseer-erp/api` | Pass |
| `npm run check:company-archive-exporter` | Pass |
| `npm run check:backup-worker` | Pass |
| `npm run verify:backup-gate-1-db` | Pass — applied test migration, FORCE RLS, cross-tenant isolation, append-only audit and fenced lease behavior |
| `npm run verify:backup-company-archive-worker` | Pass — durable queue claim through verified artifact publication |
| `npm run check:backup-gate-1` | Pass |
| `npx prisma validate --schema apps/api/prisma/schema.prisma` | Pass |
| `npm run check --workspace @baseer-erp/web` | Pass |
| `npm run check:permissions` | Pass — 133 capabilities |

## Next permitted work

Add one domain adapter at a time only after its dependency closure, import ID-mapping plan, derived-data rebuild rule, reconciliation invariants, and failure tests are approved. Categories and suppliers are a single reviewed dependency-closure unit; their future importer must hydrate the labelled group in two passes while the archive itself rejects corrupted category hierarchies. Recurring profiles restore as configuration only and must remain inert until a future restore workflow validates and deliberately enables them; their historical coverage and payment documents require their own closure. Separately, Gate 3 may add authorized verified-artifact download only after an artifact has a reviewed cryptographic packaging and release contract.
