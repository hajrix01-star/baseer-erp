# BASEER-IMPACT-2026-09-03-CI-AUTH-THROTTLING-SCRIPT-PATH

- **Type:** delivery-pipeline correction; no application code changed.
- **Decision:** point CI at the existing `run-auth-throttling-verification.mjs` script.
- **Reason:** the workflow referenced a non-existent old filename. The required verification already exists and proves both identity- and IP-based sign-in throttling.
- **Invariant:** the protection test remains mandatory; this correction restores it rather than bypassing it.

## Gates and rollback

- **G0–G4:** no domain, API behavior, authorization, data, or UI impact.
- **G5–G7:** local verification and remote CI must pass; rollback is a Git revert of this workflow-only commit.
