# Central File Metadata Ã¢â‚¬â€ Gate A discovery and decision record

**Status:** Gate B implementation and integration evidence complete â€” Gate C remains blocked by the observability foundation slice.
**Capability:** Central, company-scoped file metadata and authorized attachment references for Baseer ERP.  
**In scope:** immutable metadata records, SHA-256 integrity values, server-owned opaque storage references, version/lifecycle metadata, live company authorization, audit, and a safe future download contract boundary.  
**Out of scope:** binary upload/download, storage-provider integration, permanent public URLs, direct filesystem paths, malware scanning execution, bulk attachment migration, document-business workflows, and Finance functionality.

## Gate A evidence

| Question | Evidence and proposed decision |
| --- | --- |
| Governing Baseer contract | The Technical Contracts and Quality Standard requires centralized file handling; modules keep metadata and authorized references, never public file paths. It specifies server MIME/signature/size checks, server-generated storage keys, per-request download authorization, company scope, audit, malware-scan readiness, and safe cleanup after failed commands. |
| Default file policy | The governing standard sets a default attachment limit of **10 MiB per file**. A different limit requires an approved module contract, business justification, server resource analysis, and tests. |
| Noorix evidence | Noorix has separate invoice and HR attachment flows. Both validate selected MIME types, size, and magic bytes, but persist filesystem paths. Invoice replacement deletes the previous file, whereas the HR Baseer metadata flow appends one file and does not replace it. This is useful behavioral evidence, not a runtime or schema dependency. |
| Migration requirement | Cutover requires a per-company/per-month rehearsal that reconciles attachments by SHA-256 hash. The final migration order places attachments after business documents and before audit archive. |
| Source of truth | Baseer owns a central file-metadata record. The owning business module supplies the purpose/source reference, but must not store a public URL or physical path. The server alone owns storage-key generation, integrity verification, and access authorization. |
| Scope and permission | `CompanyContextService` must derive tenant, user, live company membership, and permissions from the access token plus `X-Baseer-Company-Id`; no body-supplied actor, company, permission, storage key, or file path is trusted. Proposed capabilities: `platform.files.read` and `platform.files.write`. |
| Immutability and replacement | A replacement must add a new version/reference and mark the prior version `superseded`; it must not overwrite metadata or silently delete the prior evidence. Deletion/retention is a separate approved lifecycle command. |
| First-slice boundary | Implement metadata/authorized-reference contracts only. Do not expose upload or download until a storage provider, malware-scan handshake, retention policy, and server-side binary verification plan are approved. This keeps the foundation honest and avoids accepting unverifiable client file claims. |
| Completion definition | A permitted user/service can create and read a company-scoped, auditable, immutable file-reference record with hash and lifecycle fields; cross-company/stale/denied access fails; no physical path or permanent URL is returned; retries are idempotent. |

## Preserve / Harden / Correct / Defer

| Area | Decision | Rationale |
| --- | --- | --- |
| Metadata before attachment | Preserve and harden | Noorix HR's metadata-first behavior maps well to a central Baseer file record, but its physical-path storage is not carried forward. |
| MIME, size, and magic-byte validation | Preserve | These are mandatory at the future binary boundary. The Baseer default limit is 10 MiB unless a module contract approves otherwise. |
| Server-owned storage key and download gate | Harden | No UI-facing filesystem path, permanent URL, or cross-company blob reference may exist. Authorization is rechecked on each preview/download request. |
| Replacement deleting prior invoice file | Correct | Baseer retains immutable versions and marks old versions superseded, preserving migration/reconciliation evidence. |
| File paths in database | Correct | Replace legacy physical paths with opaque, generated storage references held centrally. |
| Binary storage and transfer | Defer | Requires a selected provider, safe upload protocol, MIME/magic/hash verification sequence, malware-scan state, cleanup/retry plan, quota controls, retention, and download/preview authorization. |
| Noorix attachment import | Defer | It belongs to the later rehearsed migration program, with SHA-256 reconciliation, not this platform slice. |
| Business meaning of documents | Defer | People, Finance, Documents, and Assets retain ownership of purpose/workflow. This platform records safe file evidence only. |

