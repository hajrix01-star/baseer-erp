# Baseer ERP — Backup & Recovery Gate 0 Design

**Status:** `CONDITIONAL PASS — DESIGN ONLY`  
**Date:** 2026-08-26  
**Scope:** A new backup/recovery capability; no feature code, schema migration, infrastructure change, or production change is authorised by this record.  
**Review body:** BAQC-01, BAQC-04, BAQC-06, BAQC-08, BAQC-09, and BAQC-10.

## Decision

Baseer must implement two deliberately separate capabilities:

| Capability | Purpose | It must not do |
| --- | --- | --- |
| Disaster recovery (DR) | Recover the entire PostgreSQL cluster and application storage after a host, database, or broad deletion incident. | Selectively restore a single company through the application UI. |
| Company archive | Export a selected company's business data and company-owned attachments, download it locally, and restore it as a new company. | Replace/merge a live company in V1 or stand in for DR. |

The first application delivery is **company archive V1**, with `RESTORE_AS_NEW_COMPANY` as its sole restore mode. `MERGE` and `REPLACE_EXISTING_COMPANY` are explicitly out of scope. Baseer is a private application on an owner-managed server already covered by a daily whole-server backup service. That external whole-server recovery layer is the DR baseline for this delivery; Baseer must not add a second DR platform (pgBackRest, S3/MinIO, WAL/PITR, or an object-lock provider) in V1.

## Existing foundations and gaps

| Area | Reusable foundation | Gap that V1 must close |
| --- | --- | --- |
| Database isolation | `DatabaseService.inTenantTransaction` sets tenant RLS; application services use trusted company context. | RLS is tenant-scoped, not company-scoped. Every archive query must constrain both `tenantId` and `companyId` from an allow-listed ownership registry. |
| Authorization | Central permission catalogue and tenant/company authorization services. | No backup capabilities or read-only auditor role exist. |
| Idempotency | HTTP command idempotency receipts. | Background work needs its own durable idempotency keys, checkpoints, retries, and lease heartbeat. |
| Scheduling | `SystemSchedulerLease` protects small opt-in in-process schedulers. | It is not a durable queue and its fixed short lease must not own long export/import work. |
| Files | `FileMetadata`, content hashes, private storage, HR encryption and scanning. | Archive storage, resumable transfers, company-safe copy/re-keying, and archive validation do not exist. |
| Audit | `AuditEvent` records application actions transactionally. | It is not append-only/hash chained and there is no auditor-specific view. |

The implementation must retain the existing rule that production files are outside the web root and that database metadata is not a substitute for file storage.

## Required architecture

```text
Browser -> API command endpoint -> BackupJob / RestoreJob (durable database state)
                                  -> separate Backup Worker -> archive staging storage
                                  -> completed immutable artifact

PostgreSQL + WAL + application storage -> DR backup infrastructure -> isolated recovery target
```

1. The API only authorizes and creates commands. It never performs long export/import work in an HTTP request.
2. A separately deployable worker claims jobs with a renewable lease, heartbeats, idempotency, and checkpoints. The existing scheduler lease may dispatch due jobs but must not execute them.
3. V1 progress is read from persisted job state through bounded polling. SSE may be added later; the browser is never the source of progress.
4. Application archive storage is abstracted by `BackupStorageProvider`: local private storage for development/on-premise use, then S3-compatible/managed object storage without changing business logic.
5. Archive data is staged and validated before production writes. A file never writes directly into a live company.

## Archive format V1

The logical company-data format identifier is `baseer-company-archive/v1`. The current encrypted transport/container is a single `.bca` file (`BSAE0001 + canonical header + AES-GCM ciphertext + tag`). Its plaintext logical contents are:

```text
manifest.json
checksums.sha256
data/<domain>.jsonl
attachments/<content-sha256>/<blob>
```

`manifest.json` must include the format version, Baseer release version, Prisma migration/schema version, creation time, creating actor, companies, selected modules, record counts, file sizes/hashes, attachment list, encryption key reference, and compatibility bounds. It must never contain credentials or keys.

Each payload file and attachment receives SHA-256. The current Gate 2 implementation uses gzip and AES-256-GCM with a unique data-encryption key per artifact; that key is wrapped by a locally provisioned environment KEK keyring. It does not currently provide an Ed25519 signature or KMS/HSM-backed custody, so it must not claim either. No key may be held in source control, the archive, a browser, ordinary audit data, or UI configuration.

## Data ownership and import boundary

Before any domain is exported, the implementation must ship a versioned, closed ownership registry. Every model is one of:

- `global`: never exported as company data.
- `tenant`: excluded unless a separately approved, minimal reference projection exists.
- `company`: exportable only via an explicit domain adapter.
- `derived`: rebuilt after import, not treated as source data.
- `excluded`: never exported in V1.

