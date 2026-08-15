# Open-Period Financial Editing — Gate A Decision

**Decision status:** Owner approved — mandatory for the first Finance delivery.  
**Approved:** 2026-08-15  
**Scope:** BASEER ERP is a private application for the owner and the owner's companies.

## Decision

Baseer follows Noorix's practical daily workflow. A user authorized for the selected company may directly create and edit an active Sales Closing, purchase invoice, expense invoice, vault allocation, and related operational financial record **while its business date belongs to an open fiscal period**.

The system must save the change in one server transaction: validate company/permissions/period, recalculate gross/net/VAT where relevant, rebuild the current active ledger and payment allocations, preserve document number and source identity, and record before/after audit evidence.

Draft is an optional convenience state, not a mandatory approval gate for ordinary personal-company work.

## Period boundary

| Period status | Direct edit | Correction path |
| --- | --- | --- |
| `open` | Allowed to authorized users, with audit and controlled ledger/allocation rebuild. | Direct edit is the normal path. |
| `closed` | Denied. | Authorized owner may reopen with a recorded reason, then edit; otherwise use a linked adjustment/reversal in an open period. |
| `locked` | Denied. | Linked adjustment/reversal in an open period only; the locked period is not reopened through ordinary application operations. |

Cancellation remains non-destructive: it preserves the original source document and audit trail while cancelling or reversing its active financial effect. Hard deletion of financial history is never allowed.

## Required controls

1. An edit is permitted only for the authorized company and exactly one open fiscal period.
2. Source document number, Noorix source identity, and migration checksum are never replaced by an edit.
3. The system records actor, time, old values, new values, recalculated VAT result, changed allocations, and affected ledger references.
4. A direct edit is atomic: there is no interval in which a changed invoice/closing and its active ledger/allocation evidence disagree.
5. Reports and dashboard projections rebuild from the active records after direct edit or cancellation; they never rely on browser calculations.
6. Attachments preserve version history as evidence. Replacing a receipt does not erase the prior evidence version.

## Consequences

This decision supersedes earlier Baseer discovery wording that required a document to remain immutable merely because it was approved or posted. In Baseer, **the fiscal-period state is the editing boundary**, not a day-to-day approval status.
