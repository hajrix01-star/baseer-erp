# Output Platform — Gate A discovery and decision record

**Status:** Gate B implementation and integration evidence complete — Gate C remains blocked by other foundation slices  
**Capability:** Bind the existing Baseer Output Platform to the platform core.  
**In scope:** one-company, server-created report snapshots; HTML print preview;
server-generated XLSX; live company authorization; audit receipts; artifact
lifecycle contract.  
**Out of scope:** Finance reports, Noorix runtime/API reuse, Noorix data
import, PDF generation, CSV delivery, multi-company output, and browser-side
calculation.

## Gate A evidence

| Question | Evidence and proposed decision |
| --- | --- |
| User outcome | A permitted user can request a trustworthy, bilingual preview or XLSX export for one company without copying data into the browser. |
| Noorix equivalent | `src/ui/usePrintPreview.tsx`, `PrintPreviewModal.tsx`, `utils/printUtils.ts`, and `printTableHtml.ts` construct HTML in the client and invoke `window.print()`. Noorix supports a print/save-PDF user journey but this does not prove physical printing, does not establish a server snapshot, and has no central artifact lifecycle. |
| Existing Baseer asset | `packages/output-platform` creates escaped HTML previews and XLSX, preserves RTL/LTR, and escapes formula-prefixed spreadsheet cells. Its two package tests pass. It is not yet connected to API, company context, audit, or persistence. |
| Source of truth | Each registered Baseer report definition must create its snapshot from an authoritative server read model. Client-provided rows, totals, company scope, permissions, or business calculations are forbidden. |
| Scope and permission | The API must derive tenant, user, company, and capabilities using `CompanyContextService`; no actor, permission, or company scope may be accepted from the request body. The exact preview/export capabilities remain an owner policy decision. |
| Immutable effect | A snapshot is an immutable receipt of the server projection at its generation instant. A later source-data change must create a new snapshot, not mutate a historical artifact. |
| Date and locale | Snapshot metadata must include explicit source label, period/basis, generated-at instant, locale, direction, company, and later the central Saudi business-date value. Visible digits remain English `0-9`. |
| Migration impact | No Noorix output artifacts migrate in this slice. A Baseer artifact record/migration is required only after retention and re-download policy is approved. |
| Completion definition | A permitted user can request preview/XLSX natively; denied/stale/cross-company requests fail; rows originate server-side; unsafe spreadsheet formula input is escaped; output request/creation/download/print-issued events are auditable; retry/idempotency and retention behavior are proven. |

## Preserve / Harden / Correct / Defer

| Area | Decision | Rationale |
| --- | --- | --- |
| Print-preview journey | Preserve | Users retain a native preview followed by browser print/save-PDF. Audit records `print_issued`, never a claim that paper physically printed. |
| Output authority | Harden | Baseer server creates the snapshot after live authorization and company-context verification; the browser only renders the received artifact. |
| XLSX | Harden | Keep server-side XLSX, formula-injection escaping, English digits, explicit metadata, and audit. Do not read untrusted XLSX files in this platform. |
| Output actor and scope contracts | Correct | Remove the current trust in caller-supplied actor permissions and company IDs when integrating with the API; derive both from verified live context. |
| Artifact lifecycle | Harden | Require an explicit immutable receipt, audit trail, retry/idempotency behavior, and owner-approved retention/re-download policy. |
| CSV | Defer | `csv` appears in the current type list but is not implemented; it must not be exposed until a separate approved contract and escaping policy exist. |
| PDF | Defer | No server-side PDF in this foundation slice. Browser print/save-PDF begins only from the trusted preview. |
| Multi-company output | Defer | The core boundary remains exactly one verified company per request. |

## Required owner decisions

1. Choose the first output type: **generic platform proof only** (recommended), or name a specific non-financial report whose authoritative Baseer read model already exists.
2. Choose artifact retention: **ephemeral bytes plus immutable audit/snapshot metadata** (recommended), or persistent artifact storage with a retention period and re-download rules.
3. Approve capability names for the first slice: `platform.output.preview` and `platform.output.export` (recommended), or provide the required names.
4. Confirm that `print_issued` means “the browser print action was initiated,” never proof of physical printing or PDF saving.

## Gate B plan after approval

1. Narrow the public output format contract to the approved formats.
2. Add API endpoints that accept only report code, format, locale, filters, and an idempotency key; derive identity and company context from headers/tokens.
3. Bind output generation to `CompanyContextService`, `IdempotencyService`, audit, and a server-side report-definition registry.
4. Add the approved artifact receipt/lifecycle persistence only if persistence is chosen.
5. Run integration tests for denied permission, cross-company scope, stale session, idempotent replay/mismatch, audit rollback, preview escaping, XLSX formula injection, RTL/LTR, and download/print-issued audit events.

## Approval state

- Product owner: approved the four decisions on 2026-08-15.
- Architect/security/QA: discovery evidence recorded; implementation review pending approved contract.
- Finance/domain reviewer: not applicable to the generic proof; required before any financial report is registered.
- Independent monitor: Finance remains blocked; no Noorix runtime or data dependency is introduced.

## Gate B implementation evidence

- Public API is limited to `POST /v1/outputs/:reportCode` and `POST /v1/outputs/print-issued`.
- Only `platform.company-context` is registered as the non-financial proof report; it creates its data from the live, authorized Baseer company record inside the tenant transaction.
- The request accepts only report code, approved format (`preview` or `xlsx`), locale, empty-or-definition-owned filters, and idempotency key. Identity and company scope come exclusively from the access token and `X-Baseer-Company-Id`.
- `platform.output.preview` or `platform.output.export` is verified live through `CompanyContextService` before rendering.
- Preview and XLSX artifact contents are retained only inside the one-hour idempotency receipt for exact retry; no durable artifact file or PDF/CSV endpoint exists.
- Audit events record request, generation, preview/download issue, replay, and browser `print_issued`; print-issued does not claim physical printing.
- `scripts/run-gate-b-db-verification.mjs` passed denied permission, cross-company, revoked-session, replay/mismatch, preview, XLSX, audit, RLS, and core regression scenarios against the disposable Baseer database.