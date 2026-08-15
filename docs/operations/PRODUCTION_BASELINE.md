# Baseer ERP private online deployment baseline

## Scope decision

BASEER ERP is a private online system for its owner and the owner's companies.
It is not a SaaS product, marketplace, public multi-customer service, or public
registration portal. The Baseer website is reachable over HTTPS only by users
the owner creates and authorizes. Tenant/company boundaries are technical
isolation controls for the owner's companies, not customer tenancy.

## Private online topology

```text
Owner-chosen available domain (HTTPS)
  +- reverse proxy / TLS boundary
      +- owner-controlled private server - Docker Compose
          +- Baseer ERP application (public web port only)
          +- PostgreSQL (internal Docker network; no public port)
          +- backup job (no public port)

Encrypted backup target outside the active database disk
  +- removable encrypted drive or owner-controlled second machine

Disposable local/staging test database
  +- never connected to live private data
```

The BASEER ERP application may be exposed through any owner-chosen available HTTPS domain.
PostgreSQL, Docker control ports, backup storage, metrics, and administrative
services remain non-public. There is no public registration, anonymous company
access, or customer tenancy.

## Approved private defaults

| Control | Private online baseline |
| --- | --- |
| Brand | The application name remains **BASEER ERP**. The domain is a replaceable technical address and does not define the product name, company data, permissions, or identity. |
| Runtime | Docker Compose on an owner-controlled Windows/Linux private server. |
| Users | Only the owner and users explicitly created for the owner's companies; no public registration, billing, tenant onboarding, or customer administration. |
| Isolation | Every request uses verified identity, tenant, company membership, live permissions, RLS, audit, and no body-supplied company/actor authority. |
| Network | Public HTTPS only through the owner-controlled domain/reverse proxy. PostgreSQL, Docker, backup, metrics, and administrative ports remain private. |
| Logs/metrics | Keep Baseer's redacted JSON logs, request correlation, health/readiness, and protected in-process summary. Use Docker log rotation locally; no Loki/Grafana/SaaS collector is required initially. |
| Alerts | The owner is the operational contact. Health checks and manual review are sufficient initially; external paging/webhook is deferred until needed. |
| Backups | Scheduled encrypted PostgreSQL backups to a physically separate owner-controlled drive/device. Keep 35 daily and 12 weekly recovery points; never rely only on the active database disk. |
| Restore | Restore only into an isolated disposable database first. Verify checksum, migrations, RLS, users, and company reconciliation before touching the live private system. |
| Updates | Create a backup checkpoint, apply only tested additive migrations, run readiness/smoke checks, and retain the previous Docker image/version for rollback. |
| Incidents | Owner decides whether to pause writes, restore an isolated copy, or roll back; no public status page or external incident process is required. |

## Before real private online use

1. Choose the owner-controlled private server and encrypted backup device.
2. Create the private online Docker deployment configuration; never use the disposable test compose as the live database.
3. Configure an owner-chosen available domain with HTTPS; keep database, Docker, backup, metrics, and administrative ports non-public. A future domain change must preserve the BASEER ERP brand and all data/identity boundaries.
4. Create the owner and each company/user through the Baseer identity and company-context flows only; no public sign-up.
5. Perform one backup and isolated restore rehearsal with synthetic Baseer data.
6. Only then move to Gate C review; Finance remains gated by the foundation evidence.