Known exclusions pending a dedicated decision include users, roles, permissions, sessions, tenant administration, general audit history, and tenant-only inbound evidence. `FileMetadata` and HR blobs require new IDs and storage references when imported; source references cannot be copied. Company branding and approved company-owned documents are candidates only after their domain adapters define scan/quarantine behavior and reconciliation rules.

The registry must determine dependency order and ID mapping. A generic `companyId` table dump is forbidden: multi-field foreign keys, company-specific unique values, derived projections, and data shared at tenant scope make it unsafe.

## Durable state and user-visible stages

Required records: `BackupPolicy`, `BackupJob`, `BackupArtifact`, `RestoreJob`, `RestoreApproval`, `BackupAuditEvent`, and a versioned ownership registry. Exact columns are a Gate 1 design deliverable; every job requires tenant, company scope, state, phase, attempt, idempotency key, lease owner/expiry, checkpoint, counters, error classification, correlation ID, and timestamps.

Export stages:

```text
QUEUED -> PRECHECK -> CONSISTENT_SNAPSHOT -> EXPORT_DATA -> EXPORT_ATTACHMENTS
-> PACKAGE_COMPRESS_ENCRYPT -> VERIFY_HASHES -> PUBLISHED
```

Import stages:

```text
UPLOAD_RESUMABLE -> FILE_SANITIZATION -> DECRYPT_AND_VERIFY -> COMPATIBILITY_CHECK
-> DISCOVER_COMPANIES -> USER_SELECTION -> STAGE_DATA -> VALIDATE
-> RESTORE_PLAN_AND_CONFIRMATION -> APPLY_AS_NEW_COMPANY -> POST_RESTORE_VALIDATION
-> ACTIVATE_AND_AUDIT
```

The UI reports persisted phase, percentage, records/files and bytes completed, speed, ETA when meaningful, last safe checkpoint, resumability, and correlation ID. It may display `100%` only after post-restore validation. Incomplete artifacts remain unpublished and cannot be downloaded or restored.

## Restore safety model

1. Uploads are resumable and land in a quarantine area.
2. A future import worker validates size limits, real file type, archive layout, path traversal, links, compression ratio, encryption, checksums, compatibility, and malware-scan policy before staging. Independent signature validation is deferred until an independently managed signing key is introduced.
3. The user sees only the companies present in the valid manifest and chooses exactly one company for V1.
4. Data enters isolated staging and passes foreign-key, ledger/reconciliation, record-count, attachment-hash, and business-open checks.
5. The new company and all regenerated identifiers are written only after the plan is confirmed. Any failure before activation leaves existing companies unchanged.
6. A final report records imported/skipped/failed records, warnings, source artifact hash, mappings, and reconciliation outcomes.

## Security and control requirements

New central permissions are required:

```text
backup.create
backup.download
backup.schedule.manage
backup.restore.request
backup.restore.approve
backup.restore.execute
backup.audit.view
backup.key.manage
```

`backup.audit.view` creates a dedicated `BASEER_BACKUP_AUDITOR` role. It is read-only and cannot create, download, delete, approve, execute, alter retention, or access keys. Restore-replace, if later approved, requires separation of request/approval/execution users and strong reauthentication.

`BackupAuditEvent` is separate from general `AuditEvent`: append-only, sequence-numbered, hash chained, correlated to job/artifact, redacted, and protected from application-role update/delete. Auditor evidence also goes to an external/immutable sink when the target deployment supports it.

The current V1 download is a direct Bearer-authenticated endpoint requiring `backup.download`, scoped to an already VERIFIED encrypted artifact. It is not a signed grant or presigned URL; `Range` requests are rejected and the server streams ciphertext only. Retention changes and deletion are not implemented in this gate.

## DR baseline — owner-managed whole-server backup

The owner has confirmed that the server which will host Baseer is already copied daily as a whole-server backup together with the owner's other private applications. This is the DR baseline for V1. Baseer must not introduce pgBackRest, S3/MinIO, WAL/PITR, Object Lock, or a new backup provider in this delivery.

The operational runbook must record the backup provider/operation, schedule, retention, last successful backup reference, and restoration contact/process. It must explicitly confirm that the whole-server backup includes the PostgreSQL persistent data, `BASEER_STORAGE_HOST_PATH`, deployment configuration, and any persistent Docker volumes. A restore is always rehearsed into an isolated target before the live server is changed.

The initial cross-server RPO is one day, subject to the actual daily backup schedule. RTO is not asserted until an isolated whole-server recovery rehearsal measures it. WAL/PITR may be considered only later if the owner needs a recovery point finer than the daily whole-server copy.

