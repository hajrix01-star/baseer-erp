# Production operations evidence ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Gate A discovery and decision record

**Status:** Gate A decisions approved by delegated committee authority Ã¢â‚¬â€ Gate B operational baseline documentation complete; external provisioning and rehearsal evidence remain pending.
**Capability:** The operational controls and evidence required to run Baseer ERP safely after the foundation Gate B build.  
**In scope:** production logging/retention policy, alerting and ownership, provisional SLO/error-budget policy, staging/deployment/rollback procedure, database backup and restore-drill policy, incident runbook, and evidence checklist.  
**Out of scope:** connecting to a production environment, selecting or configuring a cloud/SIEM/monitoring vendor, storing credentials, deploying Baseer, restoring any database, importing Noorix data, or enabling Finance.

## Gate A evidence

| Question | Evidence and proposed decision |
| --- | --- |
| Current Baseer boundary | The repository declares itself foundation-only: no production data connection, import, migration, or deployment is configured. Its disposable Docker database is a local test target only. Baseer now has safe stdout/stderr JSON events, bounded process metrics, liveness/readiness, and a protected summary, but no durable log collector, alert receiver, or backup job. |
| Governing requirement | Baseer standards require structured logs, correlation IDs, metrics, alerts, backups, restore drills, incident runbooks, explicit availability/latency SLOs, error budgets, reversible deployment, staging/rehearsal, and tested migrations before production. Gate C also requires logs, metrics, alerts, backup/restore, runbook, deployment, and rollback evidence. |
| Noorix reference | Noorix includes logical/system backup features, schedules, retention fields, integrity checks, recovery receipts, and a staging runbook. The handoff explicitly prohibits treating its logical-backup import as Baseer's final migration because it does not transfer every relationship/audit record. Noorix is evidence only; its backup code, paths, credentials, and runtime are not Baseer dependencies. |
| Environment separation | Development, disposable test, staging/rehearsal, and production must use different databases, roles, secrets, backups, and log destinations. Production is never targeted by local Docker compose or test scripts. |
| Logging and retention | Baseer emits safe logs but does not persist them. A production collector, regional/data-residency rule, encryption/access control, immutable retention period, deletion method, and audit access policy require owner approval. |
| Alerts and on-call | Alert routing, severity thresholds, escalation contact, acknowledgement target, and after-hours ownership are not discoverable in code and must be named by the owner. No alert receiver may be enabled by default. |
| SLOs and error budget | The core has no production latency baseline. Initial SLOs must be explicitly provisional and measured in staging before enforcement. A recommendation is availability 99.5% monthly for critical authenticated API paths, p95 health/readiness ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤100 ms, p95 authenticated read ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤300 ms, and p95 foundation write ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤750 ms excluding planned maintenance; release pauses after the agreed error budget is consumed. |
| Backup/restore | Baseer has no production backup implementation. Any future backup must be encrypted, integrity-verified, scope-limited, access-controlled, auditable, and restored only into an isolated target first. A restore drill must prove RPO/RTO and reconciliation without overwriting the active environment. |
| Deployment and rollback | No staging/prod deployment target exists. A release needs an immutable artifact/version, migration preflight, backup checkpoint, smoke checks, rollback decision point, and a declared rule for forward-fix versus restore. Additive migrations are preferred; no untested migration touches production. |
| Incident handling | A runbook must define P0/P1/P2 classification, who is contacted, containment, evidence preservation, safe user communication, recovery verification, and a blameless post-incident review. No personal contact details belong in the repository. |
| Completion definition | Owner-approved production operations decisions are represented as non-secret configuration/runbook contracts; staging rehearsal proves deployment and restore procedure; alert and log collection evidence exists; SLOs have a baseline; and Gate C reviewers can verify evidence without production secrets or Noorix dependency. |

## Preserve / Harden / Correct / Defer

| Area | Decision | Rationale |
| --- | --- | --- |
| Noorix backup integrity/recovery concepts | Preserve and harden | Preserve integrity checks, idempotency, explicit recovery, and retention concepts; rebuild them under Baseer contracts and isolated-target restore policy. |
| Direct local path/database backup behavior | Correct | Baseer must not expose filesystem backup paths, reuse local test compose as production, or restore into a live environment without a rehearsed, owner-approved procedure. |
| Current safe stdout/stderr logs | Preserve | They are an appropriate vendor-neutral source, but durable shipping and retention remain external operational controls. |
| Raw errors/stacks/upstream text | Correct | Production log redaction and controlled access remain mandatory; diagnostic data does not become a user-facing support endpoint. |
| Automatic alerts or external integrations | Defer | No routing target, credentials, or on-call owner has been approved. |
| Backup schedule and retention | Defer | These affect cost, data protection, recovery and compliance; they require an owner decision and a selected production storage boundary. |
| Finance and migration cutover | Defer | Both remain blocked until operations evidence and the later module/migration gates are complete. |