## Required owner decisions

1. Approve this first slice as **central metadata and authorized references only**, with no binary upload/download or Noorix attachment import (recommended).
2. Approve `platform.files.read` and `platform.files.write` as the live company capabilities for this platform slice (recommended).
3. Approve immutable replacement: create a new version and mark the old record `superseded`; never overwrite metadata or delete the old evidence in the replacement command (recommended).
4. Approve the Baseer default **10 MiB** attachment limit as the future binary-boundary default; any exception requires a separate module contract (recommended).
5. Approve that binary storage provider, malware-scan policy, retention/deletion schedule, and signed/streamed download design are deliberately deferred to a separate Gate A before any file bytes are accepted or served (recommended).

## Gate B plan after approval

1. Add strict shared contracts for file identity, safe display metadata, opaque server-owned storage reference, declared MIME, byte count, SHA-256, lifecycle/version, source reference, and idempotency receipts.
2. Add a tenant/company-isolated persistence model with RLS/FORCE RLS, composite foreign keys, lifecycle constraints, immutable version lineage, and indexes for authorized source access and hash reconciliation.
3. Implement a `FileMetadataService` using live `CompanyContextService` authorization, idempotency, transaction-bound audit, and no body-supplied actor/company/physical path.
4. Expose only the approved metadata/reference commands and narrow receipts. Do not add multipart upload, blob reads, public URLs, or binary storage code.
5. Verify RLS, cross-company denial, stale/revoked session denial, capability denial, idempotent replay/mismatch, immutable supersession, audit rollback, and non-disclosure of paths/storage internals.

## Approval state

- Product owner: approved decisions 1â€“5 on 2026-08-15.
- Architect/security/QA: Gate B evidence recorded below; binary storage remains intentionally out of scope.
- Finance/domain reviewer: not applicable to this central metadata slice; required when a financial document attachment flow is proposed.
- Independent monitor: Finance remains blocked; no Noorix runtime, data mutation, attachment transfer, or binary file handling is introduced.

## Gate B implementation evidence

- Shared contracts strictly validate source/purpose, safe display metadata, declared MIME, 1-byte to 10 MiB declared size, SHA-256 syntax, UUID source identifiers, and idempotency keys.
- Declared MIME, size, and SHA-256 are explicitly unverified reservation metadata in this slice; Baseer does not claim that bytes exist or match until the separately approved binary-storage boundary verifies them.
- `FileMetadata` is tenant/company scoped with composite foreign keys, unique source-purpose versions, immutable replacement lineage, SHA-256 reconciliation index, database constraints, RLS, and FORCE RLS.
- `POST /v1/file-metadata` requires `platform.files.write`; it creates only a server-reserved opaque reference. No storage reference, filesystem path, binary bytes, download URL, or preview endpoint is returned or implemented.
- `GET /v1/file-metadata/:id` requires `platform.files.read` and returns only the narrow metadata receipt in the verified live company context.
- Replacing a `RESERVED` reference creates the next version, records the prior version as `SUPERSEDED`, and preserves both audit evidence and idempotent replay semantics.
- `scripts/run-gate-b-db-verification.mjs` passed RLS, allowed/denied/cross-company/revoked-session access, idempotent replay/mismatch, no silent overwrite, immutable supersession, audit events, path/storage-reference non-disclosure, and all prior foundation regressions against the disposable Baseer database.
## Narrow approved exception: company branding logo

The general binary-storage deferral still applies. The Administration decision dated 2026-08-16 approves a single isolated implementation: an owner-only company logo (PNG/JPEG/WebP, maximum 512 KiB) in private server storage. It verifies magic bytes and SHA-256 server-side, stores an opaque generated reference, creates immutable version lineage/audit, and streams previews only after authenticated owner authorization. It does not introduce public URLs, generic upload/download endpoints, attachment scanning claims, or a general document-storage capability.