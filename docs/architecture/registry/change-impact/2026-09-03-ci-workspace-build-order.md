# BASEER-IMPACT-2026-09-03-CI-WORKSPACE-BUILD-ORDER

- **Type:** delivery-pipeline correction; no application code changed.
- **Decision:** build `@baseer-erp/contracts` and `@baseer-erp/output-platform` before the API TypeScript check.
- **Reason:** their workspace packages export `dist` artifacts. A clean GitHub runner correctly exposes the missing dependency build order that a previously-built local tree masked.
- **Invariant:** API and web checks remain mandatory and occur after their declared package artifacts exist; no check is skipped or weakened.

## Gates and rollback

- **G0–G4:** no domain, API behavior, authorization, data, or UI impact.
- **G5–G7:** remote CI must prove clean-run compilation and image release; rollback is a Git revert of this workflow-only commit.
