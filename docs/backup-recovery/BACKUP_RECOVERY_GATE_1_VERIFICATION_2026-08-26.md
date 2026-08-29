# Backup & Recovery — Gate 1 Verification Record

**Date:** 2026-08-26  
**Auditor decision:** `CONDITIONAL PASS — local foundation only`  
**Not a production or restore-readiness approval.**

## Scope reviewed

- Central, explicitly assignable backup permissions and a read-only `BASEER_BACKUP_AUDITOR` role.
- Tenant-RLS protected durable BackupPolicy, BackupJob, BackupArtifact, and BackupAuditEvent records.
- Company-scoped API creation and observation of company-archive jobs; no long-running API work.
- Append-only audit event trigger plus hash-chain metadata and an auditor-only redacted read endpoint.
- Baseer-themed Arabic/English backup workspace with truthful waiting states; it does not simulate a completed backup, restore, or progress percentage.
- Local private-server and daily whole-server backup boundary recorded in the owner decision.

## Evidence

| Check | Result |
| --- | --- |
| `npm run build --workspace @baseer-erp/contracts` | Pass |
| `npm run check --workspace @baseer-erp/api` | Pass |
| `npm run check --workspace @baseer-erp/web` | Pass |
| `npm run check:permissions` | Pass — 133 capabilities |
| `npx prisma validate --schema apps/api/prisma/schema.prisma` | Pass |
| `npm run check:backup-gate-1` | Pass |
| `git diff --check` | Pass — warnings only for pre-existing CRLF conversion candidates |

## Auditor review

The migration enables and forces tenant RLS on all new backup tables, and the
dedicated audit table has a database trigger that blocks updates and deletes.
The API requires separate `backup.create`, `backup.read`, and
`backup.audit.view` capabilities. Auditor output is intentionally redacted and
does not expose artifact locations, archive metadata, keys, or secrets.

The feature is correctly constrained: the API only queues a company-archive
intent. There is no database dump, file copy, download, upload, import,
scheduled worker, or live restore path in Gate 1.

## Open gates — build must not bypass

1. Gate 2: versioned table ownership/dependency registry and a consistent,
   encrypted company-archive exporter with interrupted-job tests.
2. Gate 3: archive storage, quality verification, authorised resumable download
   and upload quarantine.
3. Gate 4: isolated staging, restore-as-new-company, financial/relationship/
   attachment reconciliation, and failure rollback tests.
4. Gate 5: a documented, isolated rehearsal of the owner's daily whole-server
   recovery process.
5. Gate 6: schedule/retention/alert operation and production-readiness review.

No merger/replacement restore, server-wide backup download, or production
recovery is permitted by this Gate 1 result.