## Threat model and mitigations

| Threat | Required mitigation |
| --- | --- |
| Network/process loss at 10%, 50%, or 90% | Durable checkpoints, renewable lease, idempotent phases, resumable multipart transfer, and unpublished staging artifacts. |
| Corrupt/tampered archive | Per-file hash, AES-GCM authenticated encryption, strict compatibility checks, and rejection before staging. Independent signing is a future KMS/HSM/import-gate capability, not a current claim. |
| Archive bomb/path escape/malware | Size/file/depth/ratio limits, no links or traversal, quarantine, real-type inspection, and scanning policy. |
| Cross-company disclosure | Closed ownership registry, tenant+company predicates, domain-specific adapters, negative isolation tests, and manifest inspection. |
| Ransomware or app compromise | Daily whole-server backup held outside the live workload, confirmed retention, restricted backup identity, alerts, and periodic isolated restores. |
| Bad restore | V1 new-company only, staging/reconciliation, final confirmation, and no merge/overwrite path. |
| Hidden operational failure | Alerts for failed jobs, overdue work, storage capacity, missed schedule, WAL/archive lag, and restore-test failure. |

## Auditor evidence and gates

| Gate | Required evidence | Auditor decision |
| --- | --- | --- |
| 0 — design | This document, ownership registry plan, threat model, compatibility policy, rollback plan, and approved infrastructure boundary. | Conditional pass only; no production claim. |
| 1 — durable jobs | Migrations, contracts, restart/lease/idempotency tests, permission/RLS results. | Required before exports. |
| 2 — export | Encrypted fixture, manifest/hash report, attachment report, and interrupted-export tests. Independent-signature evidence is required only when that future control is introduced. | Required before restore eligibility; the current partial configuration artifact is downloadable but not restorable. |
| 3 — import | Quarantine refusal tests, resume tests, staging evidence, compatibility checks. | Required before restore. |
| 4 — restore V1 | New-company reconciliation for records, ledger values, relations, and attachments. | Required before owner acceptance. |
| 5 — DR | Isolated whole-system restore and PITR rehearsal with measured RPO/RTO. | Required before production DR claim. |
| 6 — operations | Schedule, retention, alert, capacity, restore-test, and runbook evidence. | Required before production readiness. |

The auditor records gate, exact evidence version/hash, decision (`PASS`, `CONDITIONAL_PASS`, `RETURN_TO_BUILD`, or `BLOCKED`), findings, owner, and timestamp. A claim such as “backup succeeded” is not evidence of recoverability.

## Required verification commands

The implementation must add reproducible checks following current repository conventions:

```text
check:backup-contracts
check:backup-permissions
check:backup-rls
verify:backup-job-resume
verify:company-archive-export
verify:company-archive-restore
verify:backup-isolated-restore
```

Mandatory failure injection covers worker/network/storage loss at 10%, 50%, and 90%; altered bytes; missing attachment; forged manifest; expired upload; duplicate command; insufficient permission; incompatible migration; storage exhaustion; and attempted cross-company import.

## Gate 0 decision and blockers

**Decision:** `CONDITIONAL_PASS — DESIGN_ONLY`.

The separation of DR and company archive, V1 restore-as-new-company boundary, worker model, and audit model are approved as the starting design. The following block implementation approval:

1. Owner activation of Backup & Recovery as the next delivery scope; the current delivery authority names a different active business scope.
2. Written confirmation from the server backup operation that PostgreSQL persistent data, `BASEER_STORAGE_HOST_PATH`, and persistent deployment volumes/configuration are included, plus its retention period and the first isolated restore rehearsal plan.
3. A reviewed, versioned table-ownership/dependency registry covering every released domain and its attachment rules.
4. Defined financial reconciliation invariants for every exportable Finance domain.
5. Explicit maximum archive size, concurrency, resume duration, and data-retention values for the intended deployment.

When all five are recorded, BAQC may issue `DESIGN_GATE_APPROVED` and authorise Gate 1 implementation. This record does not issue that approval itself.

## References

- `docs/operations/PRIVATE_ONLINE_FILE_STORAGE_AND_RECOVERY.md`
- `docs/operations/HOSTINGER_PRIVATE_HOSTING_AND_BACKUP_DECISION_2026-08-16.md`
- `docs/architecture/AUTH_SESSION_AND_SCHEDULER_RESILIENCE_DECISION_2026-08-21.md`
- `docs/governance/ACCEPTANCE_AND_QUALITY_COMMITTEE_CHARTER.md`
- `docs/governance/CURRENT_DELIVERY_AUTHORITY.md`
- PostgreSQL continuous archiving and PITR: https://www.postgresql.org/docs/current/continuous-archiving.html
