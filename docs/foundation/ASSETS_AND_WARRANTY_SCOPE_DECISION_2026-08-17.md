# BASEER ERP — Assets and Warranty Scope Decision

**Decision date:** 2026-08-17
**Status:** Planned; not an active build scope
**Current delivery authority:** `../governance/CURRENT_DELIVERY_AUTHORITY.md`

## Decision

Baseer will adopt the useful Noorix workflow, but not its implementation details:

1. A purchase, expense, or recurring-expense payment may carry the optional marker **"Needs asset / warranty follow-up"**.
2. The marker creates no asset, warranty, journal, depreciation, balance change, or automatic accounting classification. It only makes the source document visible in the Assets & Warranty queue.
3. An authorized user later completes the queued item into an asset/warranty record. The record keeps the immutable source-document reference, supplier, invoice date and amount as copied context; the user supplies the asset name, serial number, location, warranty provider/terms, start/end date and optional line items.
4. Completing the record marks the queue item done atomically and leaves the original financial document unchanged. One source document may later support one or more explicitly recorded assets only where the approved scope supports it; it must never be silently capitalized.

## What Noorix does and what Baseer retains

Noorix stores `warrantyFollowUp` and `warrantyFollowUpDone` on the source invoice. Its Assets module lists only flagged, unfinished purchase/expense/fixed-expense invoices; a user completes the asset record from that queue and then the source leaves the queue. The completion form records asset identity, serial/location, purchase context and warranty dates/lines. The marker is therefore a workflow hand-off, not an accounting command.

Baseer retains this separation because it is simple for a small private company and avoids treating every warranty-bearing item as a capital asset.

## Accounting boundary

- A warranty is an operational entitlement, not a financial posting.
- The current cash-on-payment expense policy remains authoritative for supplier credit documents. It expressly excludes assets and inventory from automatic treatment.
- Capitalization, asset threshold, useful life, depreciation, impairment, disposal and correction/reversal are a separate **Asset Accounting policy**. They require explicit journal templates, approval, period controls, audit, reconciliation and owner acceptance before Baseer permits financial asset postings.
- Until that policy and implementation exist, an asset record is an operational register only. Its acquisition amount is reference data, not a new balance or a second expense.

## Records and relationships to build

| Record | Responsibility | Required relationship |
| --- | --- | --- |
| Source purchase/expense document | Financial source, payment and supplier due status | Optional immutable `assetWarrantyFollowUp` marker |
| Asset/Warranty queue item | Server read model of marked, unfinished source documents | Company-scoped; source document id; no browser-computed truth |
| Asset record | Operational identity, custody and lifecycle | Optional source document and supplier references; no implicit financial posting |
| Warranty record / line | Coverage, provider, serial/item, dates, status and claims | Belongs to an asset; supports multiple covered items where needed |
| Evidence attachment | Warranty certificate, invoice or service evidence | Only after File Storage Gate A; authorized, scanned and retained — never a public URL |

## Delivery order and prerequisites

Assets & Warranty does **not** start now. It is scheduled after the current finance-source acceptance and reconciled finance read-model gate, and before a live Noorix migration/cutover. Its internal sequence is:

1. Close Treasury and Purchase & Expense owner verification, including the correction/cancellation decision.
2. Deliver reconciled finance read models so the source-document drill-down and print/export contract are stable.
3. Decide Asset Accounting policy (capitalization threshold, depreciation and disposal scope) separately; do not infer it from the warranty marker.
4. Build Assets & Warranty Gate A: company-scoped queue, operational asset register, warranty dates/status, permissions, audit, idempotency and source-document drill-down. No asset posting or file upload in this gate.
5. Complete File Storage Gate A before enabling warranty certificate upload/download, retention or virus scanning.
6. Build approved asset-accounting effects and lifecycle actions only in a separately accepted gate.

## Migration and AI readiness

- Noorix migration is discovery-only until a dedicated Import Run exists. It must preserve source invoice id/code, follow-up state, asset/warranty id, supplier id, serial number, date fields and attachment metadata; it must use dry-run, source maps, reconciliation and owner approval. It must not auto-capitalize imported rows.
- The module must deliver an AI-readiness manifest, typed read contract and Arabic/English evaluation fixtures as part of its definition of done. A user-facing AI skill stays inactive until the register/read model, freshness, citations and access tests are accepted.

## Explicit exclusions for Gate A

No automatic asset creation; depreciation; impairment; disposal; claims submission; renewal purchasing; public file links; OCR; provider/AI calls; mobile scanning; live Noorix import; or autonomous financial action.