## Required owner decisions

1. Name the production and staging/rehearsal hosting owners and approve strict environment separation; local Docker/test data must never act as production (required).
2. Choose the production log/metric collector and its data region, access owner, encryption posture, and retention/deletion period; or explicitly keep production deployment blocked while this is undecided (required).
3. Choose alert routing and on-call ownership for P0/P1, including acknowledgement/escalation targets; no credentials or personal contacts are stored in Baseer source (required).
4. Approve provisional SLOs/error-budget policy, or provide alternatives: 99.5% monthly critical API availability; p95 health/readiness ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤100 ms, authenticated reads ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤300 ms, foundation writes ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤750 ms; releases pause after the agreed error budget is consumed (recommended).
5. Approve the backup/restore policy: encrypted integrity-verified backups, least-privileged access, documented retention, restore only to an isolated environment first, and a successful restore/reconciliation drill before production acceptance (required).
6. Approve staging deployment/rollback policy: immutable versioned artifact, additive/preflighted migration, backup checkpoint, smoke checks, explicit rollback point, and no untested migration in production (required).
7. Name the incident-response owner and approve the P0/P1/P2 runbook policy, including safe user communication and blameless post-incident review (required).

## Gate B plan after approval

1. Add non-secret typed operational configuration validation and a release manifest; fail closed when a required production control is absent.
2. Document and rehearse a staging deployment, additive migration preflight, smoke checks, rollback/forward-fix decision, and evidence capture.
3. Implement only the approved collector/alert adapters or deployment manifests, with secret references rather than secret values; verify redaction and least privilege.
4. Implement the approved backup and isolated-target restore procedure, integrity receipt, retention job, and restore/reconciliation drillÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Ânever a live overwrite endpoint.
5. Publish a repository-safe incident runbook template and collect evidence links outside source control where they contain operational identity or secrets.
6. Run Gate C review only when operations/migration reviewer, security, QA, independent monitor, and product owner accept the evidence.

## Committee decision and approval state

The product owner delegated these technical defaults to the committee on 2026-08-15. They are recorded in `docs/operations/PRODUCTION_BASELINE.md`.

1. Use vendor-neutral self-hosted Docker Compose on dedicated Linux staging, production application, production database, and operations hosts; local Docker/test data is never production.
2. Use Baseer redacted JSON logs, health/readiness, and protected in-process metrics with Docker log rotation. External collector, SaaS, Grafana/Loki, and alert-routing integration are deferred until the owner needs them.
3. Use the Baseer ERP product owner as the direct operational contact. External paging, SMTP, webhook, and public status integrations are deferred.
4. Approve the provisional 99.5% availability and p95 latency targets stated in this record, measured in staging before enforcement; pause non-critical releases when the agreed error budget is consumed.
5. Historical discovery assumption only: current backup policy is the Hostinger daily-server-backup decision in `../operations/HOSTINGER_PRIVATE_HOSTING_AND_BACKUP_DECISION_2026-08-16.md`, with isolated restore/reconciliation drills required before real data.
6. Use immutable release versions, staging rehearsal, preflighted additive migrations, backup checkpoint, smoke checks, explicit go/no-go, and controlled forward-fix/rollback policy.
7. The Baseer ERP product owner owns the P0/P1/P2 policy; the repository-safe incident runbook is recorded without personal contacts.

- Architect/security/QA: baseline and redaction boundaries recorded; no secret, external integration, or production connection was created.
- Operations/migration reviewer: external provisioning, deployment rehearsal, alert-delivery receipt, backup integrity, and isolated restore/reconciliation evidence remain mandatory before Gate C.
- Independent monitor: Finance and migration remain blocked; Noorix stays a read-only discovery reference with no runtime link.

## Gate B baseline evidence

- `docs/operations/PRODUCTION_BASELINE.md` records the private owner-controlled topology, retention, backup/recovery, separation, and evidence policy.
- `docs/operations/RELEASE_AND_RECOVERY_RUNBOOK.md` records the staging/release/failure decision path without live commands or credentials.
- `docs/operations/INCIDENT_RUNBOOK.md` records P0/P1/P2 containment, evidence, communication, recovery, and blameless-review procedure.
- No private live host, secret, backup target, production database, deployment, or Noorix connection has been created. A disposable local synthetic backup/restore rehearsal was completed and destroyed; owner-controlled provisioning and operational evidence are still required.
