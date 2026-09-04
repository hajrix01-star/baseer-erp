# BASEER-IMPACT-2026-09-05-COMPANY-BRANDING-SAVE-ALL

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `ARCHITECTURAL`.
- **Owner modules:** `platform-identity-administration`, `finance-accounting`, and `platform-data-contracts`.
- **Request:** make the company-logo command reliable, remove in-dialog explanatory copy, archive or reactivate directly without a required reason, and replace separate company/VAT save actions with one atomic save action.

## G0 — Contract and acceptance

The company owner is the only actor for company branding, company settings, company status, and the combined VAT default. A valid PNG, JPEG, or WebP logo up to 512 KiB must upload only to the selected tenant/company, retain immutable metadata and audit lineage, and become readable only through the authenticated owner endpoint. Invalid browser file type/size is rejected before network transfer; invalid bytes remain rejected by server signature validation.

The existing company settings command gains an optional `vatRateBasisPoints` value. When present, the server updates company settings and the finance default inside the same tenant transaction; a missing finance profile or any failure rolls back both changes. The change applies only to future invoices, never recalculates a posted invoice or journal. The direct archive/reactivate action keeps an immutable audit event, but no longer displays or requires a free-text reason. No company, file history, audit row, accounting record, or Noorix resource is deleted.

The dialog removes visible help prose only; labels, validation, state, accessibility names, and error feedback remain. It reuses the existing Baseer dialog, form fields, button, select, and error primitives in Arabic/English and RTL/LTR, including narrow mobile layout.

## G1 — Capacity and continuity

Logo bytes remain capped at 512 KiB (about 700 KiB Base64 request, within the existing 1 MiB route limit). One upload creates one immutable metadata version and bounded filesystem object; prior objects remain retained as superseded metadata. The transaction changes one company, one branding row, and at most one finance profile. No unbounded read, cache, job, migration, or new package is introduced.

Private-online startup validation already requires a mounted, readable and writable logo directory below the private file root. This implementation keeps that fail-closed deployment control and makes invalid user input a validation error instead of a permission-shaped failure. If storage becomes unavailable at runtime, no metadata/settings transaction is committed and the operator must repair the private mount rather than broaden access or write into the image filesystem.

## G2 — Data, authorization, and financial boundary

`AdministrationService` owns company/branding writes and `CompanyFinanceProfile` remains the server-owned default VAT record. The combined command preserves tenant RLS, verifies the selected logo metadata belongs to the target company, verifies the approved city catalogue, and applies the same owner-only boundary before it writes. It writes two audit entries in the same transaction when VAT changes: company settings and finance VAT default. The normal finance configuration endpoint remains available to its existing capability holders; it is not weakened or repurposed.

Logo blob storage follows the existing narrow company-branding exception: content signature, SHA-256, opaque storage reference, temporary write then rename, immutable `FileMetadata` lineage, and authenticated read. The service first verifies the target company before touching filesystem state and removes a staged blob if its database transaction fails. This is an API/contract change without schema migration.

## G3 — Direct technical path

No dependency, UI library, schema, migration, font, or deployment topology changes. The direct path extends the existing company settings DTO/service transaction instead of issuing two browser writes, and retains the existing private file mount rather than adding public object storage. The alternative of calling the old settings and VAT endpoints sequentially from React is rejected because it permits a partial save.

## G4 — Experience system

The existing `BaseerDialog`, `BaseerValidatedFormField`, `BaseerButton`, `BaseerTextInput`, and `BaseerStaticSelect` remain the surface. One primary save control owns the combined action and exposes its busy state. The archive/reactivate action stays explicit and danger-styled when destructive in effect. Inline instructional paragraphs are removed without removing labels, errors, or owner-only notices. The logo picker accepts the same three image formats and supplies immediate Arabic/English validation for type and size.

## G5–G7 — Implementation and verification

The company editor now sends `vatRateBasisPoints` only through the existing company-settings command; the service reads the finance profile before any company write and updates both records in one tenant transaction. The separate VAT action, visible prose helpers, and archive reason input are removed. The logo picker rejects unsupported browser MIME types and files over 512 KiB locally; the server still verifies bytes, checks target-company existence before any filesystem write, and returns invalid bytes/size as validation rather than authorization failure.

Evidence on 2026-09-05:

- `npm run build --workspace @baseer-erp/contracts`, then type checks for contracts/API/web — passed.
- `npm run verify:administration-lifecycle` — passed, including real valid-logo upload/read through a disposable private directory, invalid signature rejection, and the combined settings/VAT transaction.
- Focused `administration-mocked-auth` checks — 6 desktop/mobile assertions passed for one save action, no VAT button/reason/prose, invalid browser-logo rejection, and direct archive payload.
- `check:administration-rls`, `check:architecture`, `check:dead-code`, `check:web-localization`, and `git diff --check` — passed.

The complete administration visual suite has a pre-existing, reproducible mobile snapshot mismatch on the unrelated Basira settings page (Arabic and English, 5–6% pixels). This slice does not touch that component or its styles, so its baselines are not overwritten as a way to force a green result. It remains an independent release-review observation; the new company-editor tests are green on desktop and mobile.

## G8 — Delivery boundary

The candidate must still pass independent delivery review and its commit-specific CI. Private-online publication additionally requires the existing immutable-image manifest, storage-mount preflight, and operator execution on the isolated Baseer Compose stack. No Noorix resource is in scope.
