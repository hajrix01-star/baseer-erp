# Baseer ERP incident runbook

## Severity

| Severity | Meaning | Initial action |
| --- | --- | --- |
| P0 | suspected data loss, security incident, or full production outage | stop unsafe writes, page owner, preserve correlation IDs and timestamps, begin containment |
| P1 | material degradation of a critical capability | assess scope, mitigate, alert owner, start recovery clock |
| P2 | contained defect with workaround | record, prioritize, and fix through the normal release gate |

## Response flow

1. Record incident time, severity, affected capability, release version, and correlation IDs; never put credentials or personal data in the incident record.
2. Contain: disable the affected route/job only when this has an approved safe control; otherwise pause release progression.
3. Verify: use health/readiness, safe metrics, audit receipts, and isolated diagnostics.
4. Communicate a factual, user-safe status; do not speculate or disclose security internals.
5. Recover through the approved forward-fix, rollback, or isolated-restore procedure.
6. Validate the recovery, reconcile affected data when relevant, and preserve the evidence.
7. Complete a blameless review with root cause, corrective action, owner, and due date.

